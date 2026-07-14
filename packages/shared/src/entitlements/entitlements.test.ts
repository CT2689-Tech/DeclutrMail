import { describe, expect, it } from 'vitest';

import { ACTION_REGISTRY, listActionDescriptors } from '../actions/manifest-entries';
import { ACTION_TIERS, SELECTOR_TYPES } from '../contracts/verb-constants';
import { TIER_MANIFEST } from './manifest';
import {
  cleanupActionsLifetimeFor,
  hasCapability,
  minimumTierForCapability,
  inboxLimitFor,
  satisfiesActionTier,
  tierById,
  undoWindowDaysFor,
} from './resolve';
import type { Capability, TierId } from './types';
import { CAPABILITIES, TIER_IDS, TIER_RANK } from './types';

/**
 * The D19 tier manifest invariants. The ladder is LOCKED (founder spec
 * 2026-06-11) — these tests pin every number so a re-price or a tier
 * edit is a deliberate, reviewed change, never a silent drift.
 */
describe('Tier manifest (D19)', () => {
  // 1. TIER_IDS ↔ manifest bijection — no orphan tier, no orphan entry.
  it('has exactly one definition per tier in TIER_IDS', () => {
    expect(Object.keys(TIER_MANIFEST).sort()).toEqual([...TIER_IDS].sort());
    for (const id of TIER_IDS) {
      expect(TIER_MANIFEST[id].id, id).toBe(id);
    }
  });

  // 2. The locked price ladder, in USD cents.
  it('pins the locked D19 price ladder', () => {
    expect(TIER_MANIFEST.free.prices.monthly?.usdCents).toBe(0);
    expect(TIER_MANIFEST.free.prices.annual).toBeNull();
    expect(TIER_MANIFEST.plus.prices.monthly?.usdCents).toBe(900);
    expect(TIER_MANIFEST.plus.prices.annual?.usdCents).toBe(9000);
    expect(TIER_MANIFEST.pro.prices.monthly?.usdCents).toBe(1900);
    expect(TIER_MANIFEST.pro.prices.annual?.usdCents).toBe(19000);
    expect(TIER_MANIFEST.team.prices).toEqual({ monthly: null, annual: null });
    expect(TIER_MANIFEST.enterprise.prices).toEqual({ monthly: null, annual: null });
  });

  // 3. Annual = 10× monthly (the "2 months free" D19 framing).
  it('gives paid tiers an annual price of exactly 10x monthly', () => {
    for (const id of ['plus', 'pro'] as const) {
      const { monthly, annual } = TIER_MANIFEST[id].prices;
      expect(annual?.usdCents, id).toBe((monthly?.usdCents ?? 0) * 10);
    }
  });

  // 4. The Founding Pro launch promo (D19 launch offer).
  it('hosts the foundingPro promo on pro and nowhere else', () => {
    const promo = TIER_MANIFEST.pro.promo;
    expect(promo).toBeDefined();
    expect(promo?.id).toBe('foundingPro');
    expect(promo?.annual.usdCents).toBe(12900);
    expect(promo?.maxRedemptions).toBe(250);
    // Cheaper than both the standard annual and 12 months of monthly.
    expect(promo!.annual.usdCents).toBeLessThan(TIER_MANIFEST.pro.prices.annual!.usdCents);
    expect(promo!.annual.usdCents).toBeLessThan(TIER_MANIFEST.pro.prices.monthly!.usdCents * 12);
    for (const id of TIER_IDS) {
      if (id !== 'pro') expect(TIER_MANIFEST[id].promo, id).toBeUndefined();
    }
  });

  // 5. Inbox limits: Free 1 / Plus 1 / Pro 2; team/enterprise never
  //    below pro (their values are provisional pro-equivalents).
  it('pins the inbox limits', () => {
    expect(inboxLimitFor('free')).toBe(1);
    expect(inboxLimitFor('plus')).toBe(1);
    expect(inboxLimitFor('pro')).toBe(2);
    expect(inboxLimitFor('team')).toBeGreaterThanOrEqual(2);
    expect(inboxLimitFor('enterprise')).toBeGreaterThanOrEqual(2);
  });

  // 6. Undo windows: 7d, lifted to 30d at Pro and above (D19).
  it('pins the undo windows', () => {
    expect(undoWindowDaysFor('free')).toBe(7);
    expect(undoWindowDaysFor('plus')).toBe(7);
    expect(undoWindowDaysFor('pro')).toBe(30);
    expect(undoWindowDaysFor('team')).toBe(30);
    expect(undoWindowDaysFor('enterprise')).toBe(30);
  });

  // 7. Free = 5 LIFETIME cleanup actions; every paid tier unlimited.
  it('gives free exactly 5 lifetime cleanup actions and others unlimited', () => {
    expect(cleanupActionsLifetimeFor('free')).toBe(5);
    for (const id of TIER_IDS) {
      if (id !== 'free') expect(cleanupActionsLifetimeFor(id), id).toBeNull();
    }
  });

  // 8. Capability sets are cumulative up the ladder — a higher tier
  //    never loses a surface a lower tier has (Free=see ⊂ Plus=clean ⊂
  //    Pro=automate; team/enterprise carry the pro set).
  it('keeps capability sets cumulative in rank order', () => {
    const ranked = [...TIER_IDS].sort((a, b) => TIER_RANK[a] - TIER_RANK[b]);
    for (let i = 1; i < ranked.length; i += 1) {
      const lower = new Set(TIER_MANIFEST[ranked[i - 1]!].capabilities);
      const higher = new Set(TIER_MANIFEST[ranked[i]!].capabilities);
      for (const cap of lower) {
        expect(higher.has(cap), `${ranked[i]} keeps ${cap} from ${ranked[i - 1]}`).toBe(true);
      }
    }
  });

  // 9. The exact D19 capability buckets per tier.
  it('pins the per-tier capability buckets', () => {
    const freeSet: Capability[] = ['senders', 'sender-detail', 'activity', 'cleanup-actions'];
    const plusSet: Capability[] = [...freeSet, 'triage'];
    const proSet: Capability[] = [
      ...plusSet,
      'autopilot',
      'brief',
      'screener',
      'quiet',
      'snoozed',
      'followups',
    ];
    expect([...TIER_MANIFEST.free.capabilities]).toEqual(freeSet);
    expect([...TIER_MANIFEST.plus.capabilities]).toEqual(plusSet);
    expect([...TIER_MANIFEST.pro.capabilities]).toEqual(proSet);
    expect([...TIER_MANIFEST.team.capabilities]).toEqual(proSet);
    expect([...TIER_MANIFEST.enterprise.capabilities]).toEqual(proSet);
    // Pro grants the FULL capability union — no orphan capability.
    expect([...TIER_MANIFEST.pro.capabilities].sort()).toEqual([...CAPABILITIES].sort());
  });

  // 10. Purchasability: free/plus/pro self-serve; team is a waitlist row
  //     ("Coming Q3 2026"), enterprise a contact row (D19).
  it('pins purchasability and the non-purchasable row treatments', () => {
    for (const id of ['free', 'plus', 'pro'] as const) {
      expect(TIER_MANIFEST[id].purchasable, id).toBe(true);
      expect(TIER_MANIFEST[id].nonPurchasableRow, id).toBeUndefined();
    }
    expect(TIER_MANIFEST.team.purchasable).toBe(false);
    expect(TIER_MANIFEST.team.nonPurchasableRow).toEqual({
      kind: 'waitlist',
      label: 'Coming Q3 2026',
    });
    expect(TIER_MANIFEST.enterprise.purchasable).toBe(false);
    expect(TIER_MANIFEST.enterprise.nonPurchasableRow?.kind).toBe('contact');
  });

  // 11. Price-point hygiene: integer cents, and catalog ids are null
  //     (pre-provisioning) or non-empty strings (post-provisioning).
  it('keeps every price point well-formed', () => {
    const points = TIER_IDS.flatMap((id) => {
      const { monthly, annual } = TIER_MANIFEST[id].prices;
      return [monthly, annual, id === 'pro' ? TIER_MANIFEST.pro.promo!.annual : null];
    }).filter((p) => p !== null);
    for (const point of points) {
      expect(Number.isInteger(point.usdCents)).toBe(true);
      expect(point.usdCents).toBeGreaterThanOrEqual(0);
      for (const catalogId of [point.paddlePriceId, point.razorpayPlanId]) {
        expect(catalogId === null || catalogId.length > 0).toBe(true);
      }
    }
    // A purchasable PAID interval is a future checkout SKU; the $0 free
    // point never gets one — pin that it has no catalog ids.
    expect(TIER_MANIFEST.free.prices.monthly?.paddlePriceId).toBeNull();
    expect(TIER_MANIFEST.free.prices.monthly?.razorpayPlanId).toBeNull();
  });
});

describe('Entitlement resolvers (D19)', () => {
  it('tierById returns the manifest entry for every tier', () => {
    for (const id of TIER_IDS) {
      expect(tierById(id)).toBe(TIER_MANIFEST[id]);
    }
  });

  it('hasCapability gates the Plus and Pro buckets', () => {
    // Free: read surfaces + cleanup pipeline, NO triage, NO automation.
    expect(hasCapability('free', 'senders')).toBe(true);
    expect(hasCapability('free', 'cleanup-actions')).toBe(true);
    expect(hasCapability('free', 'triage')).toBe(false);
    expect(hasCapability('free', 'autopilot')).toBe(false);
    // Plus: + triage, still no automation.
    expect(hasCapability('plus', 'triage')).toBe(true);
    expect(hasCapability('plus', 'screener')).toBe(false);
    expect(hasCapability('plus', 'brief')).toBe(false);
    // Pro and above: everything.
    for (const id of ['pro', 'team', 'enterprise'] as const) {
      for (const cap of CAPABILITIES) {
        expect(hasCapability(id, cap), `${id} has ${cap}`).toBe(true);
      }
    }
  });

  it('resolves the minimum granting tier from the manifest', () => {
    expect(minimumTierForCapability('senders')).toBe('free');
    expect(minimumTierForCapability('triage')).toBe('plus');
    expect(minimumTierForCapability('autopilot')).toBe('pro');
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
 * The seam with the Action Registry (actions/manifest-entries.ts).
 * The registry declares per-verb/selector MINIMUM ActionTiers +
 * countsAsCleanup; this layer declares per-tier grants. These tests pin
 * that the two compose without duplication.
 */
describe('Action Registry seam', () => {
  // The entitlement ladder's first three rungs ARE the action tiers, in
  // order — so ACTION_TIER_RANK and TIER_RANK can never disagree on the
  // shared prefix.
  it('keeps ACTION_TIERS as the ordered prefix of TIER_IDS', () => {
    expect(TIER_IDS.slice(0, ACTION_TIERS.length)).toEqual([...ACTION_TIERS]);
  });

  // Every tier a registry capability requires resolves through
  // satisfiesActionTier for every TierId — totality of the seam.
  it('resolves every registry capability tier for every workspace tier', () => {
    for (const d of listActionDescriptors()) {
      for (const selector of SELECTOR_TYPES) {
        const cap = d.capabilities[selector];
        if (!cap) continue;
        for (const id of TIER_IDS) {
          // Must not throw, and pro+ meets every requirement.
          const ok = satisfiesActionTier(id, cap.tier);
          if (TIER_RANK[id] >= TIER_RANK.pro) {
            expect(ok, `${id} meets ${d.verb}/${selector}`).toBe(true);
          }
        }
      }
    }
  });

  // D19 coherence: a verb that draws down the Free lifetime quota
  // (countsAsCleanup on the single-sender selector) must be REACHABLE on
  // free — the "5 taste actions" only make sense if free can fire them.
  it('keeps every single-sender cleanup verb reachable on free', () => {
    for (const d of listActionDescriptors()) {
      const cap = d.capabilities.sender;
      if (cap.countsAsCleanup) {
        expect(satisfiesActionTier('free', cap.tier), d.verb).toBe(true);
      }
    }
    // And the quota itself is finite on free, unlimited on plus — the
    // registry's countsAsCleanup flag has a counter to draw down.
    expect(cleanupActionsLifetimeFor('free')).toBe(5);
    expect(cleanupActionsLifetimeFor('plus')).toBeNull();
    // Spot-check the flag exists on the registry side (no duplication —
    // the entitlement layer never re-declares per-verb costs).
    expect(ACTION_REGISTRY.archive.capabilities.sender.countsAsCleanup).toBe(true);
    expect(ACTION_REGISTRY.keep.capabilities.sender.countsAsCleanup).toBe(false);
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

  // Exhaustive Capability switch — must list all eleven to compile.
  function capabilityBucket(cap: Capability): 'free' | 'plus' | 'pro' {
    switch (cap) {
      case 'senders':
      case 'sender-detail':
      case 'activity':
      case 'cleanup-actions':
        return 'free';
      case 'triage':
        return 'plus';
      case 'autopilot':
      case 'brief':
      case 'screener':
      case 'quiet':
      case 'snoozed':
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
