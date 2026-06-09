import {
  actionJobStatus,
  gmailCategory,
  undoActionKind,
  type ActionJobStatus as DbActionJobStatus,
  type GmailCategory as DbGmailCategory,
  type UndoActionKind as DbUndoActionKind,
} from '@declutrmail/db';
import type {
  ActionJobStatus as SharedActionJobStatus,
  GmailCategory as SharedGmailCategory,
  UndoActionKind as SharedUndoActionKind,
} from '@declutrmail/shared/contracts';
import { describe, expect, it } from 'vitest';

/**
 * Cross-package pg_enum contract tests.
 *
 * `@declutrmail/shared` keeps a zero-server-dependency posture so the
 * FE (apps/web) can import it without pulling `@declutrmail/db` (which
 * carries Drizzle + postgres.js). The shared mirrors are therefore
 * hand-rolled literal unions; this test is what guarantees they stay
 * aligned with the DB pg_enum source of truth at compile time AND at
 * runtime.
 *
 * Pattern mirrors `packages/events/src/events.ts:282` (`satisfies
 * Record<EventTopic, …>`) — a new enum value added on either side
 * without updating the other is a compile error, not a silent drift.
 *
 * Apps/api is the natural home for this test: it depends on BOTH
 * `@declutrmail/db` and `@declutrmail/shared`, so both types are in
 * scope here (and only here).
 */
describe('pg_enum ↔ shared/contracts mirror contract (D38)', () => {
  it('ActionJobStatus mirror is bidirectionally assignable to the DB enum', () => {
    // Compile-time gate (each direction independently — TS unions are
    // structural, not nominal, so equality requires both arrows).
    const fromShared = (x: SharedActionJobStatus): DbActionJobStatus => x;
    const fromDb = (x: DbActionJobStatus): SharedActionJobStatus => x;
    void fromShared;
    void fromDb;
    // Runtime gate — the literal arrays match.
    expect([...actionJobStatus.enumValues].sort()).toEqual(
      ['queued', 'executing', 'done', 'failed'].sort(),
    );
  });

  it('UndoActionKind mirror is bidirectionally assignable to the DB enum', () => {
    const fromShared = (x: SharedUndoActionKind): DbUndoActionKind => x;
    const fromDb = (x: DbUndoActionKind): SharedUndoActionKind => x;
    void fromShared;
    void fromDb;
    expect([...undoActionKind.enumValues].sort()).toEqual(
      ['archive', 'unsubscribe', 'later', 'apply-rule'].sort(),
    );
  });

  it('GmailCategory mirror is bidirectionally assignable to the DB enum', () => {
    const fromShared = (x: SharedGmailCategory): DbGmailCategory => x;
    const fromDb = (x: DbGmailCategory): SharedGmailCategory => x;
    void fromShared;
    void fromDb;
    expect([...gmailCategory.enumValues].sort()).toEqual(
      ['primary', 'promotions', 'social', 'updates', 'forums'].sort(),
    );
  });
});
