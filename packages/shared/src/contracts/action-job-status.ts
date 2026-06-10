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
