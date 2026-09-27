import { isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { senderPolicies, type schema } from '@declutrmail/db';

/**
 * Schedule a Later's return (D245: "Later is a timed current-mail action").
 *
 * A Later move and its return timer are one terminal state, so whoever
 * records the move writes the timer in the same transaction: the wake
 * sweep and the Later page read only this row. Two workers record Later
 * moves — `LabelActionWorker` and `AutopilotActionWorker` — and both call
 * this. While they were two copies, D245 moved one of them and not the
 * other, and an approved Autopilot Later moved mail with no way back
 * (MISTAKES 2026-09-25).
 *
 * `setAt` is when Gmail confirmed the move. It is half of the timer
 * version that the wake sweep and Wake now pin. A user's Later replaces
 * any earlier timer and its return-attempt state — the newest Later the
 * user asked for wins. `keepExisting` is for moves the user did not time
 * themselves (Autopilot): a sender has one timer (D78), so the new mail
 * returns with the one already set, and the user's time, note and any
 * queued Wake now survive.
 */
export async function scheduleLaterReturn(
  tx: Pick<PostgresJsDatabase<typeof schema>, 'insert'>,
  timer: { mailboxAccountId: string; senderKey: string; wakeAt: Date; setAt: Date },
  options: { keepExisting?: boolean } = {},
): Promise<void> {
  await tx
    .insert(senderPolicies)
    .values({
      mailboxAccountId: timer.mailboxAccountId,
      senderKey: timer.senderKey,
      snoozedUntil: timer.wakeAt,
      snoozedAt: timer.setAt,
    })
    .onConflictDoUpdate({
      target: [senderPolicies.mailboxAccountId, senderPolicies.senderKey],
      set: {
        snoozedUntil: timer.wakeAt,
        snoozedAt: timer.setAt,
        snoozedReason: null,
        snoozeWakeLastAttemptAt: null,
        snoozeWakeLastFailedAt: null,
        snoozeWakeFailureCount: 0,
        snoozeWakeFailureKind: null,
        updatedAt: sql`now()`,
      },
      ...(options.keepExisting ? { setWhere: isNull(senderPolicies.snoozedUntil) } : {}),
    });
}
