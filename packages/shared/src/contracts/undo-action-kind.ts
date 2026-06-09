/**
 * UndoActionKind — cross-package mirror of the `undo_action_kind`
 * Postgres enum.
 *
 * The DB schema in `packages/db/src/schema/undo-journal.ts` is the
 * canonical source. This mirror exists because `@declutrmail/shared`
 * is zero-server-dep (no `@declutrmail/db` import path) — the contract
 * test lives in `apps/api/src/undo/undo.types.ts` and fails-compile if
 * the two ever drift.
 *
 * Adding a verb: update the pgEnum, the migration, AND this union.
 * The contract assertion will block the next typecheck if you miss one.
 */
export type UndoActionKind = 'archive' | 'unsubscribe' | 'later' | 'apply-rule' | 'delete';
