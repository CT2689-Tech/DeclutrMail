import type { SandboxCheckoutFacts } from '../../src/billing/paddle.adapter.js';

export function sandboxReplayRefusal(input: {
  event: unknown;
  code: unknown;
  type: unknown;
  requestedId: unknown;
  boundId: string | undefined;
  replay: unknown;
  stopped: boolean;
}): boolean {
  return (
    ['checkout.error', 'checkout.payment.error'].includes(String(input.event)) &&
    input.type === 'api_error' &&
    input.replay === true &&
    input.stopped &&
    !!input.boundId &&
    input.requestedId === input.boundId &&
    [
      'transaction_not_ready_cannot_process_payment',
      'transaction_status_must_be_ready',
      'transaction_immutable',
    ].includes(String(input.code))
  );
}
/** Fixture-only verdict. It never grants actual account-deletion permission. */
export function proposedCheckoutHold(input: {
  legacy: boolean;
  paymentSeen: boolean;
  grantingSubscription: boolean;
  replayErrorObserved: boolean;
  replacementUnproven: boolean;
  provider: SandboxCheckoutFacts | null;
}): 'paid' | 'legacy_unproven' | 'attempt_stopped_replay_observed' | 'held' {
  if (input.paymentSeen || input.grantingSubscription || input.provider?.hold === 'paid')
    return 'paid';
  if (input.legacy) return 'legacy_unproven';
  if (input.replayErrorObserved && !input.replacementUnproven && input.provider?.hold === 'stopped')
    return 'attempt_stopped_replay_observed';
  return 'held';
}
