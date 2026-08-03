import { describe, expect, it } from 'vitest';

import { ACTION_REGISTRY, listActionDescriptors } from '../actions/manifest-entries';
import { ACTION_TIERS, SELECTOR_TYPES } from '../contracts/verb-constants';
import { COUNTS_AS_CLEANUP, SELECTOR_CAPS, SELECTOR_TIERS, TIER_MANIFEST } from './pricing.config';
import {
  cleanupActionsPerMonthFor,
  hasCapability,
  inboxLimitFor,
  minimumTierForCapability,
  satisfiesActionTier,
  tierById,
  undoWindowDaysFor,
} from './resolve';
import type { Capability, TierId } from './types';
import { CAPABILITIES, TIER_IDS, TIER_RANK } from './types';

/**
 * Pricing-config tests (D19/A3) — Leak-3 discipline: exactly ONE
 * deliberately-pinned snapshot as the change tripwire, and everything
 * else an INVARIANT that holds under any tuning. Moving a capability,
 * changing a price or retiering a selector edits pricing.config.ts and
 * the snapshot below — never a scattered test.
 */
describe('Pricing config — the pinned snapshot (change tripwire)', () => {
  // Editing the config on purpose? Update this snapshot in the same
  // commit and say why in the commit body. Any other diff here is
  // silent drift.
  it('pins the entire launch ladder', () => {
    const tiers = Object.fromEntries(
      TIER_IDS.map((id) => {
        const t = TIER_MANIFEST[id];
        return [
          id,
          {
            name: t.name,
            monthlyUsdCents: t.prices.monthly?.usdCents ?? null,
            annualUsdCents: t.prices.annual?.usdCents ?? null,
            monthlyInrPaise: t.prices.monthly?.inrPaise ?? null,
            annualInrPaise: t.prices.annual?.inrPaise ?? null,
            inboxLimit: t.inboxLimit,
            undoWindowDays: t.undoWindowDays,
            cleanupActionsPerMonth: t.cleanupActionsPerMonth,
            capabilities: [...t.capabilities].sort(),
            purchasable: t.purchasable,
            nonPurchasableRow: t.nonPurchasableRow ?? null,
            promo: t.promo
              ? {
                  id: t.promo.id,
                  annualUsdCents: t.promo.annual.usdCents,
                  annualInrPaise: t.promo.annual.inrPaise,
                  maxRedemptions: t.promo.maxRedemptions,
                }
              : null,
          },
        ];
      }),
    );

    const freeSet = [
      'activity',
      'cleanup-actions',
      'sender-detail',
      'senders',
      'snoozed',
      'triage',
    ];
    // D251 — Plus gains the Screener and rule-matching-with-manual-approval;
    // only unattended action (`autopilot`), Brief, Quiet and Follow-ups
    // remain Pro. Two capabilities, because one cannot express the split:
    // see packages/shared/src/entitlements/types.ts.
    const plusSet = [...freeSet, 'autopilot-review', 'screener'].sort();
    const proSet = [...plusSet, 'autopilot', 'brief', 'followups', 'quiet'].sort();

    expect({
      tiers,
      selectorTiers: SELECTOR_TIERS,
      selectorCaps: SELECTOR_CAPS,
      countsAsCleanup: COUNTS_AS_CLEANUP,
    }).toEqual({
      tiers: {
        free: {
          name: 'Free',
          monthlyUsdCents: 0,
          annualUsdCents: null,
          monthlyInrPaise: 0,
          annualInrPaise: null,
          inboxLimit: 1,
          undoWindowDays: 7,
          cleanupActionsPerMonth: 50,
          capabilities: freeSet,
          purchasable: true,
          nonPurchasableRow: null,
          promo: null,
        },
        plus: {
          name: 'Plus',
          monthlyUsdCents: 900,
          annualUsdCents: 9000,
          monthlyInrPaise: 74_900,
          annualInrPaise: 749_900,
          inboxLimit: 1,
          undoWindowDays: 7,
          cleanupActionsPerMonth: null,
          capabilities: plusSet,
          purchasable: true,
          nonPurchasableRow: null,
          promo: null,
        },
        pro: {
          name: 'Pro',
          monthlyUsdCents: 1900,
          annualUsdCents: 19000,
          monthlyInrPaise: 159_900,
          annualInrPaise: 1_599_900,
          inboxLimit: 3,
          undoWindowDays: 30,
          cleanupActionsPerMonth: null,
          capabilities: proSet,
          purchasable: true,
          nonPurchasableRow: null,
          promo: {
            id: 'foundingPro',
            annualUsdCents: 12900,
            annualInrPaise: 1_099_900,
            maxRedemptions: 250,
          },
        },
        team: {
          name: 'Team',
          monthlyUsdCents: null,
          annualUsdCents: null,
          monthlyInrPaise: null,
          annualInrPaise: null,
          inboxLimit: 3,
          undoWindowDays: 30,
          cleanupActionsPerMonth: null,
          capabilities: proSet,
          purchasable: false,
          nonPurchasableRow: { kind: 'waitlist', label: 'Join the waitlist' },
          promo: null,
        },
        enterprise: {
          name: 'Enterprise',
          monthlyUsdCents: null,
          annualUsdCents: null,
          monthlyInrPaise: null,
          annualInrPaise: null,
          inboxLimit: 3,
          undoWindowDays: 30,
          cleanupActionsPerMonth: null,
          capabilities: proSet,
          purchasable: false,
          nonPurchasableRow: { kind: 'contact', label: 'Contact sales' },
          promo: null,
        },
      },
      selectorTiers: { sender: 'free', 'multi-sender': 'free', 'sender-filter': 'pro' },
      selectorCaps: { 'multi-sender': 1000 },
      countsAsCleanup: {
        keep: false,
        archive: true,
        later: true,
        unsubscribe: true,
        delete: true,
        unarchive: false,
      },
    });
  });
});

describe('Pricing config — invariants (hold under any tuning)', () => {
  // 1. TIER_IDS ↔ manifest bijection — no orphan tier, no orphan entry.
  it('has exactly one definition per tier in TIER_IDS', () => {
    expect(Object.keys(TIER_MANIFEST).sort()).toEqual([...TIER_IDS].sort());
    for (const id of TIER_IDS) {
      expect(TIER_MANIFEST[id].id, id).toBe(id);
    }
  });

  // 2. Annual = 10× monthly on any tier that offers both intervals
  //    (the "2 months free" D19 framing).
  it('gives dual-interval tiers an annual price of exactly 10x monthly', () => {
    for (const id of TIER_IDS) {
      const { monthly, annual } = TIER_MANIFEST[id].prices;
      if (monthly !== null && annual !== null && monthly.usdCents > 0) {
        expect(annual.usdCents, id).toBe(monthly.usdCents * 10);
      }
    }
  });

  // 3. A promo undercuts both its host's annual and 12 months of monthly.
  it('keeps any promo cheaper than its host tier', () => {
    for (const id of TIER_IDS) {
      const t = TIER_MANIFEST[id];
      if (!t.promo) continue;
      expect(t.promo.annual.usdCents, id).toBeLessThan(t.prices.annual!.usdCents);
      expect(t.promo.annual.usdCents, id).toBeLessThan(t.prices.monthly!.usdCents * 12);
    }
  });

  // 4. Capability sets are cumulative up the ladder — a higher tier
  //    never loses a surface a lower tier has.
  it('keeps capability sets cumulative in rank order', () => {
    const ranked = [...TIER_IDS].sort((a, b) => TIER_RANK[a] - TIER_RANK[b]);
    for (let i = 1; i < ranked.length; i += 1) {
      const lower = new Set(TIER_MANIFEST[ranked[i - 1]!].capabilities);
      const higher = new Set(TIER_MANIFEST[ranked[i]!].capabilities);
      for (const cap of lower) {
        expect(higher.has(cap), `${ranked[i]} keeps ${cap} from ${ranked[i - 1]}`).toBe(true);
      }
    }
    // The top tier grants the FULL capability union — no orphan capability.
    const top = ranked[ranked.length - 1]!;
    expect([...TIER_MANIFEST[top].capabilities].sort()).toEqual([...CAPABILITIES].sort());
  });

  // 5. inboxLimit and undoWindowDays are monotonic non-decreasing by
  //    rank (audit bug 4 — Pro 3 must never exceed Team/Enterprise).
  it('keeps inboxLimit and undoWindowDays monotonic non-decreasing by rank', () => {
    const ranked = [...TIER_IDS].sort((a, b) => TIER_RANK[a] - TIER_RANK[b]);
    for (let i = 1; i < ranked.length; i += 1) {
      const lower = ranked[i - 1]!;
      const higher = ranked[i]!;
      expect(inboxLimitFor(higher), `${higher} inboxLimit >= ${lower}`).toBeGreaterThanOrEqual(
        inboxLimitFor(lower),
      );
      expect(
        undoWindowDaysFor(higher),
        `${higher} undoWindowDays >= ${lower}`,
      ).toBeGreaterThanOrEqual(undoWindowDaysFor(lower));
    }
  });

  // 6. The monthly quota is monotonic too: no higher tier has a SMALLER
  //    quota (null = unlimited ranks above any number).
  it('never gives a higher tier a smaller cleanup quota', () => {
    const ranked = [...TIER_IDS].sort((a, b) => TIER_RANK[a] - TIER_RANK[b]);
    for (let i = 1; i < ranked.length; i += 1) {
      const lower = cleanupActionsPerMonthFor(ranked[i - 1]!);
      const higher = cleanupActionsPerMonthFor(ranked[i]!);
      if (higher !== null) {
        expect(lower, `${ranked[i]} quota >= ${ranked[i - 1]}`).not.toBeNull();
        expect(higher).toBeGreaterThanOrEqual(lower!);
      }
    }
  });

  // 7. Purchasability shape: a non-purchasable tier carries its row
  //    treatment; a purchasable one never does.
  it('pairs nonPurchasableRow with purchasable=false exactly', () => {
    for (const id of TIER_IDS) {
      const t = TIER_MANIFEST[id];
      expect(t.nonPurchasableRow !== undefined, id).toBe(!t.purchasable);
    }
  });

  // 8. Price-point hygiene: integer amounts; catalog ids null or
  //    non-empty; a $0 point never gets a checkout SKU.
  it('keeps every price point well-formed', () => {
    const points = TIER_IDS.flatMap((id) => {
      const { monthly, annual } = TIER_MANIFEST[id].prices;
      return [monthly, annual, TIER_MANIFEST[id].promo?.annual ?? null];
    }).filter((p) => p !== null);
    for (const point of points) {
      expect(Number.isInteger(point.usdCents)).toBe(true);
      expect(point.usdCents).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(point.inrPaise)).toBe(true);
      expect(point.inrPaise).toBeGreaterThanOrEqual(0);
      for (const catalogId of [point.paddlePriceId, point.razorpayPlanId]) {
        expect(catalogId === null || catalogId.length > 0).toBe(true);
      }
      if (point.usdCents === 0) {
        expect(point.paddlePriceId).toBeNull();
        expect(point.razorpayPlanId).toBeNull();
      }
    }
  });
});

describe('Entitlement resolvers (D19)', () => {
  it('tierById returns the manifest entry for every tier', () => {
    for (const id of TIER_IDS) {
      expect(tierById(id)).toBe(TIER_MANIFEST[id]);
    }
  });

  it('minimumTierForCapability is the lowest-ranked granting tier', () => {
    for (const capability of CAPABILITIES) {
      const min = minimumTierForCapability(capability);
      expect(hasCapability(min, capability), capability).toBe(true);
      for (const id of TIER_IDS) {
        if (TIER_RANK[id] < TIER_RANK[min]) {
          expect(hasCapability(id, capability), `${id} below ${min} lacks ${capability}`).toBe(
            false,
          );
        }
      }
    }
  });

  // The full 5-tiers × 3-action-tiers seam matrix: team/enterprise rank
  // AT pro (the plan's Pro gates unlock for tier ∈ {pro, team, enterprise}).
  it('satisfiesActionTier ranks every tier against every ActionTier', () => {
    const matrix: Record<TierId, Record<(typeof ACTION_TIERS)[number], boolean>> = {
      free: { free: true, plus: false, pro: false },
      plus: { free: true, plus: true, pro: false },
      pro: { free: true, plus: true, pro: true },
      team: { free: true, plus: true, pro: true },
      enterprise: { free: true, plus: true, pro: true },
    };
    for (const id of TIER_IDS) {
      for (const required of ACTION_TIERS) {
        expect(satisfiesActionTier(id, required), `${id} vs ${required}`).toBe(
          matrix[id][required],
        );
      }
    }
  });
});

/**
 * The seam with the Action Registry (actions/manifest-entries.ts). The
 * registry declares selector SUPPORT; the pricing config resolves tier,
 * cap and cleanup counting. These tests pin that composition.
 */
describe('Action Registry seam', () => {
  // The entitlement ladder's first three rungs ARE the action tiers, in
  // order — so ACTION_TIER_RANK and TIER_RANK can never disagree on the
  // shared prefix.
  it('keeps ACTION_TIERS as the ordered prefix of TIER_IDS', () => {
    expect(TIER_IDS.slice(0, ACTION_TIERS.length)).toEqual([...ACTION_TIERS]);
  });

  // Registry-derived capabilities mirror the config EXACTLY — a verb ×
  // selector that is supported carries the config's tier, cap and
  // counting flag; an unsupported one is null.
  it('derives every registry capability from the pricing config', () => {
    for (const d of listActionDescriptors()) {
      for (const selector of SELECTOR_TYPES) {
        const cap = d.capabilities[selector];
        if (cap === null) continue;
        expect(cap.tier, `${d.verb}/${selector} tier`).toBe(SELECTOR_TIERS[selector]);
        expect(cap.countsAsCleanup, `${d.verb}/${selector} counting`).toBe(
          COUNTS_AS_CLEANUP[d.verb],
        );
        expect(cap.cap, `${d.verb}/${selector} cap`).toBe(SELECTOR_CAPS[selector]);
      }
    }
  });

  // Every tier a registry capability requires resolves through
  // satisfiesActionTier for every TierId — totality of the seam.
  it('resolves every registry capability tier for every workspace tier', () => {
    for (const d of listActionDescriptors()) {
      for (const selector of SELECTOR_TYPES) {
        const cap = d.capabilities[selector];
        if (!cap) continue;
        for (const id of TIER_IDS) {
          const ok = satisfiesActionTier(id, cap.tier);
          if (TIER_RANK[id] >= TIER_RANK.pro) {
            expect(ok, `${id} meets ${d.verb}/${selector}`).toBe(true);
          }
        }
      }
    }
  });

  // D19/A3 coherence: a verb that draws down the quota must be
  // REACHABLE on free, and free's quota must be finite while the next
  // rung is unlimited — a metered verb needs a counter to draw down and
  // an upgrade that lifts it.
  it('keeps every single-sender cleanup verb reachable on free', () => {
    for (const d of listActionDescriptors()) {
      const cap = d.capabilities.sender;
      if (cap.countsAsCleanup) {
        expect(satisfiesActionTier('free', cap.tier), d.verb).toBe(true);
      }
    }
    expect(cleanupActionsPerMonthFor('free')).not.toBeNull();
    expect(cleanupActionsPerMonthFor('plus')).toBeNull();
    // Spot-check the flag flows from the config (no duplication — the
    // registry never re-declares per-verb costs).
    expect(ACTION_REGISTRY.archive.capabilities.sender.countsAsCleanup).toBe(
      COUNTS_AS_CLEANUP.archive,
    );
    expect(ACTION_REGISTRY.keep.capabilities.sender.countsAsCleanup).toBe(COUNTS_AS_CLEANUP.keep);
  });
});

/**
 * Type-level exhaustiveness (compile-time). The shared package's
 * `tsc --noEmit` typechecks this file, so adding a TierId / Capability /
 * tier-manifest field without updating these switches is a TYPE error —
 * the never-checks fail before any runtime test runs.
 */
describe('type-level exhaustiveness', () => {
  function assertNever(value: never): never {
    throw new Error(`unreachable: ${String(value)}`);
  }

  // Exhaustive TierId switch — must list all five tiers to compile.
  function tierRankViaSwitch(id: TierId): number {
    switch (id) {
      case 'free':
        return 0;
      case 'plus':
        return 1;
      case 'pro':
        return 2;
      case 'team':
        return 3;
      case 'enterprise':
        return 4;
      default:
        return assertNever(id);
    }
  }

  // Exhaustive Capability switch — must list all twelve to compile.
  function capabilityBucket(cap: Capability): 'free' | 'plus' | 'pro' {
    switch (cap) {
      case 'senders':
      case 'sender-detail':
      case 'activity':
      case 'cleanup-actions':
      case 'triage':
      case 'snoozed':
        return 'free';
      // D251 — Screener and rule-matching-with-manual-approval are Plus.
      case 'screener':
      case 'autopilot-review':
        return 'plus';
      case 'autopilot':
      case 'brief':
      case 'quiet':
      case 'followups':
        return 'pro';
      default:
        return assertNever(cap);
    }
  }

  it('compiles an exhaustive TierId switch matching TIER_RANK', () => {
    for (const id of TIER_IDS) {
      expect(tierRankViaSwitch(id)).toBe(TIER_RANK[id]);
    }
  });

  it('compiles an exhaustive Capability switch matching the manifest buckets', () => {
    for (const cap of CAPABILITIES) {
      const bucket = capabilityBucket(cap);
      const firstTierWithCap = TIER_IDS.find((id) => hasCapability(id, cap));
      expect(firstTierWithCap, cap).toBe(bucket);
    }
  });
});
