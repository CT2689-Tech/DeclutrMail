import { CHECKOUT_GEO_HEADER } from '@declutrmail/shared/billing/checkout-geo-header';

/**
 * Nest `enableCors.allowedHeaders`. A custom request header the web
 * client sends must be listed here or the browser OPTIONS preflight
 * fails and `fetch` throws TypeError with no HTTP status
 * (DECLUTRMAIL-WEB-2V — #1020 India checkout geo token).
 */
export const CORS_ALLOWED_HEADERS: readonly string[] = [
  'Content-Type',
  'X-CSRF-Token',
  // Per-request mailbox override (CurrentMailboxGuard, D155 + D205).
  // The web client stamps it whenever a hook passes `mailboxId`.
  'X-Active-Mailbox-Id',
  'Idempotency-Key',
  CHECKOUT_GEO_HEADER,
];
