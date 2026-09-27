/**
 * ActionJobStatus — cross-package mirror of the `action_job_status`
 * Postgres enum.
 *
 * The DB schema in `packages/db/src/schema/action-jobs.ts` is the
 * canonical source. This mirror exists because `@declutrmail/shared`
 * is zero-server-dep (no `@declutrmail/db` import path) — the contract
 * test in `apps/api/src/actions/actions.types.ts` fails-compile if the
 * API/DB type and this mirror ever drift.
 */
export type ActionJobStatus = 'queued' | 'executing' | 'done' | 'failed';

/**
 * `action_jobs.error_code` on a label job (Archive / Later / Delete) that
 * ended `done` with nothing changed because its sender was Protected when
 * the job ran and the user had not confirmed acting on a Protected sender
 * (D245). Read `status` first: this is the one code a `done` row is written
 * with on purpose.
 *
 * Shared because the worker writes it, the API's batch status and
 * Activity read it, and single-sender screens must tell it apart from
 * "nothing matched" — every place has to agree on the exact string.
 */
export const LABEL_SENDER_PROTECTED_ERROR_CODE = 'LABEL_SENDER_PROTECTED';

/**
 * `action_jobs.error_code` on a job stopped because its sender — for a
 * legacy message list, one of its senders — became Protected without the
 * user's consent, where a skip would not be true (D245): a recovery attempt
 * whose review did not say so (founder decision 2026-09-26), or a job that
 * may already have reached Gmail — an automatic retry, or a request after
 * one that landed (2026-09-27). It ends `failed`, not skipped, so the
 * lineage stays reviewable: the next review reads what Gmail shows, names
 * the Protected sender, and its "…anyway" confirm is the consent.
 */
export const RECOVERY_SENDER_PROTECTED_ERROR_CODE = 'RECOVERY_SENDER_PROTECTED';

/**
 * `action_jobs.error_code` on an unsubscribe job ended `failed` because its
 * sender was Protected when its request was due (D245) — nothing was sent,
 * so every surface reads it as "not sent", never as a failure. Job-only,
 * like `UNSUB_NOT_ONE_CLICK`/`UNSUB_TARGET_REJECTED` — never a live API
 * response, so it is not in the `ErrorCode` registry the way
 * `UNSUB_SEND_DISABLED`/`PROTECTED_SENDER` are.
 */
export const UNSUB_SENDER_PROTECTED_ERROR_CODE = 'UNSUB_SENDER_PROTECTED';
