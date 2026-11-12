/**
 * The public Senders demo reaches into product code through four seams.
 * Each is inert in the app and each could do real damage if a second
 * caller appeared: `setApiTransport` reroutes EVERY request the client
 * makes, `StaticAuthProvider` invents an account, `setTrackGate` drops
 * analytics, and `SenderPageNavigationContext` cancels a route change.
 *
 * So this walks the source tree and fails, by name, if anything but the
 * demo uses one. A walk that finds no files has checked nothing, so that
 * fails too.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError, apiGet, setApiTransport } from './client';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEMO = 'features/marketing/inbox-simulator/senders-demo.tsx';

/** Seam → the one file that defines it. Only `DEMO` may also name it. */
const SEAMS: Record<string, string> = {
  setApiTransport: 'lib/api/client.ts',
  StaticAuthProvider: 'features/auth/auth-provider.tsx',
  setTrackGate: 'lib/posthog.ts',
  SenderPageNavigationContext: 'features/senders/use-sender-pane.ts',
};

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry.name) && !/\.(test|stories)\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe('demo-only seams', () => {
  const files = sourceFiles(SRC);

  it('scans the real source tree', () => {
    // Fail closed: a moved file or an empty walk would otherwise pass every case below.
    expect(files.length).toBeGreaterThan(500);
    expect(files).toContain(path.join(SRC, DEMO));
    for (const definer of Object.values(SEAMS)) expect(files).toContain(path.join(SRC, definer));
  });

  it.each(Object.entries(SEAMS))('%s is used by the demo and nothing else', (seam, definer) => {
    const users = files
      .filter((file) => new RegExp(`\\b${seam}\\b`).test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(SRC, file))
      .sort();
    expect(users).toEqual([DEMO, definer].sort());
  });
});

describe('setApiTransport', () => {
  afterEach(() => {
    setApiTransport(null);
    vi.restoreAllMocks();
  });

  const envelope = (data: unknown, status = 200) =>
    new Response(JSON.stringify(status < 400 ? { data } : { error: data }), { status });

  it('leaves the client on global fetch when unset', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(envelope({ ok: true }));
    await expect(apiGet('/api/ping')).resolves.toEqual({ data: { ok: true } });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]![0]).toBe('/api/ping');
    expect(fetchSpy.mock.calls[0]![1]).toMatchObject({ method: 'GET', credentials: 'include' });
  });

  it('sends every request to the transport when set, the session refresh included', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const seen: string[] = [];
    let first = true;
    setApiTransport((async (input: RequestInfo | URL) => {
      seen.push(String(input));
      if (String(input) === '/api/thing' && first) {
        first = false;
        return envelope({ code: 'UNAUTHORIZED' }, 401);
      }
      return envelope({ ok: true });
    }) as typeof fetch);

    await expect(apiGet('/api/thing')).resolves.toEqual({ data: { ok: true } });
    expect(seen).toEqual(['/api/thing', '/api/auth/refresh', '/api/thing']);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('goes back to global fetch once cleared', async () => {
    const transport = vi.fn(async () => envelope({ from: 'transport' }));
    setApiTransport(transport as unknown as typeof fetch);
    setApiTransport(null);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(envelope({ code: 'X' }, 500));
    await expect(apiGet('/api/ping', { networkAttempts: 1 })).rejects.toBeInstanceOf(ApiError);
    expect(transport).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
