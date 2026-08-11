// @declutrmail/shared/copy/postal-address — CAN-SPAM §316.5 / CASL
// physical postal address.
//
// US CAN-SPAM and Canadian CASL both require a valid physical postal
// address in COMMERCIAL email. Which kinds those are is decided by
// PRIMARY PURPOSE, not by whether a kind happens to carry an opt-out
// toggle — `COMMERCIAL_KINDS` in `packages/workers/src/email-send.worker.ts`
// is the single source of truth, and it currently holds
// sync-reminder-24h, lapse-reengagement and weekly-value-receipt.
// `sync-complete` is transactional despite being opt-out-able (it
// delivers the result of a sync the recipient asked for), and required
// account notices (deletion-scheduled, deletion-receipt) are
// transactional and exempt.
//
// ## Filling this in
//
// Set `BUSINESS_POSTAL_ADDRESS` to the registered/virtual business
// address, one array element per rendered line. Until it is set:
//
//   - the email footer renders no address block,
//   - `/contact` renders no address block, and
//   - **the send worker REFUSES every commercial kind** — see
//     `assertPostalAddressForKind`. Transactional notices still send.
//
// That refusal is the point: a missing address must be a loud, blocked
// send rather than a quiet compliance gap discovered after launch.
// Flipping it on is this one constant — no other edit.
//
// It lives in code, not an env var, deliberately: it is not a secret,
// it changes almost never, it belongs in review, and a Cloud Run
// `--set-env-vars` deploy cannot silently wipe it (the known
// full-replace trap).

/**
 * The business postal address, one line per array element.
 * EMPTY = not yet established; commercial email is blocked.
 *
 * Empty rather than `null` so there is exactly one representation of
 * "no address" and callers never juggle a nullable: every consumer
 * asks {@link hasPostalAddress} and reads the array, instead of each
 * one re-deciding what a null means.
 */
export const BUSINESS_POSTAL_ADDRESS: readonly string[] = [];

/** Is a physical postal address currently configured? */
export function hasPostalAddress(): boolean {
  return BUSINESS_POSTAL_ADDRESS.length > 0;
}

/** Single-line form for plain-text email + compact surfaces. */
export function postalAddressLine(): string | null {
  return hasPostalAddress() ? BUSINESS_POSTAL_ADDRESS.join(', ') : null;
}
