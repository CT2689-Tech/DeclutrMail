import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from 'node:net';
import { runDeadline } from './ci-command-deadline.mjs';

test('returns the command exit code, including failures and missing commands', async () => {
  for (const code of [0, 7]) {
    assert.equal(
      await runDeadline(process.execPath, ['-e', `process.exit(${code})`], {
        timeoutMs: 3000,
        killAfterMs: 100,
        stdio: 'ignore',
      }),
      code,
    );
  }
  assert.equal(
    await runDeadline('/nonexistent/declutr-test-command', [], {
      timeoutMs: 3000,
      killAfterMs: 100,
      stdio: 'ignore',
    }),
    127,
  );
});

test('invalid deadlines never start a command', async () => {
  for (const timeoutMs of [0, -1, Number.NaN, 0.1]) {
    await assert.rejects(runDeadline(process.execPath, [], { timeoutMs, killAfterMs: 100 }));
  }
});

test('timeout cleans a TERM-resistant descendant after its parent exits', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'declutr-deadline-'));
  const marker = join(dir, 'worker.json');
  let pid;
  const worker = `const net=require('node:net'),fs=require('node:fs');process.on('SIGTERM',()=>{});const s=net.createServer();s.listen(0,'127.0.0.1',()=>fs.writeFileSync(process.argv[1],JSON.stringify({pid:process.pid,port:s.address().port})));setTimeout(()=>process.exit(),10000);`;
  const parent = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(worker)},${JSON.stringify(marker)}],{stdio:'ignore'});process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000);`;
  try {
    const result = await runDeadline(process.execPath, ['-e', parent], {
      timeoutMs: 1500,
      killAfterMs: 100,
      stdio: 'ignore',
    });
    const data = JSON.parse(readFileSync(marker, 'utf8'));
    pid = data.pid;
    assert.equal(result, 124);
    const resourceHeld = await new Promise((done) => {
      const socket = connect(data.port, '127.0.0.1');
      socket.once('connect', () => {
        socket.destroy();
        done(true);
      });
      socket.once('error', () => done(false));
    });
    assert.equal(resourceHeld, false, 'a retry must not inherit a live child holding a resource');
  } finally {
    if (pid) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch (error) {
        assert.equal(error.code, 'ESRCH');
      }
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
