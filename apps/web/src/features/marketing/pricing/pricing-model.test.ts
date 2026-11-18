import { describe, expect, it } from 'vitest';

import {
  CAPABILITIES,
  OFFERS,
  PLUS_ANNUAL_2026_10,
  TIER_IDS,
  TIER_MANIFEST,
  type Capability,
} from '@declutrmail/shared/entitlements';

import {
  CAPABILITY_LABELS,
  currencyForPricePoint,
  currencyForProvider,
  formatInr,
  formatMoney,
  formatUsd,
  TIER_JOBS,
} from './pricing-model';

/**
 * Pricing helper tests (D17 pricing leg, D19 ladder).
 *
 * Single-source discipline: every expectation about a dollar amount is
 * computed FROM the pricing config, never written as a literal — so a
 * re-price keeps these tests green while proving the helpers track it.
 */

describe('formatUsd', () => {
  it('renders whole dollars without decimals and real cents with two', () => {
    expect(formatUsd(0)).toBe('$0');
    expect(formatUsd(900)).toBe('$9');
    expect(formatUsd(19000)).toBe('$190');
    expect(formatUsd(750)).toBe('$7.50');
  });
});

describe('CAPABILITY_LABELS — D227 verb language', () => {
  it('labels every manifest capability (exhaustive by construction)', () => {
    for (const capability of CAPABILITIES) {
      expect(CAPABILITY_LABELS[capability]).toBeTruthy();
    }
  });

  it('uses only K/A/U/L/D verbs; "Screen" never appears as a standalone word', () => {
    for (const label of Object.values(CAPABILITY_LABELS)) {
      // "Screener" (the feature name) is allowed; the bare internal
      // verdict "Screen" is banned on product surfaces (§2.2).
      expect(label).not.toMatch(/\bScreen\b(?!er)/);
    }
    expect(CAPABILITY_LABELS['cleanup-actions']).toBe(
      'Choices for each sender \u2014 Archive \u00b7 Unsubscribe \u00b7 Later \u00b7 Delete',
    );
    expect(CAPABILITY_LABELS['cleanup-actions']).not.toContain('Keep');
    expect(CAPABILITY_LABELS['cleanup-actions']).not.toContain('Cleanup actions');
  });
});

describe('currency (D117)', () => {
  it('the provider decides the currency — it is a charge fact, not a preference', () => {
    expect(currencyForProvider('paddle')).toBe('USD');
    expect(currencyForProvider('razorpay')).toBe('INR');
  });

  it('formats INR with Indian digit grouping', () => {
    expect(formatInr(74_900)).toBe('₹749');
    // Past 1,00,000 paise-to-rupees, en-IN groups by lakh — ₹1,09,999,
    // NOT the western ₹109,999.
    expect(formatInr(1_099_900)).toBe('₹10,999');
    expect(formatInr(10_999_900)).toBe('₹1,09,999');
  });

  it('formatMoney picks the config field — never converts at runtime', () => {
    const plus = PLUS_ANNUAL_2026_10;
    expect(formatMoney(plus, 'USD')).toBe(formatUsd(plus.usdCents));
    expect(formatMoney(plus, 'INR')).toBe(formatInr(plus.inrPaise));
    // The two are independently chosen prices, so they must NOT be
    // derivable from one another by any fixed rate.
    expect(formatMoney(plus, 'INR')).not.toBe(formatMoney(plus, 'USD'));
  });

  it('every launch price point carries BOTH currencies', () => {
    // A point missing one currency renders "₹NaN" / "$NaN" at checkout
    // for exactly the region that cannot see it in review.
    for (const point of [PLUS_ANNUAL_2026_10, OFFERS.backlogPass.price]) {
      expect(Number.isFinite(point.usdCents)).toBe(true);
      expect(Number.isFinite(point.inrPaise)).toBe(true);
      expect(point.inrPaise).toBeGreaterThan(0);
    }
  });

  it('quotes INR only to an India visitor while India checkout is open', () => {
    const india = { country: 'IN', indiaCheckoutOpen: true } as const;
    const free = { usdCents: 0, inrPaise: 0, razorpayPlanId: null };
    expect(currencyForPricePoint(PLUS_ANNUAL_2026_10, 'paddle', india)).toBe('INR');
    expect(currencyForPricePoint(free, 'paddle', india)).toBe('INR');
    expect(
      currencyForPricePoint(PLUS_ANNUAL_2026_10, 'paddle', { ...india, indiaCheckoutOpen: false }),
    ).toBe('USD');
    expect(currencyForPricePoint(PLUS_ANNUAL_2026_10, 'paddle', { ...india, country: 'US' })).toBe(
      'USD',
    );
    expect(currencyForPricePoint(PLUS_ANNUAL_2026_10, 'paddle')).toBe('USD');
  });

  it('keeps a paid point with no INR amount in USD instead of quoting ₹0', () => {
    const usdOnly = { usdCents: 900, inrPaise: 0, razorpayPlanId: null };
    expect(
      currencyForPricePoint(usdOnly, 'paddle', { country: 'IN', indiaCheckoutOpen: true }),
    ).toBe('USD');
  });
});

describe('shared capability labels', () => {
  /**
   * `autopilot` and `autopilot-active` deliberately share the label
   * "Autopilot", so the comparison table draws ONE row for them.
   *
   * That collapse is only honest while every tier grants them together.
   * If a future re-tier gave a plan one without the other, the single
   * row would tick "Included" off whichever capability the map reached
   * first and quietly over-promise the other — the exact class of
   * false-but-plausible pricing copy this suite exists to catch.
   *
   * So the invariant is enforced rather than remembered: sharing a
   * label REQUIRES identical grants. Splitting the tiers fails here and
   * forces the label decision at that moment.
   */
  it('capabilities sharing a label are granted identically on every tier', () => {
    const byLabel = new Map<string, Capability[]>();
    for (const capability of CAPABILITIES) {
      const label = CAPABILITY_LABELS[capability];
      byLabel.set(label, [...(byLabel.get(label) ?? []), capability]);
    }

    for (const [label, capabilities] of byLabel) {
      if (capabilities.length < 2) continue;
      for (const tierId of TIER_IDS) {
        const granted = capabilities.filter((c) => TIER_MANIFEST[tierId].capabilities.includes(c));
        expect(
          granted.length === 0 || granted.length === capabilities.length,
          `${tierId} grants ${granted.join(', ')} but not all of "${label}" (${capabilities.join(', ')}) — ` +
            'they cannot share one comparison row while they differ by tier',
        ).toBe(true);
      }
    }
  });
});

describe('TIER_JOBS — one-line pitch per tier', () => {
  it('names a concrete Pro capability instead of restating the tagline', () => {
    expect(TIER_JOBS.pro).not.toBe('See what matters, across every account.');
    expect(TIER_JOBS.pro.toLowerCase()).toMatch(/brief|follow-up/);
  });
});
