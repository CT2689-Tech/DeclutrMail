import { WS2_COPY } from '@declutrmail/shared/copy/launch';

/** Published descriptions of existing billing behavior; no policy decisions live here. */
export const CLEANUP_COUNT_NOTE = WS2_COPY.simplify.billing.meterRule;
export const CLEANUP_RESET_NOTE =
  'The Free quota resets each month on your signup anniversary in UTC, using the last day for shorter months. Billing shows your next reset date.';
export const BRIEF_PROCESSING_NOTE =
  'Daily Brief may send the sender, subject line, and Gmail preview snippet to Anthropic to compose a summary. Full email contents and attachments are never sent.';
export const RAZORPAY_LIMITATIONS_NOTE =
  'If you pay in rupees, email support@declutrmail.com to change, pause or restart your plan. You can cancel here.';
export const CHECKOUT_TOTAL_NOTE =
  'Taxes, discounts, and the final amount due are confirmed at checkout.';
export const PROVIDER_SWITCH_NOTE =
  'To pay in another currency, cancel first and subscribe again after your plan ends.';
export const BILLING_MANAGEMENT_NOTE =
  'Open the account menu → Billing, or Settings → Plan & billing, to cancel, review invoices, or manage your payment method. Cancellation stops renewal; it is not a refund. Paddle supports self-serve plan and payment-method changes.';
