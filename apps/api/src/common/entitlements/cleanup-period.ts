/**
 * Monthly cleanup-quota period (A3, D19).
 *
 * The period is anchored on the workspace's signup instant
 * (`workspaces.created_at`) and every period start is computed FROM THE
 * ORIGINAL ANCHOR — `createdAt + N months` — never "previous reset plus
 * one month", so month clamping self-heals instead of drifting: a
 * Jan 31 signup yields Feb 28 (29 in a leap year), then Mar 31 again.
 *
 * Timezone is explicit: all arithmetic is UTC calendar math. "One month
 * later" means the same UTC day-of-month and time-of-day, clamped to
 * the target month's last day. The server computes both bounds and
 * ships `resetsAt` on the wire — the browser never derives it (a
 * per-workspace anniversary is not derivable client-side, and two
 * authorities for one sentence is the bug class this repo keeps
 * fixing).
 *
 * At the EXACT reset instant the new period has begun: `periodStart ===
 * now` and the quota is fresh.
 */
export interface CleanupPeriod {
  /** Inclusive start of the current quota period. */
  periodStart: Date;
  /** The next reset instant (exclusive end of the current period). */
  resetsAt: Date;
}

/** Anchor + N months in UTC, day-of-month clamped to the target month. */
function addMonthsClampedUtc(anchor: Date, months: number): Date {
  const targetMonth = anchor.getUTCMonth() + months;
  const lastDayOfTarget = new Date(
    Date.UTC(anchor.getUTCFullYear(), targetMonth + 1, 0),
  ).getUTCDate();
  return new Date(
    Date.UTC(
      anchor.getUTCFullYear(),
      targetMonth,
      Math.min(anchor.getUTCDate(), lastDayOfTarget),
      anchor.getUTCHours(),
      anchor.getUTCMinutes(),
      anchor.getUTCSeconds(),
      anchor.getUTCMilliseconds(),
    ),
  );
}

export function cleanupPeriodFor(workspaceCreatedAt: Date, now: Date): CleanupPeriod {
  let months =
    (now.getUTCFullYear() - workspaceCreatedAt.getUTCFullYear()) * 12 +
    (now.getUTCMonth() - workspaceCreatedAt.getUTCMonth());
  // The calendar-month diff overshoots by exactly one when `now` sits
  // before the anchor's (clamped) day/time inside its month.
  if (months > 0 && addMonthsClampedUtc(workspaceCreatedAt, months) > now) {
    months -= 1;
  }
  if (months < 0) {
    months = 0; // clock skew — never a period before the anchor
  }
  return {
    periodStart: addMonthsClampedUtc(workspaceCreatedAt, months),
    resetsAt: addMonthsClampedUtc(workspaceCreatedAt, months + 1),
  };
}
