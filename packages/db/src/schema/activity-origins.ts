import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { activityLog } from './activity-log';
import { oauthClients } from './oauth-clients';
import { oauthGrants } from './oauth-grants';

/**
 * Which connected app made a change on its own, with no confirmation in
 * DeclutrMail (ADR-0048, spec §7) — today only the connector's
 * `protect_sender`. Activity then names the app on that row ("By <app>"),
 * not the person.
 *
 * `action_origins` covers changes with a job (a confirmed cleanup, an
 * undo); a Protect writes an activity row and no job, so its origin is
 * keyed by the row instead. It goes when the row does.
 */
export const activityOrigins = pgTable(
  'activity_origins',
  {
    activityLogId: uuid('activity_log_id')
      .primaryKey()
      .references(() => activityLog.id, { onDelete: 'cascade' }),
    grantId: uuid('grant_id').references(() => oauthGrants.id, { onDelete: 'set null' }),
    clientId: text('client_id').references(() => oauthClients.clientId, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    /** FK cascade indexes (mig 0073 rule): parent deletes must not seq-scan. */
    index('activity_origins_grant_id_idx').on(t.grantId),
    index('activity_origins_client_id_idx').on(t.clientId),
  ],
);

export type ActivityOrigin = typeof activityOrigins.$inferSelect;
