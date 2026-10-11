import { describe, expect, it } from 'vitest';
import {
  proposedCheckoutHold,
  sandboxReplayRefusal,
} from '../../../scripts/helpers/checkout-revocation-proof.js';

const canceled = {
  transactionId: 'txn_fixture',
  status: 'canceled',
  subscriptionId: null,
  hold: 'stopped' as const,
};
const input = {
  legacy: false,
  paymentSeen: false,
  grantingSubscription: false,
  replayErrorObserved: true,
  replacementUnproven: false,
  provider: canceled,
};
describe('sandbox proposed deletion hold', () => {
  it('does not mistake a network/domain/configuration error for provider revocation', () => {
    const observation = {
      event: 'checkout.error',
      code: 'validation',
      type: 'api_error',
      requestedId: 'txn_fixture',
      boundId: 'txn_fixture',
      replay: true,
      stopped: true,
    };
    expect(sandboxReplayRefusal(observation)).toBe(false);
    expect(
      sandboxReplayRefusal({
        ...observation,
        code: 'transaction_not_ready_cannot_process_payment',
      }),
    ).toBe(true);
    expect(
      sandboxReplayRefusal({
        ...observation,
        code: 'transaction_not_ready_cannot_process_payment',
        requestedId: 'txn_other',
      }),
    ).toBe(false);
    expect(
      sandboxReplayRefusal({ ...observation, code: 'transaction_immutable', stopped: false }),
    ).toBe(false);
  });
  it('keeps verified payment sticky across a stale canceled provider result', () => {
    expect(proposedCheckoutHold({ ...input, paymentSeen: true })).toBe('paid');
  });
  it('keeps a future-billable granting subscription held without positive-charge evidence', () => {
    expect(proposedCheckoutHold({ ...input, grantingSubscription: true })).toBe('paid');
  });
  it('cannot clear a replayable legacy payload when another transaction was canceled', () => {
    expect(proposedCheckoutHold({ ...input, legacy: true })).toBe('legacy_unproven');
  });
  it('cannot clear when replay creates an unproven replacement or provider scan is unavailable', () => {
    expect(proposedCheckoutHold({ ...input, replacementUnproven: true })).toBe('held');
    expect(proposedCheckoutHold({ ...input, provider: null })).toBe('held');
  });
  it('requires replay observation even after terminal cancellation', () => {
    expect(proposedCheckoutHold({ ...input, replayErrorObserved: false })).toBe('held');
    expect(proposedCheckoutHold(input)).toBe('attempt_stopped_replay_observed');
  });
});
