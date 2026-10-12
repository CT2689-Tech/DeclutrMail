import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/font/google', () => ({
  Geist: () => ({ variable: 'font-sans' }),
  Geist_Mono: () => ({ variable: 'font-mono' }),
  Fraunces: () => ({ variable: 'font-display' }),
}));

import { metadata } from './layout';

describe('root layout metadata', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('publishes the Bing Webmaster Tools verification token', () => {
    expect(metadata.verification?.other?.['msvalidate.01']).toBe(
      '9DD83ACF317403960E2CC3F5D9181A78',
    );
  });

  it('publishes meta name build-sha from the short VERCEL_GIT_COMMIT_SHA', async () => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', '0123456789abcdef0123456789abcdef01234567');
    vi.resetModules();
    const { metadata: loaded } = await import('./layout');
    expect(loaded.other?.['build-sha']).toBe('0123456');
  });

  it('leaves build-sha empty when the commit SHA is absent or not a SHA', async () => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', '');
    vi.resetModules();
    const absent = await import('./layout');
    expect(absent.metadata.other?.['build-sha']).toBe('');

    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'not-a-commit');
    vi.resetModules();
    const rejected = await import('./layout');
    expect(rejected.metadata.other?.['build-sha']).toBe('');
  });
});
