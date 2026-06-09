// @declutrmail/shared/contracts — pg_enum mirrors for FE consumers.
//
// Closed string unions that mirror Postgres enums declared in
// `@declutrmail/db`. Replicated here (rather than imported) because
// `@declutrmail/shared` keeps a zero-server-dependency posture — the
// FE (apps/web) does NOT depend on `@declutrmail/db` (it would pull
// Drizzle + postgres.js into the browser bundle).
//
// The DB schema is the SOURCE OF TRUTH; these unions are mirrors.
// A cross-package `satisfies` contract test in `apps/api` (where both
// `@declutrmail/db` and `@declutrmail/shared` are in scope) asserts
// the two stay in lock-step at compile time. Pattern: see
// `packages/events/src/events.ts:282` (`satisfies Record<…>`).

/**
 * Mirror of `action_job_status` pg_enum (D226). Lifecycle of an
 * `action_jobs` row — drives the FE poll + the `failed` surface.
 * Source of truth: `packages/db/src/schema/action-jobs.ts`.
 */
export type ActionJobStatus = 'queued' | 'executing' | 'done' | 'failed';

/**
 * Mirror of `undo_action_kind` pg_enum (D35, D58, D232). The
 * destructive verbs (D227) + `apply-rule` for Autopilot rule
 * applications (D99). Source of truth:
 * `packages/db/src/schema/undo-journal.ts`.
 */
export type UndoActionKind = 'archive' | 'unsubscribe' | 'later' | 'apply-rule';

/**
 * Mirror of `gmail_category` pg_enum (D222 — Gmail's own labels, NOT
 * a learned prediction). Source of truth:
 * `packages/db/src/schema/senders.ts`.
 */
export type GmailCategory = 'primary' | 'promotions' | 'social' | 'updates' | 'forums';
