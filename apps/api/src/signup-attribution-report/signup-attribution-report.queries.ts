import { sql } from 'drizzle-orm';
import { users } from '@declutrmail/db';

/** One statement gives the groups and an independent grand total from one snapshot. */
export function signupAttributionCountsQuery() {
  return sql`
    SELECT
      ${users.signupAttributionHeardFrom} AS channel,
      count(*)::text AS account_count,
      grouping(${users.signupAttributionHeardFrom}) AS is_total,
      statement_timestamp() AS observed_at
    FROM ${users}
    GROUP BY GROUPING SETS ((${users.signupAttributionHeardFrom}), ())
  `;
}
