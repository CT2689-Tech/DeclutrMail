'use client';

import { Button, tokens } from '@declutrmail/shared';
import type { LaterReturnFailureKind } from '@declutrmail/shared/contracts';

import { useUserTimeZone } from '@/features/auth/api/use-me';
import { ApiError } from '@/lib/api/client';

import { useLaterRecovery, useWakeRecoveryNow } from './api/use-snoozed';

const { color, font } = tokens;

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
      <span style={{ fontSize: 13, fontWeight: 600, color: color.danger, minWidth: 0 }}>
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
        <span role="alert" style={{ width: '100%', fontSize: 12, color: color.danger }}>
          {wake.error instanceof ApiError && wake.error.status === 503
            ? "Returns aren't available right now. Try again in a moment."
            : "Couldn't start the return. Try again in a moment."}
        </span>
      ) : null}
    </div>
  );
}

/**
 * The ONE wording for an unconfirmed Later return. The app-wide banner
 * above and the Later screen's own notice used to be two hand-written
 * copies that drifted ("could not be confirmed" vs "need attention").
 * `retryAction` is the label of the button each surface actually shows.
 */
export function laterReturnIssueCopy({
  count,
  sender,
  lastTried,
  failureKind,
  retryAction,
}: {
  count: number;
  /** Named only where the surface's retry button acts on this sender. */
  sender: string | null;
  lastTried: string | null;
  failureKind: LaterReturnFailureKind;
  retryAction: string;
}): string {
  const subject =
    sender === null
      ? `${count} Later return${count === 1 ? '' : 's'}`
      : count === 1
        ? `${sender}'s Later return`
        : `${count} Later returns, starting with ${sender},`;
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
export function formatAttempt(iso: string, timeZone: string): string {
  const attemptedAt = new Date(iso);
  if (Number.isNaN(attemptedAt.getTime())) return 'at an unknown time';
  return attemptedAt.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone });
}
