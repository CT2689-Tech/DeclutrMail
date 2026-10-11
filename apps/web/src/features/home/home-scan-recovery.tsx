'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ME_QUERY_KEY } from '@/features/auth/api/use-me';
import type { SyncStatus } from '@declutrmail/shared/contracts';
import { Button, ErrorState } from '@declutrmail/shared';
import { initialSyncRecovery } from '@declutrmail/shared/contracts';
import { useAuth } from '@/features/auth/auth-provider';
import { useSyncStatus } from '@/features/onboarding/api/use-sync-status';
import { useRetryInitialSync } from '@/features/sync/api/use-retry-initial-sync';
import { startMailboxConnect } from '@/features/mailboxes/connect-mailbox-url';
import { useNow } from '@/lib/use-now';
import { fillDeck, formatRetryTime, HOME_DECK } from './home-deck-copy';

export function HomeScanRecovery({
  mailboxId,
  needsReconnect,
}: {
  mailboxId: string;
  needsReconnect: boolean;
}) {
  const status = useSyncStatus(mailboxId);
  const retry = useRetryInitialSync(mailboxId);
  const now = useNow(30_000);
  const { me } = useAuth();
  const timeZone = me.user.timezone ?? 'UTC';
  const scheduled = status.data?.next_retry_at;
  const retryingLabel =
    scheduled != null
      ? fillDeck(HOME_DECK.retrying, { time: formatRetryTime(scheduled, timeZone) ?? '' })
      : null;
  const qc = useQueryClient();
  useEffect(() => {
    if (status.data?.is_ready_for_triage) void qc.invalidateQueries({ queryKey: ME_QUERY_KEY });
  }, [qc, status.data?.is_ready_for_triage]);
  return (
    <HomeScanRecoveryView
      data={status.data}
      error={status.isError}
      pending={retry.isPending}
      needsReconnect={needsReconnect}
      now={now}
      retryingLabel={retryingLabel}
      refresh={() => void status.refetch()}
      retry={() => retry.mutate()}
      reconnect={() => startMailboxConnect(mailboxId)}
    />
  );
}

export function HomeScanRecoveryView({
  data,
  error,
  pending,
  needsReconnect,
  now,
  retryingLabel = null,
  refresh,
  retry,
  reconnect: connect,
}: {
  data?: SyncStatus | undefined;
  error: boolean;
  pending: boolean;
  needsReconnect: boolean;
  now: number | null;
  retryingLabel?: string | null;
  refresh: () => void;
  retry: () => void;
  reconnect: () => void;
}) {
  if (!data)
    return error ? (
      <ErrorState
        title="We couldn’t load scan recovery"
        description="Try again to check this inbox’s retry status."
        onRetry={refresh}
      />
    ) : (
      <p role="status">Loading scan recovery…</p>
    );
  if (data.is_ready_for_triage) return <p role="status">Your scan is ready. Opening your inbox…</p>;
  if (data.readiness_status !== 'failed')
    return (
      <p role="status">
        Your saved scan is {data.readiness_status === 'queued' ? 'queued' : 'continuing'}.
      </p>
    );
  const reconnect =
    needsReconnect ||
    initialSyncRecovery({
      errorCode: data.error_code,
      progressPct: data.progress_pct,
    }).action === 'reconnect';
  const deadline = data.retry_available_at ?? data.next_retry_at;
  const waiting = !reconnect && deadline != null && (now === null || Date.parse(deadline) > now);
  return (
    <>
      <p>
        {reconnect
          ? 'Reconnect Gmail to continue with your saved progress.'
          : waiting && retryingLabel
            ? retryingLabel
            : data.next_retry_at
              ? 'Your progress is saved. An automatic retry is scheduled.'
              : 'Your progress is saved. Retry this inbox’s scan.'}
      </p>
      <Button
        tone="primary"
        disabled={!reconnect && (pending || waiting)}
        onClick={reconnect ? connect : retry}
      >
        {reconnect
          ? 'Reconnect Gmail'
          : pending
            ? 'Starting…'
            : waiting
              ? data.next_retry_at
                ? 'Retry scheduled'
                : 'Retry later'
              : 'Scan again'}
      </Button>
    </>
  );
}
