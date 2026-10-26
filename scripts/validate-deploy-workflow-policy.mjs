import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const deploymentWorkflowPath = '.github/workflows/deploy-nuget.yml';
const dryRunWorkflowPath = '.github/workflows/deploy-nuget-dry-run.yml';
const policyWorkflowPath = '.github/workflows/workflow-policy.yml';
const signingActionPath = '.github/actions/sign-packages/action.yml';
const maximumDeployTimeoutMinutes = 10;
const maximumDryRunTimeoutMinutes = 3;
const reviewedDryRunJobSha256 = '29c544e62f2389836ee4da78f16f380eaba37090e451962ad0823a9e19d6fcfa';
const reviewedDeployJobSha256 = '19d827815fcee50b11cd0561e996f1e8430b04394548d50fabc0c4b693efe753';
const reviewedFixtureJobSha256 = '4f489af46520305d8403c27a39642043ee97854abc34ca5b35bbe8144f0adf79';
const reviewedExerciseJobSha256 = 'f8d528f5576eda5b2e04c62037e0f023e3574a62b686c63b2eb13195d296dbe8';
const reviewedSigningActionSha256 = '08196593a3eb2694c449748d1627b8889858cc8d649401c3bc8f9ea7693d57a9';
const reviewedDeploymentWorkflowSha256 = '6f558b9ac5ba0243e5b0bdf09919b5766d7b32a16620a7657029383d11074df0';
const reviewedDryRunWorkflowSha256 = '02557f3171dba0ec9517f45c23cdac683f00278b23fb0a22bd47bd92e5fa0fef';
const reviewedPolicyWorkflowSha256 = 'fc1e98f390194cc28ad27b60cb481fd4f30ecad674d12dbdb52d85cb2dceb6ac';

const actionRefs = {
  checkout: 'actions/checkout@v6',
  download: 'actions/download-artifact@v8',
  login: 'azure/login@v3.1.0',
  publish: 'dansiegel/publish-nuget@v1.2',
  sign: 'avantipoint/workflow-templates/.github/actions/sign-packages@master',
  upload: 'actions/upload-artifact@v7',
};

const expectedUsesByFile = new Map([
  [deploymentWorkflowPath, [
    actionRefs.download,
    actionRefs.download,
    actionRefs.sign,
    actionRefs.publish,
  ]],
  [dryRunWorkflowPath, [
    actionRefs.checkout,
    actionRefs.upload,
    './.github/workflows/deploy-nuget.yml',
  ]],
  [policyWorkflowPath, [
    actionRefs.checkout,
  ]],
  [signingActionPath, [
    actionRefs.login,
  ]],
]);

function parseUsesValue(line) {
  const prefix = line.match(/^\s*(?:-\s*)?uses:\s*(.*)$/);
  if (!prefix) {
    return null;
  }

  const value = prefix[1].match(/^(?:'([^']+)'|"([^"]+)"|([^\s#]+))(?:\s+#.*)?$/);
  return value ? (value[1] ?? value[2] ?? value[3]) : '';
}

function collectUses(path, content, errors) {
  const references = [];

  for (const [index, line] of content.replaceAll('\r\n', '\n').split('\n').entries()) {
    if (line.trimStart().startsWith('#')) {
      continue;
    }

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

    references.push({ line: index + 1, value });
  }
  return references;
}

function validateUsesSequence(path, scope, content, expected, errors, validateReferences = false) {
  const referenceErrors = validateReferences ? errors : [];
  const references = collectUses(path, content, referenceErrors);
  const allowed = new Set(expected);

  if (validateReferences) {
    for (const reference of references) {
      if (!allowed.has(reference.value)) {
        errors.push(`${path}:${reference.line} uses ${reference.value}, which is not in the exact reviewed action allowlist.`);
      }
    }
  }

  const actual = references.map((reference) => reference.value);
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    errors.push(`${path} ${scope} must retain the exact reviewed uses sequence: ${expected.join(', ')}.`);
  }
}

function validateActionPins(path, content, errors) {
  validateUsesSequence(path, 'file', content, expectedUsesByFile.get(path), errors, true);
}

function validateReviewedFileHash(path, content, reviewedSha256, errors) {
  const actual = createHash('sha256').update(content.replaceAll('\r\n', '\n')).digest('hex');
  if (actual !== reviewedSha256) {
    errors.push(`${path} must match the complete reviewed security-critical file.`);
  }
}

function containsSecretsExpression(content) {
  const normalized = content.replaceAll('\r\n', '\n');
  for (const expression of normalized.matchAll(/\$\{\{([\s\S]*?)\}\}/g)) {
    if (/\bsecrets\b/i.test(expression[1])) {
      return true;
    }
  }
  return false;
}

function containsSecretsContext(content) {
  const normalized = content.replaceAll('\r\n', '\n');
  return /^\s*secrets\s*:/im.test(normalized) || containsSecretsExpression(normalized);
}

function contentOutsideJob(content, jobName) {
  const lines = content.replaceAll('\r\n', '\n').split('\n');
  const jobLine = `  ${jobName}:`;
  const jobStart = lines.indexOf(jobLine);
  if (jobStart < 0) {
    return null;
  }

  let jobEnd = lines.length;
  for (let index = jobStart + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^  [A-Za-z0-9_-]+:\s*(?:#.*)?$/.test(line) || (/^\S/.test(line) && line.trim() !== '' && !line.trimStart().startsWith('#'))) {
      jobEnd = index;
      break;
    }
  }
  return [...lines.slice(0, jobStart), ...lines.slice(jobEnd)].join('\n');
}

function validateDryRunPermissions(content, errors) {
  const lines = content.replaceAll('\r\n', '\n').split('\n');
  const permissionIndexes = lines
    .map((line, index) => (/^\s*permissions\s*:/.test(line) ? index : -1))
    .filter((index) => index >= 0);
  if (permissionIndexes.length !== 1 || lines[permissionIndexes[0]] !== 'permissions:') {
    errors.push(`${dryRunWorkflowPath} must define exactly one workflow-level permissions block and no job-level overrides.`);
    return;
  }

  const permissionIndex = permissionIndexes[0];
  let blockEnd = lines.length;
  for (let index = permissionIndex + 1; index < lines.length; index += 1) {
    if (/^\S/.test(lines[index]) && lines[index].trim() !== '' && !lines[index].trimStart().startsWith('#')) {
      blockEnd = index;
      break;
    }
  }
  const entries = lines
    .slice(permissionIndex + 1, blockEnd)
    .filter((line) => line.trim() !== '' && !line.trimStart().startsWith('#'));
  const expectedEntries = ['  actions: read', '  contents: read'];
  if (entries.length !== expectedEntries.length || entries.some((line, index) => line !== expectedEntries[index])) {
    errors.push(`${dryRunWorkflowPath} permissions must allow only actions: read and contents: read.`);
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

  const outsideDeployJob = contentOutsideJob(normalized, 'deploy');
  if (outsideDeployJob === null || containsSecretsExpression(outsideDeployJob)) {
    errors.push(`${deploymentWorkflowPath} must not reference the secrets context outside the real deploy job.`);
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
    validateUsesSequence(deploymentWorkflowPath, 'job dry-run', dryRunText, [actionRefs.download], errors);
    requireText(deploymentWorkflowPath, 'dry-run', dryRunText, `uses: ${actionRefs.download}`, 'download the selected artifact with the reviewed action', errors);
    requireText(deploymentWorkflowPath, 'dry-run', dryRunText, 'Inspect NuGet packages without credentials', 'inspect NuGet package structure', errors);
    requireText(deploymentWorkflowPath, 'dry-run', dryRunText, 'centralDirectoryEntries(bytes)', 'validate the ZIP central directory', errors);
    if (containsSecretsContext(dryRunText)) {
      errors.push(`${deploymentWorkflowPath} job dry-run must not read or declare secrets.`);
    }
    if (dryRunText.includes(actionRefs.sign) || dryRunText.includes(actionRefs.publish)) {
      errors.push(`${deploymentWorkflowPath} job dry-run must not contain signing or publication actions.`);
    }
  }

  const deploy = jobs.get('deploy');
  if (deploy) {
    const deployText = deploy.join('\n');
    const deployHash = createHash('sha256').update(deployText).digest('hex');
    if (deployHash !== reviewedDeployJobSha256) {
      errors.push(`${deploymentWorkflowPath} job deploy must match the reviewed fail-closed signing and publication implementation.`);
    }
    requireExactLine(deploymentWorkflowPath, 'deploy', deploy, '    if: ${{ ! inputs.dry-run }}', 'run only when dry-run is false', errors);
    requireExactLine(deploymentWorkflowPath, 'deploy', deploy, '    runs-on: windows-latest', 'use the hosted windows-latest signing runner', errors);
    validateTimeout(deploymentWorkflowPath, 'deploy', deploy, maximumDeployTimeoutMinutes, errors);
    validateUsesSequence(
      deploymentWorkflowPath,
      'job deploy',
      deployText,
      [actionRefs.download, actionRefs.sign, actionRefs.publish],
      errors,
    );
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
  validateDryRunPermissions(normalized, errors);
  if (containsSecretsContext(normalized)) {
    errors.push(`${dryRunWorkflowPath} must not read, inherit, or pass secrets.`);
  }

  const jobs = parseJobs(dryRunWorkflowPath, normalized, errors);
  validateExpectedJobs(dryRunWorkflowPath, jobs, new Set(['fixture', 'exercise-dry-run']), errors);

  const fixture = jobs.get('fixture');
  if (fixture) {
    const fixtureText = fixture.join('\n');
    const fixtureHash = createHash('sha256').update(fixtureText).digest('hex');
    if (fixtureHash !== reviewedFixtureJobSha256) {
      errors.push(`${dryRunWorkflowPath} job fixture must match the reviewed artifact-creation implementation.`);
    }
    requireExactLine(dryRunWorkflowPath, 'fixture', fixture, '    runs-on: ubuntu-slim', 'use hosted ubuntu-slim', errors);
    validateTimeout(dryRunWorkflowPath, 'fixture', fixture, maximumDryRunTimeoutMinutes, errors);
    validateUsesSequence(dryRunWorkflowPath, 'job fixture', fixtureText, [actionRefs.checkout, actionRefs.upload], errors);
    requireText(dryRunWorkflowPath, 'fixture', fixtureText, `uses: ${actionRefs.checkout}`, 'use the reviewed checkout action', errors);
    requireText(dryRunWorkflowPath, 'fixture', fixtureText, 'node scripts/create-dry-run-package.mjs Artifacts/AppPortal.WorkflowDryRun.0.0.0.nupkg', 'create the minimal package fixture', errors);
    requireText(dryRunWorkflowPath, 'fixture', fixtureText, `uses: ${actionRefs.upload}`, 'use the reviewed upload action', errors);
    requireText(dryRunWorkflowPath, 'fixture', fixtureText, '          name: NuGetDryRun', 'upload the expected artifact name', errors);
  }

  const exercise = jobs.get('exercise-dry-run');
  if (exercise) {
    const exerciseText = exercise.join('\n');
    const exerciseHash = createHash('sha256').update(exerciseText).digest('hex');
    if (exerciseHash !== reviewedExerciseJobSha256) {
      errors.push(`${dryRunWorkflowPath} job exercise-dry-run must match the reviewed same-commit invocation.`);
    }
    requireExactLine(dryRunWorkflowPath, 'exercise-dry-run', exercise, '    needs: fixture', 'wait for the fixture artifact', errors);
    requireExactLine(dryRunWorkflowPath, 'exercise-dry-run', exercise, '    uses: ./.github/workflows/deploy-nuget.yml', 'call the reusable workflow from the same commit', errors);
    validateUsesSequence(
      dryRunWorkflowPath,
      'job exercise-dry-run',
      exerciseText,
      ['./.github/workflows/deploy-nuget.yml'],
      errors,
    );
    requireText(dryRunWorkflowPath, 'exercise-dry-run', exerciseText, '      artifact-name: NuGetDryRun', 'download the fixture artifact', errors);
    requireText(dryRunWorkflowPath, 'exercise-dry-run', exerciseText, '      dry-run: true', 'force dry-run mode', errors);
  }
}

export function validateDeployWorkflowPolicy({ deploymentWorkflow, dryRunWorkflow, policyWorkflow, signingAction }) {
  const errors = [];
  validateReviewedFileHash(deploymentWorkflowPath, deploymentWorkflow, reviewedDeploymentWorkflowSha256, errors);
  validateReviewedFileHash(dryRunWorkflowPath, dryRunWorkflow, reviewedDryRunWorkflowSha256, errors);
  validateReviewedFileHash(policyWorkflowPath, policyWorkflow, reviewedPolicyWorkflowSha256, errors);
  validateReviewedFileHash(signingActionPath, signingAction, reviewedSigningActionSha256, errors);
  validateActionPins(deploymentWorkflowPath, deploymentWorkflow, errors);
  validateActionPins(dryRunWorkflowPath, dryRunWorkflow, errors);
  validateActionPins(policyWorkflowPath, policyWorkflow, errors);
  validateActionPins(signingActionPath, signingAction, errors);
  validateDeployWorkflow(deploymentWorkflow, errors);
  validateDryRunCaller(dryRunWorkflow, errors);
  return errors;
}

export function readCommittedPolicyFiles(root = repositoryRoot) {
  return {
    deploymentWorkflow: readFileSync(resolve(root, deploymentWorkflowPath), 'utf8'),
    dryRunWorkflow: readFileSync(resolve(root, dryRunWorkflowPath), 'utf8'),
    policyWorkflow: readFileSync(resolve(root, policyWorkflowPath), 'utf8'),
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
