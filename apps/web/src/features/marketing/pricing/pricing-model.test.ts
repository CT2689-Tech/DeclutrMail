import { describe, expect, it } from 'vitest';

import {
  CAPABILITIES,
  TIER_IDS,
  TIER_MANIFEST,
  type Capability,
} from '@declutrmail/shared/entitlements';

import {
  CAPABILITY_LABELS,
  cardBullets,
  compareRows,
  currencyForProvider,
  formatInr,
  formatMoney,
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
  it('emits one row per LABEL plus quota rows for the three available tiers', () => {
    const rows = compareRows();
    // Per label, not per capability: `autopilot` and `autopilot-active`
    // share the "Autopilot" label and draw a single row. Derived from
    // the label set rather than pinned to a number, so collapsing or
    // splitting a label later does not need this line edited — and a
    // capability added with no label is still a compile error.
    const distinctLabels = new Set(CAPABILITIES.map((c) => CAPABILITY_LABELS[c]));
    expect(rows).toHaveLength(distinctLabels.size + 3);
    const comparableCount = TIER_IDS.filter((id) => TIER_MANIFEST[id].purchasable).length;
    for (const row of rows) {
      expect(row.values).toHaveLength(comparableCount);
    }
  });

  it('shows the Free monthly cleanup quota from the config, not a literal', () => {
    const cleanupRow = compareRows().find((r) => r.label === CAPABILITY_LABELS['cleanup-actions']);
    const compareIds = TIER_IDS.filter((id) => TIER_MANIFEST[id].purchasable);
    const freeIdx = compareIds.indexOf('free');
    expect(cleanupRow?.values[freeIdx]).toBe(`${TIER_MANIFEST.free.cleanupActionsPerMonth}/month`);
    const proIdx = compareIds.indexOf('pro');
    expect(cleanupRow?.values[proIdx]).toBe('Unlimited');
  });

  it('marks Pro-only capabilities absent on Free and present on Pro', () => {
    const rows = compareRows();
    const briefRow = rows.find((r) => r.label === CAPABILITY_LABELS.brief);
    const compareIds = TIER_IDS.filter((id) => TIER_MANIFEST[id].purchasable);
    expect(briefRow?.values[compareIds.indexOf('free')]).toBeNull();
    expect(briefRow?.values[compareIds.indexOf('pro')]).toBe('Included');
  });

  it('quota rows read inboxLimit/undoWindowDays straight off the manifest', () => {
    const rows = compareRows();
    const inboxRow = rows.find((r) => r.label === 'Connected inboxes');
    const undoRow = rows.find((r) => r.label === 'Activity Undo for Archive, Later, and Delete');
    TIER_IDS.filter((id) => TIER_MANIFEST[id].purchasable).forEach((id, i) => {
      expect(inboxRow?.values[i]).toBe(String(TIER_MANIFEST[id].inboxLimit));
      expect(undoRow?.values[i]).toBe(`${TIER_MANIFEST[id].undoWindowDays} days`);
    });
  });

  it('discloses the Pro-only all-matching selector as its own row', () => {
    const rows = compareRows();
    const selectorRow = rows.find((r) => r.label === 'All-matching cleanup');
    expect(selectorRow).toBeDefined();
    const compareIds = TIER_IDS.filter((id) => TIER_MANIFEST[id].purchasable);
    expect(selectorRow?.values[compareIds.indexOf('free')]).toBeNull();
    expect(selectorRow?.values[compareIds.indexOf('plus')]).toBeNull();
    expect(selectorRow?.values[compareIds.indexOf('pro')]).toBe('Included');
  });
});

describe('cardBullets — manifest-derived card copy', () => {
  it('Free enumerates its surfaces and shows the monthly quota', () => {
    const bullets = cardBullets(TIER_MANIFEST.free);
    expect(bullets).toContain(
      `${TIER_MANIFEST.free.cleanupActionsPerMonth} cleanup actions every month`,
    );
    expect(bullets).toContain(CAPABILITY_LABELS.senders);
  });

  it('Plus stacks on Free: Screener + batch-approval Autopilot + lifted quota (D251)', () => {
    const bullets = cardBullets(TIER_MANIFEST.plus);
    expect(bullets).toContain('Everything in Free');
    // Triage lives in Free now (A3); Plus's added SURFACES are the
    // Screener and rule matching with per-batch approval.
    expect(bullets).not.toContain(CAPABILITY_LABELS.triage);
    expect(bullets).toContain(CAPABILITY_LABELS.screener);
    expect(bullets).toContain(CAPABILITY_LABELS.autopilot);
    expect(bullets).toContain('Unlimited cleanup actions');
  });

  it('Pro adds the attention surfaces and the manifest quota deltas', () => {
    const bullets = cardBullets(TIER_MANIFEST.pro);
    expect(bullets).toContain('Everything in Plus');
    expect(bullets).toContain(CAPABILITY_LABELS.brief);
    expect(bullets).toContain(CAPABILITY_LABELS.followups);
    expect(bullets).toContain(
      `${TIER_MANIFEST.pro.inboxLimit} connected ${TIER_MANIFEST.pro.inboxLimit === 1 ? 'inbox' : 'inboxes'}`,
    );
    // Autopilot in both modes is Plus now, so Pro's card must not
    // re-advertise it as something the upgrade buys.
    expect(bullets).not.toContain(CAPABILITY_LABELS.autopilot);
    expect(bullets).not.toContain(CAPABILITY_LABELS['autopilot-active']);
    expect(bullets).not.toContain(CAPABILITY_LABELS.quiet);
    // The undo window is uniform across the ladder, so it is not a Pro
    // delta and must not appear as one. `cardBullets` only emits a
    // limit line when the value CHANGES — this asserts the silence.
    expect(bullets.some((b) => b.includes('Activity Undo'))).toBe(false);
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

  it('formatMoney picks the manifest field — never converts at runtime', () => {
    const pro = TIER_MANIFEST.pro.prices.annual!;
    expect(formatMoney(pro, 'USD')).toBe(formatUsd(pro.usdCents));
    expect(formatMoney(pro, 'INR')).toBe(formatInr(pro.inrPaise));
    // The two are independently chosen prices, so they must NOT be
    // derivable from one another by any fixed rate.
    expect(formatMoney(pro, 'INR')).not.toBe(formatMoney(pro, 'USD'));
  });

  it('every purchasable price point carries BOTH currencies', () => {
    // A point missing one currency renders "₹NaN" / "$NaN" at checkout
    // for exactly the region that cannot see it in review.
    for (const tier of [TIER_MANIFEST.plus, TIER_MANIFEST.pro]) {
      for (const point of [tier.prices.monthly, tier.prices.annual, tier.promo?.annual]) {
        if (!point) continue;
        expect(Number.isFinite(point.usdCents)).toBe(true);
        expect(Number.isFinite(point.inrPaise)).toBe(true);
        expect(point.inrPaise).toBeGreaterThan(0);
      }
    }
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

  it('draws one comparison row per label, not one per capability', () => {
    const labels = compareRows().map((r) => r.label);
    expect(new Set(labels).size, 'duplicate rows in the comparison table').toBe(labels.length);
    expect(labels).toContain('Autopilot');
  });

  it('never lists the same bullet twice on a card', () => {
    for (const tierId of TIER_IDS) {
      const bullets = cardBullets(TIER_MANIFEST[tierId]);
      expect(new Set(bullets).size, `${tierId} card repeats a bullet`).toBe(bullets.length);
    }
  });
});
