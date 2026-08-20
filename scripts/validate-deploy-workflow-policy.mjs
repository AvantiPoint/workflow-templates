import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const deploymentWorkflowPath = '.github/workflows/deploy-nuget.yml';
const dryRunWorkflowPath = '.github/workflows/deploy-nuget-dry-run.yml';
const signingActionPath = '.github/actions/sign-packages/action.yml';
const maximumDeployTimeoutMinutes = 10;
const maximumDryRunTimeoutMinutes = 3;
const reviewedDryRunJobSha256 = 'e9977e4e330c2a3e280e98d66c2b212105798b1b98d77b79081ffcc195e6e628';

const actionRefs = {
  checkout: 'actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803',
  download: 'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c',
  login: 'azure/login@7184910d9eb2b1c5e48f7073824a90609bb9b6d6',
  publish: 'dansiegel/publish-nuget@3a5a0d5ddd96d6c36d73586e9e0f3b829c14319f',
  sign: 'avantipoint/workflow-templates/.github/actions/sign-packages@0836b48f03b9309fe1bcadda6109d9e761e5aaef',
  upload: 'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a',
};

const expectedActions = new Map([
  [deploymentWorkflowPath, new Set([
    'actions/download-artifact',
    'avantipoint/workflow-templates/.github/actions/sign-packages',
    'dansiegel/publish-nuget',
  ])],
  [dryRunWorkflowPath, new Set([
    'actions/checkout',
    'actions/upload-artifact',
  ])],
  [signingActionPath, new Set([
    'azure/login',
  ])],
]);

const allowedLocalUses = new Map([
  [dryRunWorkflowPath, new Set(['./.github/workflows/deploy-nuget.yml'])],
]);

function parseUsesValue(line) {
  const prefix = line.match(/^\s*(?:-\s*)?uses:\s*(.*)$/);
  if (!prefix) {
    return null;
  }

  const value = prefix[1].match(/^(?:'([^']+)'|"([^"]+)"|([^\s#]+))(?:\s+#.*)?$/);
  return value ? (value[1] ?? value[2] ?? value[3]) : '';
}

function validateActionPins(path, content, errors) {
  const expected = expectedActions.get(path);
  const allowedLocal = allowedLocalUses.get(path) ?? new Set();
  const found = new Set();
  const foundLocal = new Set();

  for (const [index, line] of content.replaceAll('\r\n', '\n').split('\n').entries()) {
    const value = parseUsesValue(line);
    if (value === null) {
      if (/\buses\s*:/.test(line)) {
        errors.push(`${path}:${index + 1} must put its uses reference on a dedicated YAML line.`);
      }
      continue;
    }

    if (value === '') {
      errors.push(`${path}:${index + 1} has an unreadable uses reference.`);
      continue;
    }

    if (value.startsWith('./')) {
      if (!allowedLocal.has(value)) {
        errors.push(`${path}:${index + 1} contains unreviewed local reference ${value}.`);
      } else {
        foundLocal.add(value);
      }
      continue;
    }

    const action = value.match(/^([^/\s]+)\/([^@\s]+)@([0-9a-f]{40})$/i);
    if (!action) {
      errors.push(`${path}:${index + 1} must pin ${value} to a full 40-character commit SHA.`);
      continue;
    }

    found.add(`${action[1]}/${action[2]}`.toLowerCase());
  }

  for (const action of expected) {
    if (!found.has(action)) {
      errors.push(`${path} must retain the reviewed ${action} action.`);
    }
  }
  for (const localReference of allowedLocal) {
    if (!foundLocal.has(localReference)) {
      errors.push(`${path} must retain same-commit local call ${localReference}.`);
    }
  }
}

function parseJobs(path, content, errors) {
  const lines = content.replaceAll('\r\n', '\n').split('\n');
  const jobsIndexes = lines
    .map((line, index) => (line === 'jobs:' ? index : -1))
    .filter((index) => index >= 0);
  if (jobsIndexes.length !== 1) {
    errors.push(`${path} must define exactly one local jobs block.`);
    return new Map();
  }

  const jobs = [];
  let jobsEnd = lines.length;
  for (let index = jobsIndexes[0] + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\S/.test(line) && line.trim() !== '' && !line.trimStart().startsWith('#')) {
      jobsEnd = index;
      break;
    }

    const job = line.match(/^  ([A-Za-z0-9_-]+):\s*(?:#.*)?$/);
    if (job) {
      jobs.push({ name: job[1], start: index, end: lines.length });
    }
  }

  for (let index = 0; index < jobs.length - 1; index += 1) {
    jobs[index].end = jobs[index + 1].start;
  }
  if (jobs.length > 0) {
    jobs.at(-1).end = jobsEnd;
  }

  const blocks = new Map();
  for (const job of jobs) {
    if (blocks.has(job.name)) {
      errors.push(`${path} defines duplicate job ${job.name}.`);
    } else {
      blocks.set(job.name, lines.slice(job.start + 1, job.end));
    }
  }
  return blocks;
}

function validateExpectedJobs(path, jobs, expectedNames, errors) {
  for (const name of expectedNames) {
    if (!jobs.has(name)) {
      errors.push(`${path} must retain job ${name}.`);
    }
  }
  for (const name of jobs.keys()) {
    if (!expectedNames.has(name)) {
      errors.push(`${path} contains unexpected job ${name}.`);
    }
  }
}

function validateTimeout(path, jobName, block, maximumMinutes, errors) {
  const timeoutLines = block.filter((line) => /^    timeout-minutes:/.test(line));
  if (timeoutLines.length !== 1) {
    errors.push(`${path} job ${jobName} must set exactly one integer timeout-minutes.`);
    return;
  }

  const timeout = timeoutLines[0].match(/^    timeout-minutes:\s*(\d+)\s*(?:#.*)?$/);
  if (!timeout) {
    errors.push(`${path} job ${jobName} timeout-minutes must be an integer.`);
    return;
  }

  const timeoutMinutes = Number.parseInt(timeout[1], 10);
  if (timeoutMinutes < 1 || timeoutMinutes > maximumMinutes) {
    errors.push(`${path} job ${jobName} timeout-minutes must be between 1 and ${maximumMinutes}; found ${timeoutMinutes}.`);
  }
}

function requireExactLine(path, jobName, block, expectedLine, description, errors) {
  if (block.filter((line) => line === expectedLine).length !== 1) {
    errors.push(`${path} job ${jobName} must ${description}.`);
  }
}

function requireText(path, jobName, blockText, expectedText, description, errors) {
  if (!blockText.includes(expectedText)) {
    errors.push(`${path} job ${jobName} must ${description}.`);
  }
}

function validateDeployWorkflow(content, errors) {
  const normalized = content.replaceAll('\r\n', '\n');
  const dryRunInput = [
    '      dry-run:',
    '        type: boolean',
    '        description: Inspect the downloaded NuGet artifact without signing, publishing, or reading deployment secrets.',
    '        default: false',
    '        required: false',
  ].join('\n');
  const apiKeyContract = [
    '      apiKey:',
    '        description: Required for real deployments; omitted by dry-run callers.',
    '        required: false',
  ].join('\n');
  if (!normalized.includes(dryRunInput)) {
    errors.push(`${deploymentWorkflowPath} must retain an opt-in boolean dry-run input that defaults to false.`);
  }
  if (!normalized.includes(apiKeyContract)) {
    errors.push(`${deploymentWorkflowPath} apiKey must be optional at workflow-call validation and required inside the real deploy job.`);
  }

  const jobs = parseJobs(deploymentWorkflowPath, normalized, errors);
  validateExpectedJobs(deploymentWorkflowPath, jobs, new Set(['dry-run', 'deploy']), errors);

  const dryRun = jobs.get('dry-run');
  if (dryRun) {
    const dryRunText = dryRun.join('\n');
    const dryRunHash = createHash('sha256').update(dryRunText).digest('hex');
    if (dryRunHash !== reviewedDryRunJobSha256) {
      errors.push(`${deploymentWorkflowPath} job dry-run must match the reviewed credential-free inspection implementation.`);
    }
    requireExactLine(deploymentWorkflowPath, 'dry-run', dryRun, '    if: ${{ inputs.dry-run }}', 'run only when dry-run is true', errors);
    requireExactLine(deploymentWorkflowPath, 'dry-run', dryRun, '    runs-on: ubuntu-slim', 'use hosted ubuntu-slim', errors);
    validateTimeout(deploymentWorkflowPath, 'dry-run', dryRun, maximumDryRunTimeoutMinutes, errors);
    requireText(deploymentWorkflowPath, 'dry-run', dryRunText, `uses: ${actionRefs.download}`, 'download the selected artifact with the reviewed action', errors);
    requireText(deploymentWorkflowPath, 'dry-run', dryRunText, 'Inspect NuGet packages without credentials', 'inspect NuGet package structure', errors);
    requireText(deploymentWorkflowPath, 'dry-run', dryRunText, 'centralDirectoryEntries(bytes)', 'validate the ZIP central directory', errors);
    if (/\bsecrets\s*:|secrets\./.test(dryRunText)) {
      errors.push(`${deploymentWorkflowPath} job dry-run must not read or declare secrets.`);
    }
    if (dryRunText.includes(actionRefs.sign) || dryRunText.includes(actionRefs.publish)) {
      errors.push(`${deploymentWorkflowPath} job dry-run must not contain signing or publication actions.`);
    }
  }

  const deploy = jobs.get('deploy');
  if (deploy) {
    const deployText = deploy.join('\n');
    requireExactLine(deploymentWorkflowPath, 'deploy', deploy, '    if: ${{ ! inputs.dry-run }}', 'run only when dry-run is false', errors);
    requireExactLine(deploymentWorkflowPath, 'deploy', deploy, '    runs-on: windows-latest', 'use the hosted windows-latest signing runner', errors);
    validateTimeout(deploymentWorkflowPath, 'deploy', deploy, maximumDeployTimeoutMinutes, errors);
    requireText(deploymentWorkflowPath, 'deploy', deployText, 'NUGET_API_KEY: ${{ secrets.apiKey }}', 'read apiKey only inside the real deployment guard', errors);
    requireText(deploymentWorkflowPath, 'deploy', deployText, "if ([string]::IsNullOrWhiteSpace($env:NUGET_API_KEY))", 'fail closed when the real deployment API key is absent', errors);
    requireText(deploymentWorkflowPath, 'deploy', deployText, `uses: ${actionRefs.sign}`, 'retain the reviewed signing action', errors);
    requireText(deploymentWorkflowPath, 'deploy', deployText, 'if: ${{ inputs.code-sign }}', 'preserve opt-in signing semantics', errors);
    requireText(deploymentWorkflowPath, 'deploy', deployText, `uses: ${actionRefs.publish}`, 'retain the reviewed publication action', errors);
    requireText(
      deploymentWorkflowPath,
      'deploy',
      deployText,
      "            filename: 'Artifacts/*.nupkg'\n            feedUrl: ${{ secrets.feedUrl }}\n            apiKey: ${{ secrets.apiKey }}",
      'preserve the existing publication inputs',
      errors,
    );
  }
}

function validateDryRunCaller(content, errors) {
  const normalized = content.replaceAll('\r\n', '\n');
  if (!normalized.includes('  pull_request:')) {
    errors.push(`${dryRunWorkflowPath} must run for pull requests.`);
  }
  if (!normalized.includes('  actions: read') || !normalized.includes('  contents: read')) {
    errors.push(`${dryRunWorkflowPath} must retain read-only workflow permissions.`);
  }
  if (/\bsecrets\s*:|secrets\./.test(normalized)) {
    errors.push(`${dryRunWorkflowPath} must not read, inherit, or pass secrets.`);
  }

  const jobs = parseJobs(dryRunWorkflowPath, normalized, errors);
  validateExpectedJobs(dryRunWorkflowPath, jobs, new Set(['fixture', 'exercise-dry-run']), errors);

  const fixture = jobs.get('fixture');
  if (fixture) {
    const fixtureText = fixture.join('\n');
    requireExactLine(dryRunWorkflowPath, 'fixture', fixture, '    runs-on: ubuntu-slim', 'use hosted ubuntu-slim', errors);
    validateTimeout(dryRunWorkflowPath, 'fixture', fixture, maximumDryRunTimeoutMinutes, errors);
    requireText(dryRunWorkflowPath, 'fixture', fixtureText, `uses: ${actionRefs.checkout}`, 'use the reviewed checkout action', errors);
    requireText(dryRunWorkflowPath, 'fixture', fixtureText, 'node scripts/create-dry-run-package.mjs Artifacts/AppPortal.WorkflowDryRun.0.0.0.nupkg', 'create the minimal package fixture', errors);
    requireText(dryRunWorkflowPath, 'fixture', fixtureText, `uses: ${actionRefs.upload}`, 'use the reviewed upload action', errors);
    requireText(dryRunWorkflowPath, 'fixture', fixtureText, '          name: NuGetDryRun', 'upload the expected artifact name', errors);
  }

  const exercise = jobs.get('exercise-dry-run');
  if (exercise) {
    const exerciseText = exercise.join('\n');
    requireExactLine(dryRunWorkflowPath, 'exercise-dry-run', exercise, '    needs: fixture', 'wait for the fixture artifact', errors);
    requireExactLine(dryRunWorkflowPath, 'exercise-dry-run', exercise, '    uses: ./.github/workflows/deploy-nuget.yml', 'call the reusable workflow from the same commit', errors);
    requireText(dryRunWorkflowPath, 'exercise-dry-run', exerciseText, '      artifact-name: NuGetDryRun', 'download the fixture artifact', errors);
    requireText(dryRunWorkflowPath, 'exercise-dry-run', exerciseText, '      dry-run: true', 'force dry-run mode', errors);
  }
}

export function validateDeployWorkflowPolicy({ deploymentWorkflow, dryRunWorkflow, signingAction }) {
  const errors = [];
  validateActionPins(deploymentWorkflowPath, deploymentWorkflow, errors);
  validateActionPins(dryRunWorkflowPath, dryRunWorkflow, errors);
  validateActionPins(signingActionPath, signingAction, errors);
  validateDeployWorkflow(deploymentWorkflow, errors);
  validateDryRunCaller(dryRunWorkflow, errors);
  return errors;
}

export function readCommittedPolicyFiles(root = repositoryRoot) {
  return {
    deploymentWorkflow: readFileSync(resolve(root, deploymentWorkflowPath), 'utf8'),
    dryRunWorkflow: readFileSync(resolve(root, dryRunWorkflowPath), 'utf8'),
    signingAction: readFileSync(resolve(root, signingActionPath), 'utf8'),
  };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const errors = validateDeployWorkflowPolicy(readCommittedPolicyFiles());
  if (errors.length > 0) {
    console.error('Deployment workflow policy violations:');
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
  } else {
    console.log('Deployment workflow policy passed.');
  }
}
