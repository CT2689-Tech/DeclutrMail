import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { prepareStackWorkspace, stackCommands, stackEnvironment } from './isolated-stack.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const env = stackEnvironment(process.env);
const root = prepareStackWorkspace(repoRoot);
const children = new Set();
let stopping = false;
let exitCode = 0;
let killTimer;

function cleanup() {
  clearTimeout(killTimer);
  rmSync(root, { recursive: true, force: true });
  process.exitCode = exitCode;
}
function stop(code) {
  if (stopping) return;
  stopping = true;
  exitCode = code;
  for (const child of children) child.kill('SIGTERM');
  // A failed child must not leave its sibling or temporary files behind.
  killTimer = setTimeout(() => {
    for (const child of children) child.kill('SIGKILL');
  }, 10_000);
  killTimer.unref();
  if (children.size === 0) cleanup();
}
process.once('SIGINT', () => stop(0));
process.once('SIGTERM', () => stop(0));

console.log(`Isolated app copies: ${root}`);
console.log(`API: ${env.E2E_API_URL} | Web: ${env.E2E_WEB_URL}`);
console.log(
  'Source snapshot only; restart after edits. No worker is started. Ctrl-C removes the copies.',
);
for (const command of stackCommands(root, env)) {
  const child = spawn(process.execPath, command.args, {
    cwd: command.cwd,
    env: command.env,
    stdio: 'inherit',
  });
  children.add(child);
  child.once('error', () => {
    console.error(`${command.name} could not start.`);
    stop(1);
  });
  child.once('close', (code) => {
    children.delete(child);
    if (!stopping) {
      console.error(`${command.name} exited; stopping the isolated stack.`);
      stop(code || 1);
    }
    if (children.size === 0) cleanup();
  });
}
