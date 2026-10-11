/**
 * Paddle does not enforce "one refund per customer". This is the local
 * refusal. A revoked Pass grant or a subscription with
 * cancel_source='refund' counts as the prior refund.
 */
export function refundOnceVerdict(input: {
  priorPassRefund: boolean;
  priorSubscriptionRefund: boolean;
  override: boolean;
}): { allow: boolean; message: string } {
  if (!input.priorPassRefund && !input.priorSubscriptionRefund) {
    return { allow: true, message: 'No prior refund is recorded for this customer.' };
  }
  if (input.override) {
    return {
      allow: true,
      message: 'A prior refund is recorded. --override was set, so this check is not blocking.',
    };
  }
  const which = input.priorPassRefund ? 'revoked Backlog Pass' : 'refunded subscription';
  return {
    allow: false,
    message: `Refusing a second refund: this customer already has a ${which}. Pass --override for support.`,
  };
}
