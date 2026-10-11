import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  isPricingV2,
  meterChipLine,
  meterPreviewText,
  promoBanner,
  quotaUnitsForEnqueue,
  suggestedWindowPreset,
} from './copy';

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

describe('emails-cleared meter helpers', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('stamps free archive and delete emails only while the meter is on', () => {
    expect(quotaUnitsForEnqueue({ tier: 'free', verb: 'archive', requestedCount: 12 })).toBe(0);
    vi.stubEnv('METER_V2', 'true');
    expect(quotaUnitsForEnqueue({ tier: 'free', verb: 'archive', requestedCount: 12 })).toBe(12);
    expect(quotaUnitsForEnqueue({ tier: 'free', verb: 'delete', requestedCount: 3 })).toBe(3);
    expect(quotaUnitsForEnqueue({ tier: 'plus', verb: 'delete', requestedCount: 12 })).toBe(0);
    expect(quotaUnitsForEnqueue({ tier: 'free', verb: 'unsubscribe', requestedCount: 2 })).toBe(0);
    expect(quotaUnitsForEnqueue({ tier: 'free', verb: 'later', requestedCount: 4 })).toBe(0);
    expect(quotaUnitsForEnqueue({ tier: 'free', verb: 'keep', requestedCount: 4 })).toBe(0);
  });

  it('picks the largest window whose preview count fits', () => {
    expect(suggestedWindowPreset(100, { 30: 80, 90: 400, 180: 1200, 365: 2708 })).toBe(30);
    expect(suggestedWindowPreset(500, { 30: 80, 90: 400, 180: 1200, 365: 2708 })).toBe(90);
    expect(suggestedWindowPreset(10, { 30: 80, 90: 0 })).toBeNull();
  });

  it('fills the chip and preview from the deck', () => {
    expect(
      meterChipLine({ remaining: 640, limit: 1000, resetAt: '2026-11-09T00:00:00.000Z' }).text,
    ).toBe('640 of 1,000 free emails left \u00b7 resets Nov 9');
    expect(meterPreviewText(2708, 100)).toBe(
      'This clears 2,708 emails. You have 100 free left this month.',
    );
    expect(meterPreviewText(1, 100)).toBe('This clears 1 email. You have 100 free this month.');
  });
});

describe('promoBanner stub', () => {
  it('stays hidden until the catalog window is wired', () => {
    expect(promoBanner(new Date('2026-10-27T07:01:00Z'))).toBeNull();
  });
});
