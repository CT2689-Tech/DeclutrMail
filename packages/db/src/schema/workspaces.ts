import { sql } from 'drizzle-orm';
import { boolean, integer, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Workspaces — top-level tenant boundary (D17–D21 pricing tiers).
 *
 * Every user belongs to exactly one workspace at launch. A workspace
 * carries the billing tier and seat count; per-user preferences live on
 * `users.preferences`. Workspaces enable the Team/Enterprise tier
 * post-launch without re-modeling.
 *
 * No body data; no privacy concerns.
 */

export const workspaceTier = pgEnum('workspace_tier', [
  'free',
  'plus',
  'pro',
  'team',
  'enterprise',
]);

export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  tier: workspaceTier('tier').notNull().default('free'),
  seatCount: integer('seat_count').notNull().default(1),
  foundingMember: boolean('founding_member').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .default(sql`now()`),
});

export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;
