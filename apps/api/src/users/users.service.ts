import { Inject, Injectable, InternalServerErrorException } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { users, workspaces } from '@declutrmail/db';

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
   */
  async patchPreferences(userId: string, patch: Record<string, unknown>): Promise<void> {
    const current = await this.findById(userId);
    if (!current) {
      throw new InternalServerErrorException(`User ${userId} not found.`);
    }
    const merged = { ...(current.preferences as Record<string, unknown>), ...patch };
    await this.db.update(users).set({ preferences: merged }).where(eq(users.id, userId));
  }

  /**
   * Insert a workspace + user pair as the first step of a new signup.
   * MUST be called inside a transaction provided by the orchestrator
   * so the workspace insert rolls back if the user insert loses an
   * `users.email` UNIQUE race.
   *
   * Returns the new ids. The orchestrator owns the race-recovery path.
   */
  async insertWorkspaceAndUser(
    tx: DrizzleDb,
    email: string,
  ): Promise<{ userId: string; workspaceId: string }> {
    const [workspace] = await tx
      .insert(workspaces)
      .values({ name: `${email}'s workspace` })
      .returning({ id: workspaces.id });
    if (!workspace) {
      throw new InternalServerErrorException('Failed to bootstrap a workspace.');
    }
    const [user] = await tx
      .insert(users)
      .values({ workspaceId: workspace.id, email })
      .onConflictDoNothing({ target: users.email })
      .returning({ id: users.id });
    if (!user) {
      // Race lost — caller catches via sentinel and re-selects winner.
      throw new EmailRaceLostError();
    }
    return { userId: user.id, workspaceId: workspace.id };
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
