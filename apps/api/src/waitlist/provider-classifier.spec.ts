import { promises as dns } from 'node:dns';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { classifyProvider, clearProviderClassCache } from './provider-classifier.js';

vi.mock('node:dns', () => ({
  promises: { resolveMx: vi.fn() },
}));

const resolveMx = vi.mocked(dns.resolveMx);

afterEach(() => {
  resolveMx.mockReset();
  clearProviderClassCache();
});

describe('classifyProvider', () => {
  it.each([
    ['person@gmail.com', 'gmail'],
    ['person@googlemail.com', 'gmail'],
    ['person@outlook.com', 'microsoft'],
    ['person@hotmail.com', 'microsoft'],
    ['person@live.com', 'microsoft'],
    ['person@msn.com', 'microsoft'],
    ['person@yahoo.com', 'yahoo_aol'],
    ['person@aol.com', 'yahoo_aol'],
    ['person@ymail.com', 'yahoo_aol'],
    ['person@icloud.com', 'icloud'],
    ['person@me.com', 'icloud'],
    ['person@mac.com', 'icloud'],
  ] as const)('classifies %s as %s without DNS', async (email, expected) => {
    await expect(classifyProvider(email)).resolves.toBe(expected);
    expect(resolveMx).not.toHaveBeenCalled();
  });

  it.each([
    [['aspmx.l.google.com'], 'google_workspace'],
    [['example-com.mail.protection.outlook.com'], 'microsoft'],
    [['mx.yahoodns.net'], 'yahoo_aol'],
    [['mx.icloud.com'], 'icloud'],
    [['mx.example.net'], 'other'],
  ] as const)('classifies MX %j as %s', async (hosts, expected) => {
    resolveMx.mockResolvedValue(hosts.map((exchange) => ({ exchange, priority: 10 })));
    await expect(classifyProvider('person@custom.example')).resolves.toBe(expected);
  });

  it('returns unknown when MX lookup times out', async () => {
    vi.useFakeTimers();
    resolveMx.mockReturnValue(new Promise(() => undefined));
    const pending = classifyProvider('person@slow.example');
    await vi.advanceTimersByTimeAsync(1500);
    await expect(pending).resolves.toBe('unknown');
    vi.useRealTimers();
  });

  it('caches an MX result for the domain', async () => {
    resolveMx.mockResolvedValue([{ exchange: 'mx.example.net', priority: 1 }]);
    await classifyProvider('a@cached.example');
    await classifyProvider('b@cached.example');
    expect(resolveMx).toHaveBeenCalledTimes(1);
  });

  it('never logs the address', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    resolveMx.mockResolvedValue([{ exchange: 'mx.example.net', priority: 1 }]);

    await classifyProvider('secret.person@logged.example');

    const lines = [log, info, warn, error].flatMap((spy) =>
      spy.mock.calls.map((call) => String(call[0])),
    );
    expect(lines.join('\n')).not.toContain('secret.person@logged.example');
    log.mockRestore();
    info.mockRestore();
    warn.mockRestore();
    error.mockRestore();
  });
});
