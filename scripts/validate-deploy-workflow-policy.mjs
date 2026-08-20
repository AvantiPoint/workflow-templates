import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const deploymentWorkflowPath = '.github/workflows/deploy-nuget.yml';
const signingActionPath = '.github/actions/sign-packages/action.yml';
const maximumDeployTimeoutMinutes = 10;

const expectedActions = new Map([
  [deploymentWorkflowPath, new Set([
    'actions/download-artifact',
    'avantipoint/workflow-templates/.github/actions/sign-packages',
    'dansiegel/publish-nuget',
  ])],
  [signingActionPath, new Set([
    'azure/login',
  ])],
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
  const found = new Set();

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
}

function validateDeployJob(content, errors) {
  const lines = content.replaceAll('\r\n', '\n').split('\n');
  const jobsIndexes = lines
    .map((line, index) => (line === 'jobs:' ? index : -1))
    .filter((index) => index >= 0);
  if (jobsIndexes.length !== 1) {
    errors.push(`${deploymentWorkflowPath} must define local jobs.`);
    return;
  }

  const jobsIndex = jobsIndexes[0];
  const jobs = [];
  let jobsEnd = lines.length;
  for (let index = jobsIndex + 1; index < lines.length; index += 1) {
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

  if (jobs.length === 0) {
    errors.push(`${deploymentWorkflowPath} must define at least one local job.`);
    return;
  }

  if (!jobs.some(({ name }) => name === 'deploy')) {
    errors.push(`${deploymentWorkflowPath} must retain the deploy job.`);
  }

  for (const job of jobs) {
    const block = lines.slice(job.start + 1, job.end);
    const timeoutLines = block.filter((line) => /^    timeout-minutes:/.test(line));
    if (timeoutLines.length !== 1) {
      errors.push(`${deploymentWorkflowPath} job ${job.name} must set exactly one integer timeout-minutes.`);
      continue;
    }

    const timeout = timeoutLines[0].match(/^    timeout-minutes:\s*(\d+)\s*(?:#.*)?$/);
    if (!timeout) {
      errors.push(`${deploymentWorkflowPath} job ${job.name} timeout-minutes must be an integer.`);
      continue;
    }

    const timeoutMinutes = Number.parseInt(timeout[1], 10);
    if (timeoutMinutes < 1 || timeoutMinutes > maximumDeployTimeoutMinutes) {
      errors.push(
        `${deploymentWorkflowPath} job ${job.name} timeout-minutes must be between 1 and ${maximumDeployTimeoutMinutes}; found ${timeoutMinutes}.`,
      );
    }

    if (job.name === 'deploy') {
      const runners = block.filter((line) => /^    runs-on:/.test(line));
      if (runners.length !== 1 || runners[0] !== '    runs-on: windows-latest') {
        errors.push(`${deploymentWorkflowPath} job deploy must use the hosted windows-latest signing runner.`);
      }
    }
  }
}

export function validateDeployWorkflowPolicy({ deploymentWorkflow, signingAction }) {
  const errors = [];
  validateActionPins(deploymentWorkflowPath, deploymentWorkflow, errors);
  validateActionPins(signingActionPath, signingAction, errors);
  validateDeployJob(deploymentWorkflow, errors);
  return errors;
}

export function readCommittedPolicyFiles(root = repositoryRoot) {
  return {
    deploymentWorkflow: readFileSync(resolve(root, deploymentWorkflowPath), 'utf8'),
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
