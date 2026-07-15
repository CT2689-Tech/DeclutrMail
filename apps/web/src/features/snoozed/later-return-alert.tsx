'use client';

import { Button, tokens } from '@declutrmail/shared';

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
  const summary = recovery.data;
  const issue = summary?.firstIssue;

  if (!issue || !summary || summary.affectedCount === 0) return null;

  const sender = issue.displayName.trim() || issue.email;
  const countCopy =
    summary.affectedCount === 1
      ? `Mail from ${sender}`
      : `${summary.affectedCount} Later returns, starting with ${sender}`;
  const guidance =
    issue.returnFailureKind === 'reauthorize'
      ? 'Reconnect Gmail from the account menu, then try again.'
      : issue.returnFailureKind === 'needs_attention'
        ? 'Try again now. If it still fails, use Help in Settings.'
        : 'DeclutrMail will keep retrying automatically.';

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
        {countCopy} could not be confirmed as returned on time. Nothing will be deleted; check your
        inbox or Gmail&apos;s DeclutrMail/Later label.
        {issue.lastReturnAttemptAt
          ? ` Last tried ${formatAttempt(issue.lastReturnAttemptAt)}.`
          : ''}{' '}
        {guidance}
      </span>
      <Button
        tone="default"
        size="sm"
        disabled={wake.isPending}
        onClick={() => wake.mutate({ senderId: issue.senderId })}
      >
        {wake.isPending ? 'Queuing…' : 'Try return now'}
      </Button>
      {wake.isError ? (
        <span role="alert" style={{ width: '100%', fontSize: 12, color: color.danger }}>
          {wake.error instanceof ApiError && wake.error.status === 503
            ? "The return queue isn't available right now. Try again in a moment."
            : "Couldn't queue the return. Try again in a moment."}
        </span>
      ) : null}
    </div>
  );
}

function formatAttempt(iso: string): string {
  const attemptedAt = new Date(iso);
  if (Number.isNaN(attemptedAt.getTime())) return 'at an unknown time';
  return attemptedAt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
