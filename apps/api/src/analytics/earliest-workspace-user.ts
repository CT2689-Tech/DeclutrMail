import { asc, eq } from 'drizzle-orm';

import { users } from '@declutrmail/db';

import type { DrizzleDb } from '../db/db.module.js';

/**
 * Earliest member of a workspace, for funnel rows that join on user id.
 * Selects the id only — an email address never leaves this query.
 */
export async function earliestWorkspaceUserId(
  db: Pick<DrizzleDb, 'select'>,
  workspaceId: string,
): Promise<string | undefined> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.workspaceId, workspaceId))
    .orderBy(asc(users.createdAt), asc(users.id))
    .limit(1);
  return row?.id;
}
