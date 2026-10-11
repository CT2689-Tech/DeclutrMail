import type { ProductEventsPort } from '@declutrmail/shared/analytics/product-events';

import { recordProductEvent } from './product-events.port.js';

/** Signup and Gmail-connect funnel rows. No email address in the props. */
export function recordConnectFunnel(
  port: ProductEventsPort | undefined,
  input: {
    userId: string;
    isNewSignup: boolean;
    mode: 'login' | 'connect' | 'reconnect';
  },
): void {
  if (input.isNewSignup) {
    recordProductEvent(port, 'signup_completed', { provider: 'google' }, input.userId);
  }
  recordProductEvent(port, 'gmail_connected', { mode: input.mode }, input.userId);
}
