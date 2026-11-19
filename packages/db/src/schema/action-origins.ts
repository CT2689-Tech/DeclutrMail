import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { actionJobs } from './action-jobs';
import { oauthClients } from './oauth-clients';
import { oauthGrants } from './oauth-grants';

/**
 * Which connected app started an action (ADR-0048, spec §7 "Activity").
 *
 * A person who finds mail moved deserves to know who moved it, so Activity
 * names the app. One row per `action_jobs` row the connector started,
 * written right after the enqueue; it goes when the job does.
 *
 * A side table rather than a column on `action_jobs` or `activity_log`:
 * the action pipeline and its worker stay exactly as the web app uses
 * them (ADR-0048: the connector adds no mail behavior of its own).
 *
 * `client_id` outlives `grant_id` on purpose — retention removes a grant
 * 30 days after the app is disconnected, and the Activity row should
 * still say which app it was.
 */
export const actionOrigins = pgTable(
  'action_origins',
  {
    actionJobId: uuid('action_job_id')
      .primaryKey()
      .references(() => actionJobs.id, { onDelete: 'cascade' }),
    grantId: uuid('grant_id').references(() => oauthGrants.id, { onDelete: 'set null' }),
    clientId: text('client_id').references(() => oauthClients.clientId, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    /** FK cascade indexes (mig 0073 rule): parent deletes must not seq-scan. */
    index('action_origins_grant_id_idx').on(t.grantId),
    index('action_origins_client_id_idx').on(t.clientId),
  ],
);

export type ActionOrigin = typeof actionOrigins.$inferSelect;
