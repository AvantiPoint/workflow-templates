import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = resolve(repositoryRoot, 'test-assets/dry-run/AppPortal.WorkflowDryRun.0.0.0.nupkg.b64');
const outputPath = resolve(process.argv[2] ?? 'Artifacts/AppPortal.WorkflowDryRun.0.0.0.nupkg');
const encodedPackage = readFileSync(sourcePath, 'utf8').trim();
const packageBytes = Buffer.from(encodedPackage, 'base64');

if (packageBytes.length === 0 || packageBytes.toString('base64') !== encodedPackage) {
  throw new Error('The committed dry-run NuGet fixture is not canonical base64.');
}

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, packageBytes);
console.log(`Created ${outputPath} (${packageBytes.length} bytes).`);
