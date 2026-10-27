'use client';

import Link from 'next/link';
import { useEffect, useLayoutEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ME_QUERY_KEY } from '@/features/auth/api/use-me';
import type { SyncStatus } from '@declutrmail/shared/contracts';
import { Button, ErrorState } from '@declutrmail/shared';
import { initialSyncRecovery } from '@declutrmail/shared/contracts';
import { useOptionalAuth } from '@/features/auth/auth-provider';
import { useSyncStatus } from '@/features/onboarding/api/use-sync-status';
import { useRetryInitialSync } from '@/features/sync/api/use-retry-initial-sync';
import { startMailboxConnect } from '@/features/mailboxes/connect-mailbox-url';
import { useNow } from '@/lib/use-now';
import { fillDeck, formatRetryTime, HOME_DECK } from './home-deck-copy';
import styles from './home-view.module.css';

export function HomeScanRecovery({
  mailboxId,
  needsReconnect,
}: {
  mailboxId: string;
  needsReconnect: boolean;
}) {
  const auth = useOptionalAuth();
  // The preview fixture names a mailbox and has no session. Polling status
  // there 401s and the client would leave the page for sign-in.
  const status = useSyncStatus(mailboxId, { enabled: auth !== null });
  const retry = useRetryInitialSync(mailboxId, {
    ...(auth === null ? { suppressAuthRedirect: true } : {}),
  });
  const now = useNow(30_000);
  // Scan status can already be in the client cache while the server HTML
  // was rendered without it. Hold it until after mount so the first paint
  // matches, the same way the syncing stage sentence waits.
  const [statusReady, setStatusReady] = useState(false);
  useLayoutEffect(() => {
    setStatusReady(true);
  }, []);
  const timeZone = auth?.me.user.timezone ?? 'UTC';
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
      data={statusReady && auth !== null ? status.data : undefined}
      error={statusReady && auth !== null && status.isError}
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
        title="We couldn’t check your scan"
        description="Try again to see when the scan can continue."
        onRetry={refresh}
      />
    ) : (
      <HomeScanFailedCopy onRetry={retry} pending={pending} />
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
  if (!reconnect && !waiting && !data.next_retry_at) {
    return <HomeScanFailedCopy onRetry={retry} pending={pending} />;
  }
  return (
    <>
      <p>
        {reconnect
          ? 'Reconnect Gmail to continue with your saved progress.'
          : waiting && retryingLabel
            ? retryingLabel
            : 'Your progress is saved. We’ll try the scan again automatically.'}
      </p>
      <div className={styles.scanActions}>
        <Button
          tone="primary"
          disabled={!reconnect && (pending || waiting)}
          onClick={reconnect ? connect : retry}
        >
          {reconnect
            ? HOME_DECK.reconnect
            : pending
              ? 'Starting…'
              : waiting
                ? data.next_retry_at
                  ? 'Retry scheduled'
                  : 'Retry later'
                : HOME_DECK.failedRetry}
        </Button>
        <ScanHelpLink />
      </div>
    </>
  );
}

/** The deck's scan-failed sentence, plus retry and help. */
export function HomeScanFailedCopy({
  onRetry = () => undefined,
  pending = false,
}: {
  onRetry?: () => void;
  pending?: boolean;
}) {
  return (
    <>
      <p>{HOME_DECK.failedBody}</p>
      <div className={styles.scanActions}>
        <Button tone="primary" disabled={pending} onClick={onRetry}>
          {pending ? 'Starting…' : HOME_DECK.failedRetry}
        </Button>
        <ScanHelpLink />
      </div>
    </>
  );
}

function ScanHelpLink() {
  return (
    <Link href="/help" className="dm-external-link">
      {HOME_DECK.failedHelp}
    </Link>
  );
}
