import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// The report branch retains an older app tree. A policy on main alone would
// never reach it, so install the policy in the snapshot checkout before push.
export function disableSnapshotPreview(cwd = process.cwd()) {
  const branch = execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
  }).trim();
  if (branch !== 'infra-snapshots') {
    throw new Error(`Refusing to disable deployments on ${branch}; expected infra-snapshots`);
  }
  const target = path.join(cwd, 'apps/web/vercel.json');
  const config = JSON.parse(readFileSync(target, 'utf8'));
  if (config.git?.deploymentEnabled === false) return false;
  config.git = { ...config.git, deploymentEnabled: false };
  writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`);
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const changed = disableSnapshotPreview();
  console.log(`Snapshot preview policy ${changed ? 'installed' : 'already present'}.`);
}
