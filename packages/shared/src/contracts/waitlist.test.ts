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

  describe('source attribution slug', () => {
    const accepted = [
      'pricing',
      'pricing:reddit',
      'landing:product-hunt',
      'blog:news.ycombinator.com',
      'a',
      `x:${'a'.repeat(64)}`,
    ];
    it.each(accepted)('accepts %s', (source) => {
      expect(
        WaitlistJoinRequestSchema.safeParse({ email: 'visitor@example.com', source }).success,
      ).toBe(true);
    });

    // The channel half comes from the visitor's URL, so the schema —
    // not the browser — is what keeps free text out of the column.
    const rejected: ReadonlyArray<readonly [string, string]> = [
      ['whitespace', 'pricing reddit'],
      ['markup', '<script>alert(1)</script>'],
      ['uppercase', 'Pricing'],
      ['a second colon', 'pricing:reddit:extra'],
      ['a trailing colon', 'pricing:'],
      ['a leading colon', ':reddit'],
      ['a leading symbol', '-pricing'],
      ['a slash', 'pricing/reddit'],
      ['a newline', 'pricing\nreddit'],
      ['over 64 chars in a half', 'a'.repeat(65)],
    ];
    it.each(rejected)('rejects %s', (_label, source) => {
      expect(
        WaitlistJoinRequestSchema.safeParse({ email: 'visitor@example.com', source }).success,
      ).toBe(false);
    });
  });
});
