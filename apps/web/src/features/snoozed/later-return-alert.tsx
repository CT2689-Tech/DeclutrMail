'use client';

import { Button, tokens } from '@declutrmail/shared';
import type { LaterReturnFailureKind } from '@declutrmail/shared/contracts';

import { useUserTimeZone } from '@/features/auth/api/use-me';
import { ApiError } from '@/lib/api/client';

import { useLaterRecovery, useWakeRecoveryNow } from './api/use-snoozed';

const { color, font, text } = tokens;

/**
 * Persistent all-tier recovery notice for a missed Later return.
 * Successful returns stay silent; the banner disappears once the
 * worker clears the timer and the recovery summary refetches.
 */
export function LaterReturnAlert({ enabled }: { enabled: boolean }) {
  const recovery = useLaterRecovery({ enabled });
  const wake = useWakeRecoveryNow();
  const timeZone = useUserTimeZone();
  const summary = recovery.data;
  const issue = summary?.firstIssue;

  if (!issue || !summary || summary.affectedCount === 0) return null;

  const sender = issue.displayName.trim() || issue.email;

  return (
    <div
      role="alert"
      data-testid="later-return-alert"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        padding: '10px 20px',
        background: color.dangerBg,
        borderBottom: `1px solid ${color.dangerBorder}`,
        fontFamily: font.sans,
        flexWrap: 'wrap',
      }}
    >
      <span style={{ fontSize: text.md, fontWeight: 600, color: color.dangerText, minWidth: 0 }}>
        {laterReturnIssueCopy({
          count: summary.affectedCount,
          sender,
          lastTried: issue.lastReturnAttemptAt
            ? formatAttempt(issue.lastReturnAttemptAt, timeZone)
            : null,
          failureKind: issue.returnFailureKind,
          retryAction: 'Try return now',
        })}
      </span>
      <Button
        tone="default"
        size="sm"
        disabled={wake.isPending}
        onClick={() => wake.mutate({ senderId: issue.senderId })}
      >
        {wake.isPending ? 'Starting…' : 'Try return now'}
      </Button>
      {wake.isError ? (
        <span role="alert" style={{ width: '100%', fontSize: text.sm, color: color.dangerText }}>
          {wake.error instanceof ApiError && wake.error.status === 503
            ? "Returns aren't available right now. Try again in a moment."
            : "Couldn't start the return. Try again in a moment."}
        </span>
      ) : null}
    </div>
  );
}

/**
 * The ONE wording for an unconfirmed Later return. This banner is its
 * only surface — the Later screen used to repeat it in a second notice,
 * so the same failure rendered twice on /later.
 * `retryAction` is the label of the button the banner actually shows.
 */
export function laterReturnIssueCopy({
  count,
  sender,
  lastTried,
  failureKind,
  retryAction,
}: {
  count: number;
  /** The sender the retry button acts on. */
  sender: string;
  lastTried: string | null;
  failureKind: LaterReturnFailureKind;
  retryAction: string;
}): string {
  const subject =
    count === 1 ? `${sender}'s Later return` : `${count} Later returns, starting with ${sender},`;
  const guidance =
    failureKind === 'reauthorize'
      ? `Reconnect Gmail from the account menu, then choose ${retryAction}.`
      : failureKind === 'needs_attention'
        ? `Choose ${retryAction}; if it still fails, use Help in Settings.`
        : 'Retrying automatically.';
  return [
    `${subject} could not be confirmed — nothing is deleted.`,
    ...(lastTried === null ? [] : [`Last tried ${lastTried}.`]),
    guidance,
  ].join(' ');
}

/**
 * Locale + zone pinned: this banner is server-rendered into hydrated
 * HTML on every app route (the recovery summary is prefetched by the
 * ServerAppBoundary), so both halves must be deterministic (React
 * #418; e2e hydration-smoke). Exported for the exact-string unit test.
 */
const ATTEMPT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

export function formatAttempt(iso: string, timeZone: string): string {
  const attemptedAt = new Date(iso);
  if (Number.isNaN(attemptedAt.getTime())) return 'at an unknown time';
  // Numeric parts only. `toLocaleString` inserts a narrow no-break space
  // before "PM" in Chrome and a normal space in Node, and short months
  // disagree on "Sep" versus "Sept" (React #418 on every app route,
  // including /billing where this banner is in the shell).
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h12',
  }).formatToParts(attemptedAt);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  const month = Number(read('month'));
  const day = Number(read('day'));
  const year = read('year');
  const minute = read('minute');
  let hour = Number(read('hour'));
  const period = (read('dayPeriod') ?? '').replace(/\./g, '').toUpperCase();
  if (
    !ATTEMPT_MONTHS[month - 1] ||
    !year ||
    !minute ||
    !Number.isFinite(day) ||
    !Number.isFinite(hour) ||
    (period !== 'AM' && period !== 'PM')
  ) {
    return 'at an unknown time';
  }
  if (hour === 0) hour = 12;
  return `${ATTEMPT_MONTHS[month - 1]} ${day}, ${year}, ${hour}:${minute.padStart(2, '0')} ${period}`;
}
