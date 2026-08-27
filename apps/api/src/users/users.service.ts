import { Inject, Injectable, InternalServerErrorException } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { users, workspaces } from '@declutrmail/db';
import type { SignupAttributionRef, SignupHeardFromPatch } from '@declutrmail/shared/contracts';

import { liveGrantTierForEmail } from '../common/entitlements/entitlement-grants.js';
import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';

/**
 * UsersService (D205) — owns the `users` entity.
 *
 * Cross-module writes (e.g., bootstrapping a workspace + user pair
 * during signup) live in `AuthSignupOrchestrator`, which is the one
 * documented D205 exception to the D204 "no cross-feature service
 * injection" rule.
 *
 * READ-ONLY methods here are safe to call from any feature module via
 * dependency injection. Mutations are scoped to the user's own
 * preferences (no cross-feature writes from this service).
 */
@Injectable()
export class UsersService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  /** Find by email (citext, case-insensitive). Returns null if no row. */
  async findByEmail(email: string): Promise<{ userId: string; workspaceId: string } | null> {
    const [row] = await this.db
      .select({ id: users.id, workspaceId: users.workspaceId })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    return row ? { userId: row.id, workspaceId: row.workspaceId } : null;
  }

  /** Find by id. Returns the full row or null. */
  async findById(userId: string) {
    const [row] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    return row ?? null;
  }

  /**
   * Patch `users.preferences` with a shallow merge. Used by the active-
   * mailbox selector so the user's chosen default mailbox persists
   * across sessions.
   *
   * ATOMIC in-database merge (`||`), not read-modify-write: a JS-side
   * merge computed from a prior SELECT overwrites any key another
   * writer changed in between — the lost-update that let a settings
   * save resurrect a concurrent one-click unsubscribe (D165). The `||`
   * touches only the patch's own top-level keys under the row lock.
   * The CASE repairs a malformed non-object root first: jsonb `||`
   * on an array/scalar root CONCATENATES into an array.
   */
  async patchPreferences(userId: string, patch: Record<string, unknown>): Promise<void> {
    const updated = await this.db
      .update(users)
      .set({
        preferences: sql`CASE
          WHEN jsonb_typeof(${users.preferences}) = 'object' THEN ${users.preferences}
          ELSE '{}'::jsonb
        END || ${JSON.stringify(patch)}::jsonb`,
      })
      .where(eq(users.id, userId))
      .returning({ id: users.id });
    if (updated.length === 0) {
      throw new InternalServerErrorException(`User ${userId} not found.`);
    }
  }

  /**
   * Atomically merge a partial patch into `preferences.emailPrefs`
   * (D165). Nested twin of `patchPreferences`: the sub-bag is merged
   * key-by-key IN SQL from the row's current value, so a concurrent
   * one-click unsubscribe flip of a key this patch does not carry
   * survives. A JS-computed sub-bag would replace it wholesale from a
   * stale read. The CASE arms repair malformation at both levels — a
   * non-object ROOT (jsonb_set with a text path on an array root
   * raises an error) and a non-object `emailPrefs` (`jsonb_set`
   * silently no-ops on a broken path). Returns the post-merge
   * preferences bag for response envelopes.
   */
  async mergeEmailPrefs(
    userId: string,
    patch: Record<string, boolean>,
  ): Promise<Record<string, unknown>> {
    const root = sql`CASE
      WHEN jsonb_typeof(${users.preferences}) = 'object' THEN ${users.preferences}
      ELSE '{}'::jsonb
    END`;
    const [row] = await this.db
      .update(users)
      .set({
        preferences: sql`jsonb_set(
          CASE
            WHEN jsonb_typeof(${root} -> 'emailPrefs') = 'object'
              THEN ${root}
            ELSE ${root} || '{"emailPrefs": {}}'::jsonb
          END,
          '{emailPrefs}',
          CASE
            WHEN jsonb_typeof(${root} -> 'emailPrefs') = 'object'
              THEN ${root} -> 'emailPrefs'
            ELSE '{}'::jsonb
          END || ${JSON.stringify(patch)}::jsonb
        )`,
      })
      .where(eq(users.id, userId))
      .returning({ preferences: users.preferences });
    if (!row) {
      throw new InternalServerErrorException(`User ${userId} not found.`);
    }
    return row.preferences as Record<string, unknown>;
  }

  /** Persist the browser's validated IANA zone for local-time features. */
  async setTimezone(userId: string, timezone: string): Promise<void> {
    const updated = await this.db
      .update(users)
      .set({ timezone })
      .where(eq(users.id, userId))
      .returning({ id: users.id });
    if (updated.length === 0) {
      throw new InternalServerErrorException(`User ${userId} not found.`);
    }
  }

  /**
   * Insert a workspace + user pair as the first step of a new signup.
   * MUST be called inside a transaction provided by the orchestrator
   * so the workspace insert rolls back if the user insert loses an
   * `users.email` UNIQUE race.
   *
   * Returns the new ids. The orchestrator owns the race-recovery path.
   *
   * The new workspace opens at whatever tier a complimentary grant for
   * this email says, defaulting to Free. Applied HERE rather than as a
   * follow-up write so a comped person is never Free for the length of
   * a request — onboarding reads entitlements immediately, and a
   * first-run that briefly shows Free limits is the whole reason grants
   * are keyed on email instead of workspace id.
   */
  async insertWorkspaceAndUser(
    tx: DrizzleDb,
    email: string,
    signupAttributionRef?: SignupAttributionRef,
  ): Promise<{ userId: string; workspaceId: string }> {
    const grantedTier = await liveGrantTierForEmail(tx, email);
    const [workspace] = await tx
      .insert(workspaces)
      .values({ name: `${email}'s workspace`, ...(grantedTier ? { tier: grantedTier } : {}) })
      .returning({ id: workspaces.id });
    if (!workspace) {
      throw new InternalServerErrorException('Failed to bootstrap a workspace.');
    }
    const [user] = await tx
      .insert(users)
      .values({
        workspaceId: workspace.id,
        email,
        ...(signupAttributionRef ? { signupAttributionRef } : {}),
      })
      .onConflictDoNothing({ target: users.email })
      .returning({ id: users.id });
    if (!user) {
      // Race lost — caller catches via sentinel and re-selects winner.
      throw new EmailRaceLostError();
    }
    return { userId: user.id, workspaceId: workspace.id };
  }

  /**
   * Set-once self-report. A second PATCH is a no-op that returns the
   * already-stored values — tracked `ref` is never overwritten here.
   */
  async recordSignupHeardFrom(
    userId: string,
    patch: SignupHeardFromPatch,
  ): Promise<{ heardFrom: string; detail: string | null; alreadySet: boolean }> {
    const detail = patch.heardFrom === 'other' ? patch.detail : null;
    const updated = await this.db
      .update(users)
      .set({
        signupAttributionHeardFrom: patch.heardFrom,
        signupAttributionHeardDetail: detail,
      })
      .where(and(eq(users.id, userId), isNull(users.signupAttributionHeardFrom)))
      .returning({
        heardFrom: users.signupAttributionHeardFrom,
        detail: users.signupAttributionHeardDetail,
      });
    if (updated[0]?.heardFrom) {
      return {
        heardFrom: updated[0].heardFrom,
        detail: updated[0].detail,
        alreadySet: false,
      };
    }
    const current = await this.findById(userId);
    if (!current) {
      throw new InternalServerErrorException(`User ${userId} not found.`);
    }
    return {
      heardFrom: current.signupAttributionHeardFrom ?? patch.heardFrom,
      detail: current.signupAttributionHeardDetail,
      alreadySet: current.signupAttributionHeardFrom !== null,
    };
  }
}

/**
 * Sentinel thrown by `insertWorkspaceAndUser` when the
 * `users.email` UNIQUE constraint loses to a concurrent signup. The
 * orchestrator catches it, rolls back the transaction, and re-selects
 * the winning row.
 */
export class EmailRaceLostError extends Error {
  constructor() {
    super('users.email UNIQUE race lost — caller should re-select winner.');
    this.name = 'EmailRaceLostError';
  }
}
