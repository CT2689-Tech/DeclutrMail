import { describe, expect, it } from 'vitest';

import { refundOnceVerdict } from './refund-once';

describe('refundOnceVerdict', () => {
  it('allows the first refund', () => {
    expect(
      refundOnceVerdict({
        priorPassRefund: false,
        priorSubscriptionRefund: false,
        override: false,
      }),
    ).toMatchObject({ allow: true });
  });

  it('refuses a second refund and allows an override', () => {
    const refused = refundOnceVerdict({
      priorPassRefund: true,
      priorSubscriptionRefund: false,
      override: false,
    });
    expect(refused.allow).toBe(false);
    expect(refused.message).toContain('revoked Backlog Pass');
    expect(
      refundOnceVerdict({ priorPassRefund: true, priorSubscriptionRefund: false, override: true })
        .allow,
    ).toBe(true);
  });
});
