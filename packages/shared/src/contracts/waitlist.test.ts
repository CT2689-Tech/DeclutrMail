import { describe, expect, it } from 'vitest';

import { TIER_IDS } from '../entitlements/types';
import { WaitlistJoinRequestSchema } from './waitlist';

describe('WaitlistJoinRequestSchema (D19)', () => {
  it('accepts a full payload with any D19 tier', () => {
    for (const tier of TIER_IDS) {
      const parsed = WaitlistJoinRequestSchema.safeParse({
        email: 'visitor@example.com',
        tierInterest: tier,
        source: 'pricing',
      });
      expect(parsed.success).toBe(true);
    }
  });

  it('accepts the generic form (no tierInterest)', () => {
    expect(
      WaitlistJoinRequestSchema.safeParse({ email: 'visitor@example.com', source: 'landing' })
        .success,
    ).toBe(true);
  });

  it('rejects malformed emails, unknown tiers, empty source, extra keys', () => {
    const bad: unknown[] = [
      { email: 'not-an-email', source: 'pricing' },
      { email: 'visitor@example.com', tierInterest: 'mega', source: 'pricing' },
      { email: 'visitor@example.com', source: '' },
      { email: 'visitor@example.com', source: 'pricing', admin: true },
      { source: 'pricing' },
    ];
    for (const payload of bad) {
      expect(WaitlistJoinRequestSchema.safeParse(payload).success).toBe(false);
    }
  });

  it('trims the attribution slug', () => {
    const parsed = WaitlistJoinRequestSchema.parse({
      email: 'visitor@example.com',
      source: '  pricing  ',
    });
    expect(parsed.source).toBe('pricing');
  });
});
