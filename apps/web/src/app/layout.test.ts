import { describe, expect, it, vi } from 'vitest';

vi.mock('next/font/google', () => ({
  Geist: () => ({ variable: 'font-sans' }),
  Geist_Mono: () => ({ variable: 'font-mono' }),
  Fraunces: () => ({ variable: 'font-display' }),
}));

import { metadata } from './layout';

describe('root layout metadata', () => {
  it('publishes the Bing Webmaster Tools verification token', () => {
    expect(metadata.verification?.other?.['msvalidate.01']).toBe(
      '9DD83ACF317403960E2CC3F5D9181A78',
    );
  });
});
