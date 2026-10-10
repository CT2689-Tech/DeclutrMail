import { expect, it } from 'vitest';
import { assertWorkerRefundRestoreDisabled } from '../billing-upgrade-refund.service.js';

it('keeps automatic restoration API-owned even if a worker flag is accidentally enabled', () => {
  expect(() => assertWorkerRefundRestoreDisabled({})).not.toThrow();
  expect(() =>
    assertWorkerRefundRestoreDisabled({ BILLING_UPGRADE_REFUND_RESTORE_ENABLED: 'false' }),
  ).not.toThrow();
  expect(() =>
    assertWorkerRefundRestoreDisabled({ BILLING_UPGRADE_REFUND_RESTORE_ENABLED: 'true' }),
  ).toThrow('API owns');
});
