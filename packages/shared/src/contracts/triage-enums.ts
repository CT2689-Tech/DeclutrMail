/**
 * TriageVerdict / ProtectionReason — cross-package mirrors of the
 * `triage_verdict` and `protection_reason` Postgres enums.
 *
 * The DB schema is canonical: `packages/db/src/schema/triage-decisions.ts`
 * and `packages/db/src/schema/sender-policies.ts`. These mirrors exist
 * because `@declutrmail/shared` is zero-server-dep and the triage cascade
 * now runs here (see `../triage-engine`), including in the browser for
 * the public inbox simulator.
 *
 * Contract assertions at the end of `apps/api/src/senders/senders.types.ts`
 * fail-compile if either mirror drifts from its enum — the same guard
 * `GmailCategory` already carries.
 *
 * NOTE: these are the DATABASE spellings. The triage wire type in
 * `apps/web/src/features/triage/data.ts` uses a different dialect
 * (`manual` / `gmail-important`); `normalizeProtectionReason` in
 * `@declutrmail/shared/copy` resolves between them. Do not "fix" one to
 * match the other here.
 */
export type TriageVerdict = 'keep' | 'archive' | 'unsubscribe' | 'later';

export type ProtectionReason = 'user_defined' | 'replied' | 'starred' | 'gmail_important';
