/** Published descriptions of existing billing behavior; no policy decisions live here. */
export const CLEANUP_COUNT_NOTE =
  'One cleanup action counts per sender. Bulk cleanup counts once for each sender; a combined Later and Delete action counts once. Unsubscribe plus a separate Archive or Delete counts twice. Keep and Unarchive are free; failed actions and mail-moving actions that move no messages do not count. An unsubscribe request still counts, and Undo does not restore a used action.';
export const CLEANUP_RESET_NOTE =
  'The Free quota resets each month on your signup anniversary in UTC, using the last day for shorter months. Billing shows your next reset date.';
export const BRIEF_PROCESSING_NOTE =
  'Daily Brief may send the sender, subject line, and Gmail preview snippet to Anthropic to compose a summary. Full email contents and attachments are never sent.';
export const RAZORPAY_LIMITATIONS_NOTE =
  'Razorpay supports cancellation, but plan changes, payment-method updates, pausing, and undoing cancellation require support.';
export const CHECKOUT_TOTAL_NOTE =
  'Taxes, discounts, and the final amount due are confirmed at checkout.';
export const PROVIDER_SWITCH_NOTE =
  'To switch billing currency or provider, cancel your current subscription and wait for it to end before subscribing again. Contact support for help; an active or paused subscription blocks a new checkout.';
export const BILLING_MANAGEMENT_NOTE =
  'Open the account menu → Billing, or Settings → Plan & billing, to cancel, review invoices, or manage your payment method. Cancellation stops renewal; it is not a refund. Paddle supports self-serve plan and payment-method changes.';
