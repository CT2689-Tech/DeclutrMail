import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

/** Real production loader order, empty runtime credentials and owned loopback.
 * Missing DATABASE_URL makes both normal controls fail before client creation. */
async function fixture(
  held: string | undefined,
  check: (f: { child: ChildProcess; port: number; output: () => string }) => Promise<void>,
): Promise<void> {
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const address = listener.address();
  if (!address || typeof address === 'string') throw new Error('Missing owned worker port');
  await new Promise<void>((r, reject) => listener.close((e) => (e ? reject(e) : r())));
  const child = spawn(
    process.execPath,
    [
      '--enable-source-maps',
      '--import',
      '@sentry/node/import',
      '--import',
      '@swc-node/register/esm-register',
      'src/worker.ts',
    ],
    {
      cwd: resolve(import.meta.dirname, '../..'),
      env: {
        PATH: process.env.PATH ?? '',
        // @swc/core 1.16 materializes its native addon into a user cache
        // and will not load the production register without HOME. This is
        // the loader, not a product credential.
        ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
        NODE_ENV: 'test',
        PORT: String(address.port),
        WORKER_SENTRY_ENABLED: 'false',
        ...(held === undefined ? {} : { WORKER_ADMISSION_HELD: held }),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let output = '';
  const capture = (data: Buffer) => {
    output = (output + data.toString()).slice(-32_768);
  };
  child.stdout!.on('data', capture);
  child.stderr!.on('data', capture);
  const exited = once(child, 'exit');
  try {
    await check({ child, port: address.port, output: () => output });
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 5_000);
    try {
      await exited;
    } finally {
      clearTimeout(timer);
    }
  }
}

it('HELD provides labeled health without bootstrap, enrollment or any work', async () => {
  await fixture('true', async ({ child, port, output }) => {
    const until = Date.now() + 20_000;
    let response: Response | undefined;
    while (!response) {
      try {
        response = await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(1_000) });
      } catch {
        if (child.exitCode !== null || Date.now() >= until)
          throw new Error('Held worker did not listen');
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('admission-held');
    expect(output()).toContain('worker.admission_held');
    expect(output()).not.toMatch(
      /worker\.boot\.|worker\.listening|worker\.started|runtime_polling/,
    );
    const exit = once(child, 'exit');
    child.kill('SIGTERM');
    const [code, signal] = await exit;
    expect(code).toBeNull();
    expect(signal).toBe('SIGTERM');
  });
});

it.each([undefined, 'false'])(
  'normal startup %s retains fail-closed missing-credential behavior',
  async (held) => {
    await fixture(held, async ({ child, output }) => {
      const [code] = await once(child, 'exit');
      expect(code).toBe(1);
      expect(output()).toContain('worker.boot_failed');
      expect(output()).toContain('DATABASE_URL');
      expect(output()).not.toContain('worker.admission_held');
      expect(output()).not.toContain('worker.listening');
    });
  },
);

it.each(['', 'TRUE', '1'])('malformed admission hold %s refuses before bootstrap', async (held) => {
  await fixture(held, async ({ child, output }) => {
    const [code] = await once(child, 'exit');
    expect(code).toBe(1);
    expect(output()).toContain('worker.admission_configuration_invalid');
    expect(output()).not.toMatch(/worker\.boot\.|worker\.health_listening|worker\.admission_held/);
  });
});
