import assert from 'node:assert/strict';
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
