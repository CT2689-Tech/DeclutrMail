'use client';

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast, tokens } from '@declutrmail/shared';

import { SYNC_STATUS_KEY, useSyncStatus } from '@/features/onboarding/api/use-sync-status';
import { useSyncNow } from './api/use-sync-now';

const { color, font, radius } = tokens;

/**
 * "Sync now" button (D38 prod-ready pass; freshness + completion watch
 * added 2026-07-07 founder smoke feedback).
 *
 * Lives in `AppShell.topbarRight` alongside `<AccountMenu>`. One click
 * enqueues an incremental-sync job from the current cursor; BullMQ
 * dedups consecutive clicks against the same cursor so the button is
 * naturally safe to spam.
 *
 * States the button can be in:
 *   - **Hidden** — initial sync is in flight (`readiness_status !== 'ready'`).
 *     The sync-gate progress card carries the "we're working on it" UI;
 *     a secondary button would be redundant + confusing.
 *   - **Idle** — ready + not in-flight. Click → mutation fires. A muted
 *     "synced Xm ago" label sits beside the button (hover = absolute
 *     time) so the user always knows data freshness.
 *   - **Pending/Watching** — request in flight OR completion watch
 *     running. `aria-busy`, label "Syncing…", disabled.
 *
 * Completion watch: the 202 from `POST /v1/sync/incremental` only means
 * "queued" — it says nothing about the run finishing. On success we
 * snapshot the pre-click `last_synced_at` and re-poll `GET /v1/sync/
 * status` every 3s until the timestamp MOVES (worker stamps it on every
 * completed run, including no-op runs), then toast "Inbox up to date"
 * and re-invalidate the feature caches so fresh rows actually appear.
 * Baseline COMPARISON (not wall-clock) sidesteps client/server clock
 * skew. A 90s timeout downgrades to an "it'll finish in the background"
 * toast rather than spinning forever.
 *
 * Privacy posture: the button NEVER renders message-derived data —
 * the cursor + last-history-id never reach the UI string; the freshness
 * label is a wall-clock timestamp only. (D7/§2.1)
 *
 * Accessibility:
 *   - `aria-busy` toggles with the busy state so screen readers announce
 *     the state change.
 *   - The button is a real `<button>` with a label, not an icon-only
 *     surface — works fine without alt text.
 */

/** How often the completion watch re-polls sync status. */
const WATCH_POLL_MS = 3_000;
/** Give up watching after this long — the sync still finishes server-side. */
const WATCH_TIMEOUT_MS = 90_000;

/** ISO → compact relative age for the freshness label. */
function relAge(iso: string, nowMs: number): string {
  const mins = Math.floor((nowMs - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function SyncNowButton() {
  const status = useSyncStatus();
  const sync = useSyncNow('app_shell');
  const qc = useQueryClient();

  // Pre-click `last_synced_at` snapshot the watch compares against.
  const baselineRef = useRef<string | null>(null);
  const [watching, setWatching] = useState(false);
  // Re-render tick so "2m ago" ages without any data change.
  const [, setTick] = useState(0);

  const lastSyncedAt = status.data?.last_synced_at ?? null;

  // Age the freshness label once a minute.
  useEffect(() => {
    if (lastSyncedAt === null) return undefined;
    const t = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, [lastSyncedAt]);

  // Watch driver — re-poll status while watching; time out politely.
  useEffect(() => {
    if (!watching) return undefined;
    const poll = setInterval(() => {
      void qc.invalidateQueries({ queryKey: SYNC_STATUS_KEY });
    }, WATCH_POLL_MS);
    const timeout = setTimeout(() => {
      setWatching(false);
      toast('Sync is taking longer than usual — it will finish in the background.', 'info');
    }, WATCH_TIMEOUT_MS);
    return () => {
      clearInterval(poll);
      clearTimeout(timeout);
    };
  }, [watching, qc]);

  // Completion detector — `last_synced_at` moved past the baseline.
  useEffect(() => {
    if (!watching) return;
    if (lastSyncedAt === null) return;
    if (lastSyncedAt === baselineRef.current) return;
    setWatching(false);
    toast('Inbox up to date — synced just now.', 'success');
    // The 202-time invalidation in `useSyncNow` fires before the worker
    // has written anything; THIS one lands after completion, so new
    // senders/activity actually appear without a manual reload.
    void qc.invalidateQueries({ queryKey: ['senders'] });
    void qc.invalidateQueries({ queryKey: ['activity'] });
    void qc.invalidateQueries({ queryKey: ['brief'] });
    void qc.invalidateQueries({ queryKey: ['sender-detail'] });
  }, [watching, lastSyncedAt, qc]);

  // Only render when the mailbox is past initial-sync. Pre-ready states
  // (`queued` / `syncing`) already render the sync-gate.
  const ready = status.data?.readiness_status === 'ready';
  if (!ready) return null;

  const busy = sync.isPending || watching;

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      {lastSyncedAt !== null && (
        <span
          title={`Last synced ${new Date(lastSyncedAt).toLocaleString()}`}
          style={{
            fontFamily: font.mono,
            fontSize: 10.5,
            letterSpacing: '0.06em',
            color: color.fgMuted,
            whiteSpace: 'nowrap',
          }}
        >
          synced {relAge(lastSyncedAt, Date.now())}
        </span>
      )}
      <button
        type="button"
        onClick={() => {
          baselineRef.current = lastSyncedAt;
          sync.mutate(undefined, { onSuccess: () => setWatching(true) });
        }}
        disabled={busy}
        aria-busy={busy}
        aria-label="Check Gmail for new emails"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          height: 30,
          padding: '0 12px',
          borderRadius: radius.pill,
          background: busy ? color.mutedBg : color.card,
          border: `1px solid ${color.line}`,
          color: color.fg,
          fontFamily: font.sans,
          fontSize: 12.5,
          fontWeight: 500,
          cursor: busy ? 'progress' : 'pointer',
          opacity: busy ? 0.7 : 1,
          transition: 'background 120ms ease, opacity 120ms ease',
        }}
      >
        <SyncIcon spinning={busy} />
        {busy ? 'Syncing…' : 'Sync now'}
      </button>
    </span>
  );
}

/**
 * 14px refresh icon. `spinning=true` plays an infinite rotation while
 * the mutation is in flight — the keyframe is registered once at module
 * scope below.
 *
 * SVG-inline (no asset pipeline) — matches the "icon as code" pattern
 * used elsewhere in the shell so dark-mode + theming pass without an
 * extra `<Image>` cache invalidation.
 */
function SyncIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      style={spinning ? { animation: 'dm-sync-spin 900ms linear infinite' } : undefined}
    >
      <path
        d="M21 12a9 9 0 1 1-3.5-7.1"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
      />
      <path d="M21 3v6h-6" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
    </svg>
  );
}

/**
 * Keyframe registration. Inlining a `<style>` tag avoids touching the
 * shared `tokens.css` (which the design system gates behind PR-3 design
 * freeze) and keeps the animation co-located with its sole consumer.
 *
 * Rendered once at module init — the `<style>` only mounts the first
 * time `SyncNowButton` is in the tree, so SSR is unaffected.
 */
export function SyncNowAnimationStyle() {
  return (
    <style>{`
      @keyframes dm-sync-spin {
        from { transform: rotate(0deg); }
        to   { transform: rotate(360deg); }
      }
      @media (prefers-reduced-motion: reduce) {
        [style*="dm-sync-spin"] { animation: none !important; }
      }
    `}</style>
  );
}
