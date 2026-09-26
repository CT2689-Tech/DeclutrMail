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
 * (D245). Read `status` first: this is the one code a `done` row carries.
 *
 * Shared because the worker writes it, the API's batch status and
 * Activity read it, and single-sender screens must tell it apart from
 * "nothing matched" — every place has to agree on the exact string.
 */
export const LABEL_SENDER_PROTECTED_ERROR_CODE = 'LABEL_SENDER_PROTECTED';
