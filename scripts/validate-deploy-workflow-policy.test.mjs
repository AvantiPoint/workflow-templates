import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  readCommittedPolicyFiles,
  validateDeployWorkflowPolicy,
} from './validate-deploy-workflow-policy.mjs';

const committed = readCommittedPolicyFiles();

function errorsFor(overrides = {}) {
  return validateDeployWorkflowPolicy({ ...committed, ...overrides });
}

function expectViolation(errors, pattern) {
  assert.ok(errors.some((error) => pattern.test(error)), `Expected ${pattern}, received:\n${errors.join('\n')}`);
}

test('committed deployment workflow policy passes', () => {
  assert.deepEqual(errorsFor(), []);
});

test('committed dry-run fixture is a canonical NuGet ZIP', () => {
  const encoded = readFileSync('test-assets/dry-run/AppPortal.WorkflowDryRun.0.0.0.nupkg.b64', 'utf8').trim();
  const bytes = Buffer.from(encoded, 'base64');
  assert.equal(bytes.toString('base64'), encoded);
  assert.equal(bytes.readUInt32LE(0), 0x04034b50);
  const endOffset = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(endOffset > 0);
  assert.equal(bytes.readUInt32LE(endOffset + 16) + bytes.readUInt32LE(endOffset + 12), endOffset);
  assert.ok(bytes.includes(Buffer.from('AppPortal.WorkflowDryRun.nuspec')));
});

test('mutable deployment action references fail closed', () => {
  const deploymentWorkflow = committed.deploymentWorkflow.replace(
    'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c',
    'actions/download-artifact@v8',
  );
  expectViolation(errorsFor({ deploymentWorkflow }), /full 40-character commit SHA/);
});

test('mutable signing action references fail closed', () => {
  const signingAction = committed.signingAction.replace(
    'azure/login@7184910d9eb2b1c5e48f7073824a90609bb9b6d6',
    'azure/login@v2',
  );
  expectViolation(errorsFor({ signingAction }), /full 40-character commit SHA/);
});

test('new mutable remote actions fail closed', () => {
  const deploymentWorkflow = committed.deploymentWorkflow.replace(
    '    steps:',
    '    steps:\n      - uses: example/unreviewed-action@main',
  );
  expectViolation(errorsFor({ deploymentWorkflow }), /full 40-character commit SHA/);
});

test('inline mutable remote actions fail closed', () => {
  const deploymentWorkflow = committed.deploymentWorkflow.replace(
    '    steps:',
    '    steps:\n      - { uses: example/unreviewed-action@main }',
  );
  expectViolation(errorsFor({ deploymentWorkflow }), /dedicated YAML line/);
});

test('removing a reviewed credential-bearing action fails closed', () => {
  const deploymentWorkflow = committed.deploymentWorkflow.replace(
    /^\s*uses: dansiegel\/publish-nuget@[^\n]+$/m,
    '        run: Write-Host "publication action removed"',
  );
  expectViolation(errorsFor({ deploymentWorkflow }), /must retain the reviewed dansiegel\/publish-nuget action/);
});

test('missing deploy job timeout fails closed', () => {
  const deploymentWorkflow = committed.deploymentWorkflow.replace(/^\s*timeout-minutes: 10\s*$/m, '');
  expectViolation(errorsFor({ deploymentWorkflow }), /must set exactly one integer timeout-minutes/);
});

test('duplicate deploy job timeouts fail closed', () => {
  const deploymentWorkflow = committed.deploymentWorkflow.replace(
    '    timeout-minutes: 10',
    '    timeout-minutes: 10\n    timeout-minutes: 60',
  );
  expectViolation(errorsFor({ deploymentWorkflow }), /must set exactly one integer timeout-minutes/);
});

test('a blanket 60-minute deploy timeout fails closed', () => {
  const deploymentWorkflow = committed.deploymentWorkflow.replace('timeout-minutes: 10', 'timeout-minutes: 60');
  expectViolation(errorsFor({ deploymentWorkflow }), /must be between 1 and 10; found 60/);
});

test('moving the signing job to a self-hosted runner fails closed', () => {
  const deploymentWorkflow = committed.deploymentWorkflow.replace('runs-on: windows-latest', 'runs-on: avp-linux');
  expectViolation(errorsFor({ deploymentWorkflow }), /must use the hosted windows-latest signing runner/);
});

test('dry-run remains opt-in', () => {
  const deploymentWorkflow = committed.deploymentWorkflow.replace(
    '        description: Inspect the downloaded NuGet artifact without signing, publishing, or reading deployment secrets.\n        default: false',
    '        description: Inspect the downloaded NuGet artifact without signing, publishing, or reading deployment secrets.\n        default: true',
  );
  expectViolation(errorsFor({ deploymentWorkflow }), /dry-run input that defaults to false/);
});

test('dry-run cannot require the real deployment API key', () => {
  const deploymentWorkflow = committed.deploymentWorkflow.replace(
    '      apiKey:\n        description: Required for real deployments; omitted by dry-run callers.\n        required: false',
    '      apiKey:\n        description: Required for real deployments; omitted by dry-run callers.\n        required: true',
  );
  expectViolation(errorsFor({ deploymentWorkflow }), /apiKey must be optional at workflow-call validation/);
});

test('dry-run job cannot read deployment secrets', () => {
  const deploymentWorkflow = committed.deploymentWorkflow.replace(
    '    timeout-minutes: 3\n    steps:',
    '    timeout-minutes: 3\n    env:\n      NUGET_API_KEY: ${{ secrets.apiKey }}\n    steps:',
  );
  expectViolation(errorsFor({ deploymentWorkflow }), /job dry-run must not read or declare secrets/);
});

test('dry-run job cannot contain the publication action', () => {
  const deploymentWorkflow = committed.deploymentWorkflow.replace(
    '      - name: Inspect NuGet packages without credentials',
    '      - uses: dansiegel/publish-nuget@3a5a0d5ddd96d6c36d73586e9e0f3b829c14319f\n\n      - name: Inspect NuGet packages without credentials',
  );
  expectViolation(errorsFor({ deploymentWorkflow }), /job dry-run must not contain signing or publication actions/);
});

test('dry-run job cannot contain the signing action', () => {
  const deploymentWorkflow = committed.deploymentWorkflow.replace(
    '      - name: Inspect NuGet packages without credentials',
    '      - uses: avantipoint/workflow-templates/.github/actions/sign-packages@0836b48f03b9309fe1bcadda6109d9e761e5aaef\n\n      - name: Inspect NuGet packages without credentials',
  );
  expectViolation(errorsFor({ deploymentWorkflow }), /job dry-run must not contain signing or publication actions/);
});

test('dry-run job cannot add a command-line publication path', () => {
  const deploymentWorkflow = committed.deploymentWorkflow.replace(
    "          const { createHash } = require('node:crypto');",
    "          require('node:child_process').execFileSync('dotnet', ['nuget', 'push', 'Artifacts/*.nupkg']);\n          const { createHash } = require('node:crypto');",
  );
  expectViolation(errorsFor({ deploymentWorkflow }), /must match the reviewed credential-free inspection implementation/);
});

test('dry-run job cannot add a command-line signing path', () => {
  const deploymentWorkflow = committed.deploymentWorkflow.replace(
    "          const { createHash } = require('node:crypto');",
    "          require('node:child_process').execFileSync('nuget', ['sign', 'Artifacts/package.nupkg']);\n          const { createHash } = require('node:crypto');",
  );
  expectViolation(errorsFor({ deploymentWorkflow }), /must match the reviewed credential-free inspection implementation/);
});

test('dry-run job rejects an excessive timeout', () => {
  const deploymentWorkflow = committed.deploymentWorkflow.replace('    timeout-minutes: 3', '    timeout-minutes: 60');
  expectViolation(errorsFor({ deploymentWorkflow }), /job dry-run timeout-minutes must be between 1 and 3; found 60/);
});

test('real deploy retains the inverse dry-run guard', () => {
  const deploymentWorkflow = committed.deploymentWorkflow.replace(
    '    if: ${{ ! inputs.dry-run }}',
    '    if: ${{ inputs.dry-run }}',
  );
  expectViolation(errorsFor({ deploymentWorkflow }), /job deploy must run only when dry-run is false/);
});

test('real deploy fails closed without its API key gate', () => {
  const deploymentWorkflow = committed.deploymentWorkflow.replace(
    '          NUGET_API_KEY: ${{ secrets.apiKey }}',
    "          NUGET_API_KEY: ''",
  );
  expectViolation(errorsFor({ deploymentWorkflow }), /read apiKey only inside the real deployment guard/);
});

test('real deploy preserves existing publication inputs', () => {
  const deploymentWorkflow = committed.deploymentWorkflow.replace(
    "            filename: 'Artifacts/*.nupkg'",
    "            filename: 'Artifacts/*.snupkg'",
  );
  expectViolation(errorsFor({ deploymentWorkflow }), /preserve the existing publication inputs/);
});

test('dry-run caller cannot inherit secrets', () => {
  const dryRunWorkflow = committed.dryRunWorkflow.replace(
    '    uses: ./.github/workflows/deploy-nuget.yml\n    with:',
    '    uses: ./.github/workflows/deploy-nuget.yml\n    secrets: inherit\n    with:',
  );
  expectViolation(errorsFor({ dryRunWorkflow }), /must not read, inherit, or pass secrets/);
});

test('dry-run caller must use same-commit local workflow syntax', () => {
  const dryRunWorkflow = committed.dryRunWorkflow.replace(
    'uses: ./.github/workflows/deploy-nuget.yml',
    'uses: avantipoint/workflow-templates/.github/workflows/deploy-nuget.yml@e808be290d267420d1a64ee2e2bcbd5e52b988d9',
  );
  expectViolation(errorsFor({ dryRunWorkflow }), /must retain same-commit local call/);
});

test('dry-run caller cannot disable dry-run mode', () => {
  const dryRunWorkflow = committed.dryRunWorkflow.replace('      dry-run: true', '      dry-run: false');
  expectViolation(errorsFor({ dryRunWorkflow }), /force dry-run mode/);
});

test('dry-run caller action pins fail closed', () => {
  const dryRunWorkflow = committed.dryRunWorkflow.replace(
    'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a',
    'actions/upload-artifact@v7',
  );
  expectViolation(errorsFor({ dryRunWorkflow }), /full 40-character commit SHA/);
});
