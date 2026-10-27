import type { SyncStatus } from '@declutrmail/shared/contracts';
import { syncStatusNeedsReconnect } from '@/features/mailboxes/mailbox-health';
import type { HomeAction } from './home-state';

export interface HomePriority {
  title: string;
  body?: string;
  action?: HomeAction;
}

export type HomeCleanupStatus = 'idle' | 'running' | 'unknown' | null;

/** Orientation only; the shared tray owns polling, completion and Undo. */
export function homePriority({
  sync,
  needsReconnect,
  cleanup,
  newSenders,
  laterAttention,
}: {
  sync?: SyncStatus | undefined;
  needsReconnect: boolean;
  cleanup: HomeCleanupStatus;
  newSenders: number | null;
  laterAttention: number;
}): HomePriority | null {
  if (needsReconnect || syncStatusNeedsReconnect(sync))
    return {
      title: 'Reconnect Gmail to continue.',
      action: { label: 'Open Settings', href: '/settings#mailboxes' },
    };
  if (sync?.readiness_status === 'queued' || sync?.readiness_status === 'syncing')
    return { title: 'Your scan is in progress.' };
  if (sync?.readiness_status === 'failed')
    return {
      title: 'Your scan needs attention.',
      action: { label: 'Open Settings', href: '/settings#mailboxes' },
    };
  const failed = Date.parse(sync?.last_sync_error_at ?? '');
  const synced = Date.parse(sync?.last_synced_at ?? '');
  if (Number.isFinite(failed) && (!Number.isFinite(synced) || failed > synced))
    return {
      title: 'Your latest scan needs attention.',
      action: { label: 'Open Settings', href: '/settings#mailboxes' },
    };
  if (cleanup === 'unknown')
    return {
      title: 'Check your cleanup status.',
      body: 'The latest result couldn’t be confirmed.',
      action: { label: 'Open Activity', href: '/activity' },
    };
  if (cleanup === 'running')
    return {
      title: 'Your cleanup is in progress.',
      action: { label: 'Open Activity', href: '/activity' },
    };
  if (newSenders !== null && newSenders > 0)
    return {
      title: `${newSenders.toLocaleString('en-US')} new ${newSenders === 1 ? 'sender needs' : 'senders need'} review.`,
      action: { label: 'Review new senders', href: '/senders?view=first-review' },
    };
  if (laterAttention > 0)
    return {
      title: 'A Later return needs attention.',
      action: { label: 'Open Later', href: '/later' },
    };
  return null;
}

export function homeSyncLine(
  sync: SyncStatus | undefined,
  error: boolean,
  needsReconnect: boolean,
  now: number | null,
): string {
  if (needsReconnect || syncStatusNeedsReconnect(sync)) return 'Reconnect Gmail';
  if (error) return 'Gmail status unavailable';
  if (!sync) return 'Checking Gmail status…';
  if (sync.readiness_status === 'failed') return 'Scan needs attention';
  if (sync.readiness_status === 'queued') return 'Scan queued';
  if (sync.readiness_status === 'syncing') return 'Scanning Gmail…';
  const synced = Date.parse(sync.last_synced_at ?? '');
  const failed = Date.parse(sync.last_sync_error_at ?? '');
  if (Number.isFinite(failed) && (!Number.isFinite(synced) || failed > synced))
    return 'Latest scan needs attention';
  if (!Number.isFinite(synced)) return 'Gmail connected · Scan time unavailable';
  if (now === null) return 'Gmail connected';
  const minutes = Math.max(0, Math.floor((now - synced) / 60_000));
  const age =
    minutes < 1
      ? 'just now'
      : minutes < 60
        ? `${minutes}m ago`
        : minutes < 1440
          ? `${Math.floor(minutes / 60)}h ago`
          : `${Math.floor(minutes / 1440)}d ago`;
  return `Gmail connected · Last scanned ${age}`;
}
