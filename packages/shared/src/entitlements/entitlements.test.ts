import { describe, expect, it } from 'vitest';

import { listActionDescriptors } from '../actions/manifest-entries';
import { ACTION_TIERS, SELECTOR_TYPES, type ActionVerb } from '../contracts/verb-constants';
import { quotaUnitsForEnqueue } from './copy';
import {
  INBOXES,
  METER,
  OFFERS,
  PLUS_ANNUAL_2026_10,
  SELECTOR_CAPS,
  SELECTOR_TIERS,
  TIER_MANIFEST,
} from './pricing.config';
import {
  hasCapability,
  inboxLimitFor,
  minimumTierForCapability,
  satisfiesActionTier,
  tierById,
  tierIsPurchasable,
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
            inboxLimit: t.inboxLimit,
            undoWindowDays: t.undoWindowDays,
            capabilities: [...t.capabilities].sort(),
            purchasable: t.purchasable,
            selfServeCheckout: tierIsPurchasable(id),
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
    // 2026-08-23 (amends D251) — Plus gains the Screener and the WHOLE
    // Autopilot, unattended action included, plus the Quiet window that
    // governs it. Pro keeps the two attention surfaces. The two
    // Autopilot capabilities still exist — the apply worker filters per
    // match on `modeAtMatch` — but they no longer straddle a price
    // boundary; `observe`/`active` is a user choice now.
    const plusSet = [...freeSet, 'autopilot', 'autopilot-active', 'quiet', 'screener'].sort();
    const proSet = [...plusSet, 'brief', 'followups'].sort();
    const pricePoint = (point: typeof PLUS_ANNUAL_2026_10) => ({
      usdCents: point.usdCents,
      inrPaise: point.inr?.paise ?? point.inrPaise,
      paddlePriceId: point.paddlePriceId,
      version: point.version,
    });

    expect({
      tiers,
      inboxes: INBOXES,
      plusAnnual: pricePoint(PLUS_ANNUAL_2026_10),
      backlogPass: {
        price: pricePoint(OFFERS.backlogPass.price),
        grantsTier: OFFERS.backlogPass.grantsTier,
        durationDays: OFFERS.backlogPass.durationDays,
      },
      meter: { free: METER.free, countsVerbs: METER.countsVerbs },
      selectorTiers: SELECTOR_TIERS,
      selectorCaps: SELECTOR_CAPS,
    }).toEqual({
      tiers: {
        free: {
          name: 'Free',
          inboxLimit: 1,
          undoWindowDays: 30,
          capabilities: freeSet,
          purchasable: true,
          selfServeCheckout: true,
        },
        plus: {
          name: 'Plus',
          inboxLimit: 2,
          undoWindowDays: 30,
          capabilities: plusSet,
          purchasable: true,
          selfServeCheckout: true,
        },
        // Founder decision "1C": Pro is waitlist only.
        pro: {
          name: 'Pro',
          inboxLimit: 5,
          undoWindowDays: 30,
          capabilities: proSet,
          purchasable: true,
          selfServeCheckout: false,
        },
        team: {
          name: 'Team',
          inboxLimit: 5,
          undoWindowDays: 30,
          capabilities: proSet,
          purchasable: false,
          selfServeCheckout: false,
        },
        enterprise: {
          name: 'Enterprise',
          inboxLimit: 5,
          undoWindowDays: 30,
          capabilities: proSet,
          purchasable: false,
          selfServeCheckout: false,
        },
      },
      inboxes: { free: 1, plus: 2, pro: 5 },
      plusAnnual: {
        usdCents: 5900,
        inrPaise: 199_900,
        paddlePriceId: 'pri_01m4qk99878y7jynh1h00jfhy8',
        version: '2026-10',
      },
      backlogPass: {
        price: {
          usdCents: 1900,
          inrPaise: 79_900,
          paddlePriceId: 'pri_01m4qkayqz3t54gdh9jq5b8ypq',
          version: '2026-10',
        },
        grantsTier: 'plus',
        durationDays: 30,
      },
      meter: {
        free: { limit: 1000, period: 'signup_month' },
        countsVerbs: {
          archive: true,
          delete: true,
          later: false,
          unsubscribe: false,
          keep: false,
          unarchive: false,
        },
      },
      selectorTiers: { sender: 'free', 'multi-sender': 'free', 'sender-filter': 'pro' },
      selectorCaps: { 'multi-sender': 1000 },
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

  // 2. Capability sets are cumulative up the ladder — a higher tier
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

  // 3. inboxLimit and undoWindowDays are monotonic non-decreasing by
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

  // 4. Only Free is metered: every higher tier stamps no meter units.
  it('meters Free alone', () => {
    for (const id of TIER_IDS) {
      const units = quotaUnitsForEnqueue({ tier: id, verb: 'archive', requestedCount: 3 });
      expect(units, id).toBe(id === 'free' ? 3 : 0);
    }
  });

  // 5. Price-point hygiene: integer amounts; catalog ids non-empty.
  it('keeps every launch price point well-formed', () => {
    for (const point of [PLUS_ANNUAL_2026_10, OFFERS.backlogPass.price]) {
      expect(Number.isInteger(point.usdCents)).toBe(true);
      expect(point.usdCents).toBeGreaterThan(0);
      expect(Number.isInteger(point.inrPaise)).toBe(true);
      expect(point.inrPaise).toBeGreaterThan(0);
      expect(point.paddlePriceId?.length).toBeGreaterThan(0);
    }
  });

  // 6. Quiet governs Autopilot, so no tier may grant `autopilot`
  //    without `quiet`.
  //
  //    This is not style — it is the guarantee that removes a whole
  //    bug. `AutopilotActionWorker` applies the quiet window with no
  //    tier condition (correctly: the window is mailbox state, not a
  //    request). If a tier could run rules without owning quiet, a
  //    downgrade into that tier would strand a stored window and
  //    silently defer batches the user already approved, on a screen
  //    the app hides behind a PUT that 402s. Keeping the containment
  //    true makes that state unreachable instead of merely unhandled.
  it('never grants autopilot to a tier that lacks quiet', () => {
    for (const id of TIER_IDS) {
      const caps = new Set(TIER_MANIFEST[id].capabilities);
      if (caps.has('autopilot') || caps.has('autopilot-active')) {
        expect(caps.has('quiet'), `${id} runs rules, so it must own quiet`).toBe(true);
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
 * registry declares selector SUPPORT; the pricing config resolves tier
 * and cap. These tests pin that composition.
 */
describe('Action Registry seam', () => {
  // The entitlement ladder's first three rungs ARE the action tiers, in
  // order — so ACTION_TIER_RANK and TIER_RANK can never disagree on the
  // shared prefix.
  it('keeps ACTION_TIERS as the ordered prefix of TIER_IDS', () => {
    expect(TIER_IDS.slice(0, ACTION_TIERS.length)).toEqual([...ACTION_TIERS]);
  });

  // Registry-derived capabilities mirror the config EXACTLY — a verb ×
  // selector that is supported carries the config's tier and cap; an
  // unsupported one is null.
  it('derives every registry capability from the pricing config', () => {
    for (const d of listActionDescriptors()) {
      for (const selector of SELECTOR_TYPES) {
        const cap = d.capabilities[selector];
        if (cap === null) continue;
        expect(cap.tier, `${d.verb}/${selector} tier`).toBe(SELECTOR_TIERS[selector]);
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

  // Meter coherence: a verb that draws down Free's meter must be
  // REACHABLE on free, and the meter must be finite — a metered verb
  // needs a counter to draw down and an upgrade that lifts it.
  it('keeps every metered single-sender verb reachable on free', () => {
    const metered = listActionDescriptors().filter(
      (d) => METER.countsVerbs[d.verb as ActionVerb] === true,
    );
    expect(metered.map((d) => d.verb).sort()).toEqual(['archive', 'delete']);
    for (const d of metered) {
      expect(satisfiesActionTier('free', d.capabilities.sender.tier), d.verb).toBe(true);
    }
    expect(Number.isInteger(METER.free.limit) && METER.free.limit > 0).toBe(true);
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
      // 2026-08-23 (amends D251) — the Screener and the whole Autopilot,
      // plus the Quiet window that governs it, are Plus.
      case 'screener':
      case 'autopilot':
      case 'autopilot-active':
      case 'quiet':
        return 'plus';
      case 'brief':
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

describe('inbox limits and self-serve checkout', () => {
  it('reads INBOXES through the manifest and keeps Pro off checkout', () => {
    expect(inboxLimitFor('free')).toBe(INBOXES.free);
    expect(inboxLimitFor('plus')).toBe(INBOXES.plus);
    expect(inboxLimitFor('pro')).toBe(INBOXES.pro);
    expect(tierIsPurchasable('pro')).toBe(false);
    expect(tierIsPurchasable('plus')).toBe(true);
  });
});
