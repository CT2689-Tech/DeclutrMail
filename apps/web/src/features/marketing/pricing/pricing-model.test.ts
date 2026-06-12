import { describe, expect, it } from 'vitest';

import { CAPABILITIES, TIER_IDS, TIER_MANIFEST } from '@declutrmail/shared/entitlements';

import {
  CAPABILITY_LABELS,
  cardBullets,
  compareRows,
  formatUsd,
  foundingProPromo,
  priceLineFor,
  pricingTiers,
} from './pricing-model';

/**
 * Pricing view-model tests (D17 pricing leg, D19 ladder).
 *
 * Single-source discipline: every expectation about a dollar amount or
 * limit is computed FROM `TIER_MANIFEST`, never written as a literal —
 * so a manifest re-price keeps these tests green while proving the
 * page tracks the manifest.
 */

describe('formatUsd', () => {
  it('renders whole dollars without decimals and real cents with two', () => {
    expect(formatUsd(0)).toBe('$0');
    expect(formatUsd(900)).toBe('$9');
    expect(formatUsd(19000)).toBe('$190');
    expect(formatUsd(750)).toBe('$7.50');
  });
});

describe('pricingTiers', () => {
  it('returns all five tiers in manifest (D19 display) order', () => {
    expect(pricingTiers().map((t) => t.id)).toEqual([...TIER_IDS]);
  });
});

describe('priceLineFor — derives every amount from the manifest', () => {
  it('matches the manifest monthly price for each purchasable tier', () => {
    for (const tier of pricingTiers().filter((t) => t.purchasable)) {
      const line = priceLineFor(tier, 'monthly');
      expect(line).not.toBeNull();
      expect(line?.amount).toBe(formatUsd(tier.prices.monthly?.usdCents ?? NaN));
    }
  });

  it('matches the manifest annual price + effective-monthly note', () => {
    for (const tier of pricingTiers().filter((t) => t.prices.annual !== null)) {
      const annual = tier.prices.annual;
      if (!annual) continue;
      const line = priceLineFor(tier, 'annual');
      expect(line?.amount).toBe(formatUsd(annual.usdCents));
      expect(line?.per).toBe('/yr');
      expect(line?.note).toBe(`${formatUsd(Math.round(annual.usdCents / 12))}/mo effective`);
    }
  });

  it('falls back to the monthly point when a tier has no annual price (Free)', () => {
    const free = TIER_MANIFEST.free;
    const line = priceLineFor(free, 'annual');
    expect(line?.amount).toBe(formatUsd(free.prices.monthly?.usdCents ?? NaN));
  });

  it('returns null for tiers with no price at all (team/enterprise)', () => {
    expect(priceLineFor(TIER_MANIFEST.team, 'monthly')).toBeNull();
    expect(priceLineFor(TIER_MANIFEST.enterprise, 'annual')).toBeNull();
  });
});

describe('foundingProPromo', () => {
  it('surfaces the manifest promo with its host tier', () => {
    const found = foundingProPromo();
    expect(found?.promo).toBe(TIER_MANIFEST.pro.promo);
    expect(found?.hostTier.id).toBe('pro');
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
    expect(CAPABILITY_LABELS['cleanup-actions']).toContain('Keep');
    expect(CAPABILITY_LABELS['cleanup-actions']).toContain('Archive');
    expect(CAPABILITY_LABELS['cleanup-actions']).toContain('Unsubscribe');
    expect(CAPABILITY_LABELS['cleanup-actions']).toContain('Later');
    expect(CAPABILITY_LABELS['cleanup-actions']).toContain('Delete');
  });
});

describe('compareRows — derived from the manifest', () => {
  it('emits one row per capability plus the two quota rows, 5 cells each', () => {
    const rows = compareRows();
    expect(rows).toHaveLength(CAPABILITIES.length + 2);
    for (const row of rows) {
      expect(row.values).toHaveLength(TIER_IDS.length);
    }
  });

  it('shows the Free lifetime cleanup quota from the manifest, not a literal', () => {
    const cleanupRow = compareRows().find((r) => r.label === CAPABILITY_LABELS['cleanup-actions']);
    const freeIdx = TIER_IDS.indexOf('free');
    expect(cleanupRow?.values[freeIdx]).toBe(
      `${TIER_MANIFEST.free.cleanupActionsLifetime} lifetime`,
    );
    const proIdx = TIER_IDS.indexOf('pro');
    expect(cleanupRow?.values[proIdx]).toBe('Unlimited');
  });

  it('marks Pro-only capabilities absent on Free and present on Pro', () => {
    const rows = compareRows();
    const briefRow = rows.find((r) => r.label === CAPABILITY_LABELS.brief);
    expect(briefRow?.values[TIER_IDS.indexOf('free')]).toBeNull();
    expect(briefRow?.values[TIER_IDS.indexOf('pro')]).toBe('Included');
  });

  it('quota rows read inboxLimit/undoWindowDays straight off the manifest', () => {
    const rows = compareRows();
    const inboxRow = rows.find((r) => r.label === 'Connected inboxes');
    const undoRow = rows.find((r) => r.label === 'Undo window');
    TIER_IDS.forEach((id, i) => {
      expect(inboxRow?.values[i]).toBe(String(TIER_MANIFEST[id].inboxLimit));
      expect(undoRow?.values[i]).toBe(`${TIER_MANIFEST[id].undoWindowDays} days`);
    });
  });
});

describe('cardBullets — manifest-derived card copy', () => {
  it('Free enumerates its surfaces and shows the lifetime quota', () => {
    const bullets = cardBullets(TIER_MANIFEST.free);
    expect(bullets).toContain(
      `${TIER_MANIFEST.free.cleanupActionsLifetime} lifetime cleanup actions to taste`,
    );
    expect(bullets).toContain(CAPABILITY_LABELS.senders);
  });

  it('Plus stacks on Free and lifts the cleanup quota', () => {
    const bullets = cardBullets(TIER_MANIFEST.plus);
    expect(bullets).toContain('Everything in Free');
    expect(bullets).toContain(CAPABILITY_LABELS.triage);
    expect(bullets).toContain('Unlimited cleanup actions');
  });

  it('Pro adds the automation set and the manifest quota deltas', () => {
    const bullets = cardBullets(TIER_MANIFEST.pro);
    expect(bullets).toContain('Everything in Plus');
    expect(bullets).toContain(CAPABILITY_LABELS.autopilot);
    expect(bullets).toContain(`${TIER_MANIFEST.pro.undoWindowDays}-day undo window`);
    expect(bullets).toContain(
      `${TIER_MANIFEST.pro.inboxLimit} connected ${TIER_MANIFEST.pro.inboxLimit === 1 ? 'inbox' : 'inboxes'}`,
    );
  });
});
