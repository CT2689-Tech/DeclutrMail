import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';

import { users } from '@declutrmail/db';

import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';

/**
 * Bounce/complaint suppression list (D162).
 *
 * STORAGE CHOICE (documented per the U17 spec): no new table —
 * suppression rides in `users.preferences.emailSuppression` (jsonb).
 * Every transactional recipient IS a user (we only ever email
 * `users.email`), so keying suppression on the user row gives the
 * lookup away for free in the same row the worker already reads, and
 * deletion of the user deletes the suppression with it (D232-clean).
 * If a post-launch feature ever emails non-users, suppression graduates
 * to its own table — flagged then, not speculatively now.
 *
 * Shape: `{ reason: 'bounce' | 'complaint', at: ISO-8601, source: 'resend' }`.
 *
 * Suppression is permanent until manually cleared (SQL) — Resend has
 * already told us the mailbox rejects us or the user marked us as
 * spam; continuing to send burns domain reputation.
 */
export type SuppressionReason = 'bounce' | 'complaint';

export interface EmailSuppression {
  reason: SuppressionReason;
  at: string;
  source: 'resend';
}

@Injectable()
export class EmailSuppressionService {
  private readonly logger = new Logger(EmailSuppressionService.name);

  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  /** True when this address must NOT be sent to. */
  async isSuppressed(email: string): Promise<boolean> {
    const [row] = await this.db
      .select({ preferences: users.preferences })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (!row) return false;
    return readSuppression(row.preferences) !== null;
  }

  /**
   * Record a bounce/complaint for `email`. Returns 'suppressed' when a
   * matching user row was updated, 'unknown_recipient' when the address
   * maps to no user (logged — an operator can correlate with Resend's
   * dashboard; nothing to write since only users are ever recipients).
   *
   * First-write-wins: an existing suppression is never overwritten, so
   * the original reason/timestamp survive replayed webhooks.
   */
  async suppress(
    email: string,
    reason: SuppressionReason,
  ): Promise<'suppressed' | 'already_suppressed' | 'unknown_recipient'> {
    const [row] = await this.db
      .select({ id: users.id, preferences: users.preferences })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (!row) {
      this.logger.warn(`email.suppress.unknown_recipient reason=${reason}`);
      return 'unknown_recipient';
    }
    if (readSuppression(row.preferences) !== null) {
      return 'already_suppressed';
    }
    const suppression: EmailSuppression = {
      reason,
      at: new Date().toISOString(),
      source: 'resend',
    };
    // jsonb_set on the live column (not a read-merge-write) so a
    // concurrent preferences patch cannot drop the suppression.
    await this.db
      .update(users)
      .set({
        preferences: sql`jsonb_set(${users.preferences}, '{emailSuppression}', ${JSON.stringify(suppression)}::jsonb, true)`,
      })
      .where(eq(users.id, row.id));
    this.logger.log(`email.suppressed userId=${row.id} reason=${reason}`);
    return 'suppressed';
  }
}

/** Parse the suppression slot out of a raw preferences bag. */
export function readSuppression(preferences: unknown): EmailSuppression | null {
  if (typeof preferences !== 'object' || preferences === null) return null;
  const raw = (preferences as Record<string, unknown>).emailSuppression;
  if (typeof raw !== 'object' || raw === null) return null;
  const candidate = raw as Record<string, unknown>;
  if (candidate.reason !== 'bounce' && candidate.reason !== 'complaint') return null;
  return candidate as unknown as EmailSuppression;
}
