/**
 * Unit tests for the A6 derive layer (`deriveBillingViewState` + the
 * card helpers) — every discriminant of `BillingViewState`, the
 * backing/non-backing classification rules, and the price/status
 * helpers that render only what the backing record can prove.
 * See docs/adr/0027-billing-presentation-state.md.
 */

import { describe, expect, it } from 'vitest';

import type { BillingSubscription } from '@declutrmail/shared/contracts';

import { ApiError } from '@/lib/api/client';

import {
  backingStatusNote,
  BillingPayloadError,
  currentPlanPriceLabel,
  deriveBillingViewState,
  emptyPlanView,
  nonBackingBlocksNewCheckout,
  type BillingReadSnapshot,
  type NonBackingRecord,
  type SubscriptionRecord,
} from './billing-model';
import type { PendingCheckout } from './pending-checkout';

const SUB: SubscriptionRecord = {
  provider: 'paddle',
  tier: 'pro',
  status: 'active',
  cycle: 'monthly',
  currentPeriodEnd: '2026-07-01T12:00:00.000Z',
  cancelAtPeriodEnd: false,
  cancelSource: null,
  pauseUntil: null,
  foundingMember: false,
  scheduledChange: null,
};

const PENDING: PendingCheckout = {
  workspaceId: 'w',
  kind: 'checkout',
  fromTier: 'free',
  fromCycle: null,
  toTier: 'pro',
  toCycle: 'annual',
  at: Date.now(),
};

function body(
  tier: BillingSubscription['tier'],
  subscription: SubscriptionRecord | null,
  foundingMember = false,
): BillingSubscription {
  return { tier, foundingMember, subscription, pendingCheckout: null };
}

function snapshot(overrides: Partial<BillingReadSnapshot>): BillingReadSnapshot {
  return {
    isLoading: false,
    isError: false,
    error: null,
    data: undefined,
    meTier: 'free',
    pending: null,
    ...overrides,
  };
}

function billingDisabledError(): ApiError {
  return new ApiError(503, { error: { code: 'BILLING_DISABLED' } }, 'disabled');
}

describe('deriveBillingViewState — discriminants', () => {
  it('loading wins over everything', () => {
    expect(deriveBillingViewState(snapshot({ isLoading: true, pending: PENDING })).kind).toBe(
      'loading',
    );
  });

  it('a pending money action outranks a transient read failure — never read_failed', () => {
    const view = deriveBillingViewState(
      snapshot({ isError: true, error: new ApiError(500, undefined, 'boom'), pending: PENDING }),
    );
    expect(view.kind).toBe('payment_pending');
  });

  it('payment_pending carries the parsed plan when data exists, the empty view when not', () => {
    const withData = deriveBillingViewState(snapshot({ data: body('pro', SUB), pending: PENDING }));
    expect(withData).toMatchObject({
      kind: 'payment_pending',
      entitlementTier: 'pro',
      backing: { state: 'active' },
    });

    const withoutData = deriveBillingViewState(snapshot({ pending: PENDING, meTier: 'plus' }));
    expect(withoutData).toMatchObject({
      kind: 'payment_pending',
      ...emptyPlanView('plus'),
    });
  });

  it('billing_dark keys on the BILLING_DISABLED code with the me-tier entitlement', () => {
    const view = deriveBillingViewState(
      snapshot({ isError: true, error: billingDisabledError(), meTier: 'plus' }),
    );
    expect(view).toEqual({ kind: 'billing_dark', entitlementTier: 'plus' });
  });

  it('a bare 503 WITHOUT the code is read_failed, never billing_dark (MISTAKES 2026-07-26)', () => {
    const error = new ApiError(503, { error: { code: 'SOMETHING_ELSE' } }, 'outage');
    const view = deriveBillingViewState(snapshot({ isError: true, error }));
    expect(view).toEqual({ kind: 'read_failed', error });
  });

  it('a malformed payload (BillingPayloadError) is the unknown state', () => {
    const view = deriveBillingViewState(
      snapshot({ isError: true, error: new BillingPayloadError() }),
    );
    expect(view).toEqual({ kind: 'unknown' });
  });

  it('any other error is read_failed', () => {
    const error = new Error('network down');
    expect(deriveBillingViewState(snapshot({ isError: true, error }))).toEqual({
      kind: 'read_failed',
      error,
    });
  });

  it('no error and no data is unknown, never an invented plan', () => {
    expect(deriveBillingViewState(snapshot({}))).toEqual({ kind: 'unknown' });
  });
});

describe('deriveBillingViewState — backing classification', () => {
  it('active + tier match backs the plan', () => {
    const view = deriveBillingViewState(snapshot({ data: body('pro', SUB) }));
    expect(view).toMatchObject({
      kind: 'plan',
      entitlementTier: 'pro',
      backing: { state: 'active', sub: SUB },
      nonBacking: null,
    });
  });

  it('past_due + tier match still backs (the granting set)', () => {
    const sub = { ...SUB, status: 'past_due' as const };
    const view = deriveBillingViewState(snapshot({ data: body('pro', sub) }));
    expect(view).toMatchObject({ backing: { state: 'past_due', sub } });
  });

  it('cancelAtPeriodEnd on a granting match is cancel_scheduled', () => {
    const sub = { ...SUB, cancelAtPeriodEnd: true };
    const view = deriveBillingViewState(snapshot({ data: body('pro', sub) }));
    expect(view).toMatchObject({ backing: { state: 'cancel_scheduled', sub } });
  });

  it('scheduledChange surfaces ONLY off a backing record', () => {
    const change = {
      tier: 'plus' as const,
      cycle: 'monthly' as const,
      effectiveAt: '2026-08-15T12:00:00.000Z',
      state: 'scheduled' as const,
    };
    const backing = deriveBillingViewState(
      snapshot({ data: body('pro', { ...SUB, scheduledChange: change }) }),
    );
    expect(backing).toMatchObject({ scheduledChange: change });

    // The same marker on a NON-backing row is not a plan fact.
    const nonBacking = deriveBillingViewState(
      snapshot({
        data: body('pro', { ...SUB, tier: 'plus', status: 'paused', scheduledChange: change }),
      }),
    );
    expect(nonBacking).toMatchObject({ scheduledChange: null });
  });

  it('foundingMember passes through from the workspace payload', () => {
    const view = deriveBillingViewState(snapshot({ data: body('pro', SUB, true) }));
    expect(view).toMatchObject({ foundingMember: true });
  });
});

describe('deriveBillingViewState — non-backing reasons', () => {
  it('paused under a free entitlement is the ordinary paused story', () => {
    const sub = { ...SUB, tier: 'plus' as const, status: 'paused' as const };
    const view = deriveBillingViewState(snapshot({ data: body('free', sub) }));
    expect(view).toMatchObject({
      backing: { state: 'none' },
      nonBacking: { reason: 'paused', sub },
    });
  });

  it('paused stays "paused" when the SUB outranks the entitlement (resume cannot downgrade)', () => {
    const sub = { ...SUB, status: 'paused' as const }; // paused PRO
    const view = deriveBillingViewState(snapshot({ data: body('plus', sub) }));
    expect(view).toMatchObject({ nonBacking: { reason: 'paused' } });
  });

  it('paused under an entitlement that OUTRANKS it is tier_mismatch (the A6 repro)', () => {
    const sub = { ...SUB, tier: 'plus' as const, status: 'paused' as const };
    const view = deriveBillingViewState(snapshot({ data: body('pro', sub) }));
    expect(view).toMatchObject({ nonBacking: { reason: 'tier_mismatch', sub } });
  });

  it('a granting-status row on a different tier is tier_mismatch', () => {
    const active = { ...SUB, tier: 'plus' as const };
    expect(deriveBillingViewState(snapshot({ data: body('pro', active) }))).toMatchObject({
      nonBacking: { reason: 'tier_mismatch' },
    });
    const pastDue = { ...SUB, tier: 'plus' as const, status: 'past_due' as const };
    expect(deriveBillingViewState(snapshot({ data: body('pro', pastDue) }))).toMatchObject({
      nonBacking: { reason: 'tier_mismatch' },
    });
  });

  describe('the D253 refund-settling window', () => {
    // The shape the first live refund produced (2026-08-14): the refund
    // ended entitlement immediately, so the workspace reads `free`, while
    // the row stays `active` until the provider confirms.
    const refunded = {
      ...SUB,
      tier: 'plus' as const,
      status: 'active' as const,
      cancelSource: 'refund' as const,
      cancelAtPeriodEnd: true,
    };

    it('a live row under a refund verdict is refund_settling, not tier_mismatch', () => {
      const view = deriveBillingViewState(snapshot({ data: body('free', refunded) }));
      expect(view).toMatchObject({ nonBacking: { reason: 'refund_settling', sub: refunded } });
    });

    it('still blocks checkout — the server would answer 409 until it settles', () => {
      const view = deriveBillingViewState(snapshot({ data: body('free', refunded) }));
      const nonBacking = 'nonBacking' in view ? view.nonBacking : null;
      expect(nonBackingBlocksNewCheckout(nonBacking)).toBe(true);
    });

    it('a CHARGEBACK row keeps the old story — it never unlocks, so the copy must not promise it', () => {
      const chargedBack = { ...refunded, cancelSource: 'chargeback' as const };
      expect(deriveBillingViewState(snapshot({ data: body('free', chargedBack) }))).toMatchObject({
        nonBacking: { reason: 'tier_mismatch' },
      });
    });

    it('once the refund settles the row is canceled, which outranks the verdict', () => {
      // Terminal beats in-flight: a settled refund frees the slot, and the
      // canceled copy already invites a fresh purchase.
      const settled = { ...refunded, status: 'canceled' as const, currentPeriodEnd: null };
      expect(deriveBillingViewState(snapshot({ data: body('free', settled) }))).toMatchObject({
        nonBacking: { reason: 'canceled' },
      });
    });
  });

  it('a canceled row is reason canceled', () => {
    const sub = { ...SUB, status: 'canceled' as const, currentPeriodEnd: null };
    const view = deriveBillingViewState(snapshot({ data: body('free', sub) }));
    expect(view).toMatchObject({ nonBacking: { reason: 'canceled', sub } });
  });
});

describe('currentPlanPriceLabel', () => {
  it('renders the backing record’s charged price (its own provider/cycle)', () => {
    const view = deriveBillingViewState(snapshot({ data: body('pro', SUB) }));
    expect(view.kind).toBe('plan');
    if (view.kind !== 'plan') return;
    expect(currentPlanPriceLabel(view)).toBe('$19/mo');
  });

  it('renders the founding promo price for a founding annual backing sub', () => {
    const sub = { ...SUB, cycle: 'annual' as const, foundingMember: true };
    const view = deriveBillingViewState(snapshot({ data: body('pro', sub, true) }));
    if (view.kind !== 'plan') throw new Error('expected plan');
    expect(currentPlanPriceLabel(view)).toBe('$129/yr');
  });

  it('free with no backing record is $0', () => {
    expect(currentPlanPriceLabel(emptyPlanView('free'))).toBe('$0');
  });

  it('a paid tier with NO backing record makes no price claim', () => {
    expect(currentPlanPriceLabel(emptyPlanView('pro'))).toBe('Included with your account');
    // Even with a non-backing row present, its price never leaks.
    const view = deriveBillingViewState(
      snapshot({ data: body('pro', { ...SUB, tier: 'plus', status: 'paused' }) }),
    );
    if (view.kind !== 'plan') throw new Error('expected plan');
    expect(currentPlanPriceLabel(view)).toBe('Included with your account');
  });
});

describe('backingStatusNote', () => {
  it('is null for none and plain active', () => {
    expect(backingStatusNote({ state: 'none' })).toBeNull();
    expect(backingStatusNote({ state: 'active', sub: SUB })).toBeNull();
  });

  it('warns on past_due (dunning)', () => {
    expect(backingStatusNote({ state: 'past_due', sub: SUB })).toMatchObject({
      tone: 'warn',
      text: expect.stringContaining('Payment past due'),
    });
  });

  it('warns on cancel_scheduled with the period-end date', () => {
    const sub = { ...SUB, cancelAtPeriodEnd: true };
    expect(backingStatusNote({ state: 'cancel_scheduled', sub })).toMatchObject({
      tone: 'warn',
      text: expect.stringContaining('until Jul 1, 2026'),
    });
    // "Cancellation scheduled" is only right when the user did it.
    expect(backingStatusNote({ state: 'cancel_scheduled', sub })!.text).toContain(
      'Cancellation scheduled',
    );
  });

  // Both verdicts end entitlement at once (`entitlement_ends_at` = now)
  // while `currentPeriodEnd` is still a future date, so promising access
  // "until Jul 1" would be a confident lie in either case.
  for (const [source, word] of [
    ['refund', 'a refund'],
    ['chargeback', 'a chargeback'],
  ] as const) {
    it(`names ${source} as the cause and claims NO date`, () => {
      const sub = { ...SUB, cancelAtPeriodEnd: true, cancelSource: source };
      const note = backingStatusNote({ state: 'cancel_scheduled', sub })!;
      expect(note.text).toContain(word);
      expect(note.text).not.toContain('Jul 1, 2026');
      expect(note.text).not.toContain('Cancellation scheduled');
    });
  }
});

describe('nonBackingBlocksNewCheckout — mirrors the server SUBSCRIPTION_EXISTS set', () => {
  const record = (status: SubscriptionRecord['status']): NonBackingRecord => ({
    reason: status === 'canceled' ? 'canceled' : 'tier_mismatch',
    sub: { ...SUB, status },
  });

  it('blocks while the row is active, past_due, or paused (server 409s a new checkout)', () => {
    expect(nonBackingBlocksNewCheckout(record('active'))).toBe(true);
    expect(nonBackingBlocksNewCheckout(record('past_due'))).toBe(true);
    expect(nonBackingBlocksNewCheckout(record('paused'))).toBe(true);
  });

  it('a canceled row frees the slot; no record blocks nothing', () => {
    expect(nonBackingBlocksNewCheckout(record('canceled'))).toBe(false);
    expect(nonBackingBlocksNewCheckout(null)).toBe(false);
  });
});
