import { afterEach, describe, expect, it, vi } from 'vitest';

// The config is evaluated at import time (the Capacitor CLI imports it), so
// every case re-imports it under a fresh CAP_SERVER_URL.
async function load(url: string) {
  vi.resetModules();
  vi.stubEnv('CAP_SERVER_URL', url);
  return (await import('./capacitor.config')).default;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('capacitor.config', () => {
  it('refuses to build without CAP_SERVER_URL', async () => {
    await expect(load('')).rejects.toThrow(/CAP_SERVER_URL is not set/);
  });

  it('refuses a value that is not a URL', async () => {
    await expect(load('192.168.1.20:3000')).rejects.toThrow(/CAP_SERVER_URL/);
  });

  it('loads an https server with cleartext off and the offline page wired', async () => {
    const config = await load('https://app.example.com');
    expect(config.server).toMatchObject({
      url: 'https://app.example.com/',
      cleartext: false,
      errorPath: 'index.html',
    });
  });

  it.each([
    'http://localhost:3000',
    'http://10.0.2.2:3000',
    'http://192.168.1.20:3000',
    'http://172.16.0.5:3000',
    'http://172.31.255.1:3000',
    'http://my-mac.local:3000',
  ])('allows http for the dev host %s and enables cleartext', async (url) => {
    const config = await load(url);
    expect(config.server?.cleartext).toBe(true);
  });

  // Hosts that look private to a substring or unanchored match but are not.
  it.each([
    'http://app.example.com',
    'http://192.168.1.1.evil.com',
    'http://localhost.evil.com',
    'http://evil.com/192.168.1.1',
    'http://10.0.2.2@evil.com:3000',
    'http://172.32.0.1:3000',
    'http://11.0.0.1:3000',
  ])('refuses plain http to %s', async (url) => {
    await expect(load(url)).rejects.toThrow(/Plain http to a public host is never allowed/);
  });

  it.each(['ftp://192.168.1.20', 'capacitor://localhost'])(
    'refuses the scheme in %s',
    async (url) => {
      await expect(load(url)).rejects.toThrow(/must be https/);
    },
  );
});
