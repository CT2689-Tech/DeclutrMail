import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function runDeadline(command, args, { timeoutMs, killAfterMs, stdio = 'inherit' }) {
  if (![timeoutMs, killAfterMs].every((n) => Number.isSafeInteger(n) && n > 0)) {
    throw new Error('Deadline and cleanup grace must be positive integer milliseconds');
  }
  if (process.platform === 'win32') throw new Error('CI deadlines require POSIX process groups');
  const child = spawn(command, args, { detached: true, stdio });
  let expired = false;
  let interrupted;
  let cleanup;
  function signalGroup(signal) {
    if (!child.pid) return false;
    try {
      process.kill(-child.pid, signal);
      return true;
    } catch (error) {
      if (error.code === 'ESRCH') return false;
      throw error;
    }
  }
  function stopGroup() {
    cleanup ??= (async () => {
      if (!signalGroup('SIGTERM')) return;
      // Keep the watchdog alive even if the immediate command exits on TERM.
      // Its descendants can still hold a package-manager lock after that exit.
      await new Promise((done) => setTimeout(done, killAfterMs));
      signalGroup('SIGKILL');
      for (let attempt = 0; attempt < 50; attempt++) {
        if (!signalGroup(0)) return;
        await new Promise((done) => setTimeout(done, 20));
      }
      throw new Error('CI command process group remained after forced cleanup');
    })();
    return cleanup;
  }
  return await new Promise((done, reject) => {
    let settled = false;
    async function finish(code) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        await stopGroup();
        done(interrupted ?? (expired ? 124 : code));
      } catch (error) {
        reject(error);
      } finally {
        process.off('SIGINT', onInterrupt);
        process.off('SIGTERM', onTerminate);
      }
    }
    function stop(code) {
      interrupted = code;
      void stopGroup().catch(() => finish(1));
    }
    const onInterrupt = () => stop(130);
    const onTerminate = () => stop(143);
    process.once('SIGINT', onInterrupt);
    process.once('SIGTERM', onTerminate);
    const timer = setTimeout(() => {
      expired = true;
      void stopGroup().catch(() => finish(1));
    }, timeoutMs);
    child.once('error', () => void finish(127));
    child.once('close', (code, signal) => void finish(code ?? (signal === 'SIGKILL' ? 137 : 1)));
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [timeoutMs, killAfterMs, command, ...args] = process.argv.slice(2);
  try {
    if (!command) throw new Error('Expected timeoutMs killAfterMs command [args...]');
    process.exitCode = await runDeadline(command, args, {
      timeoutMs: Number(timeoutMs),
      killAfterMs: Number(killAfterMs),
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
