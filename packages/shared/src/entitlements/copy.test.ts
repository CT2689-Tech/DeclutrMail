import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { isPricingV2, promoBanner } from './copy';

describe('isPricingV2', () => {
  const previous = process.env.PRICING_V2;

  function restore(): void {
    if (previous === undefined) delete process.env.PRICING_V2;
    else process.env.PRICING_V2 = previous;
  }

  it('is on only when the server env is the string true', () => {
    delete process.env.PRICING_V2;
    expect(isPricingV2()).toBe(false);
    process.env.PRICING_V2 = 'false';
    expect(isPricingV2()).toBe(false);
    process.env.PRICING_V2 = 'true';
    expect(isPricingV2()).toBe(true);
    restore();
  });

  it('does not read a public Next flag', () => {
    const source = readFileSync(new URL('./copy.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('NEXT_PUBLIC_');
  });
});

describe('promoBanner stub', () => {
  it('stays hidden until the catalog window is wired', () => {
    expect(promoBanner(new Date('2026-10-27T07:01:00Z'))).toBeNull();
  });
});
