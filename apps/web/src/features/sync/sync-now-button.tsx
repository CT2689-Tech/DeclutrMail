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
 * "queued" — it says nothing about the run finishing. Before the
 * mutate, the baseline (`last_synced_at` + `last_sync_error_at`) is
 * snapshotted from a FRESH refetch (the cached value can be hours old
 * once ready, and pre-click drift would false-positive the first
 * poll). Then the watch re-polls `GET /v1/sync/status` every 3s:
 *   - success — `last_synced_at` moved (worker stamps it on every
 *     completed run, no-ops included) → "Inbox up to date" + feature
 *     caches re-invalidated so fresh rows actually appear;
 *   - failure — `last_sync_error_at` moved (a dead-lettered run never
 *     stamps the success timestamp) → error toast, watch ends early
 *     instead of waiting on a completion that never comes;
 *   - timeout — 90s with neither → honest "still running" note.
 * Baseline COMPARISON (not wall-clock) sidesteps client/server clock
 * skew.
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

/** Pre-click snapshot the watch compares against. */
interface WatchBaseline {
  synced: string | null;
  error: string | null;
}

/**
 * `current` is STRICTLY newer than the baseline. Both values are
 * server-generated stamps, so this never mixes clocks. Strictly-newer
 * (not merely different) keeps a stale render that still carries a
 * PRE-baseline value from reading as a completion.
 */
function movedPast(current: string | null, base: string | null): boolean {
  if (current === null) return false;
  if (base === null) return true;
  return new Date(current).getTime() > new Date(base).getTime();
}

export function SyncNowButton({ mailboxId }: { mailboxId?: string | undefined } = {}) {
  const status = useSyncStatus(mailboxId);
  const sync = useSyncNow('app_shell');
  const qc = useQueryClient();

  const baselineRef = useRef<WatchBaseline | null>(null);
  // `arming` covers the pre-mutate baseline refetch; `watching` covers
  // the post-202 completion poll. Both disable the button.
  const [arming, setArming] = useState(false);
  const [watching, setWatching] = useState(false);
  // Re-render tick so "2m ago" ages without any data change.
  const [, setTick] = useState(0);

  const lastSyncedAt = status.data?.last_synced_at ?? null;
  const lastErrorAt = status.data?.last_sync_error_at ?? null;

  // Age the freshness label once a minute.
  useEffect(() => {
    if (lastSyncedAt === null) return undefined;
    const t = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, [lastSyncedAt]);

  // Watch driver — re-poll status while watching; time out honestly
  // (we do NOT know the run will finish; a dead worker never stamps).
  useEffect(() => {
    if (!watching) return undefined;
    const poll = setInterval(() => {
      void qc.invalidateQueries({ queryKey: SYNC_STATUS_KEY });
    }, WATCH_POLL_MS);
    const timeout = setTimeout(() => {
      setWatching(false);
      toast(
        'Sync is taking longer than expected — the “synced” time above will update when it completes.',
        'info',
      );
    }, WATCH_TIMEOUT_MS);
    return () => {
      clearInterval(poll);
      clearTimeout(timeout);
    };
  }, [watching, qc]);

  // Outcome detector. Success = `last_synced_at` moved past the
  // baseline. Failure = the incremental error stamp moved (a
  // dead-lettered run never stamps `last_synced_at`, so without this
  // the watch would wait on a completion that never comes).
  useEffect(() => {
    if (!watching) return;
    const baseline = baselineRef.current;
    if (baseline === null) return;

    if (movedPast(lastErrorAt, baseline.error)) {
      setWatching(false);
      toast('Sync failed — check the mailbox connection and try again.', 'danger');
      return;
    }

    if (!movedPast(lastSyncedAt, baseline.synced)) return;
    setWatching(false);
    toast('Inbox up to date — synced just now.', 'success');
    // The 202-time invalidation in `useSyncNow` fires before the worker
    // has written anything; THIS one lands after completion, so new
    // senders/activity actually appear without a manual reload.
    void qc.invalidateQueries({ queryKey: ['senders'] });
    void qc.invalidateQueries({ queryKey: ['activity'] });
    void qc.invalidateQueries({ queryKey: ['brief'] });
    void qc.invalidateQueries({ queryKey: ['sender-detail'] });
  }, [watching, lastSyncedAt, lastErrorAt, qc]);

  // Only render when the mailbox is past initial-sync. Pre-ready states
  // (`queued` / `syncing`) already render the sync-gate.
  const ready = status.data?.readiness_status === 'ready';
  if (!ready) return null;

  const busy = arming || sync.isPending || watching;

  const startSync = async () => {
    if (busy) return;
    setArming(true);
    // Baseline from a FRESH read, not the mounted cache: the status
    // query stops refetching once ready, so the cached stamp can be
    // hours old — an unrelated drift-sweep in between would otherwise
    // false-positive the completion check on the first poll.
    let fresh: WatchBaseline = { synced: lastSyncedAt, error: lastErrorAt };
    try {
      const r = await status.refetch();
      if (r.data) {
        fresh = {
          synced: r.data.last_synced_at ?? null,
          error: r.data.last_sync_error_at ?? null,
        };
      }
    } catch {
      // Refetch failure → fall back to the cached snapshot; the 90s
      // timeout still bounds the worst case.
    }
    baselineRef.current = fresh;
    sync.mutate(undefined, {
      onSuccess: () => setWatching(true),
      onSettled: () => setArming(false),
    });
  };

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      {lastSyncedAt !== null && (
        <span
          // Collapsed below `sm` so the topbar keeps the account switcher
          // fully on-screen on a phone (the sync button stays as icon-only).
          className="dm-topbar-collapse"
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
        onClick={() => void startSync()}
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
        {/* Label collapses below `sm` — the button stays icon-only on a
            phone so the topbar row fits without clipping the switcher.
            The `aria-label` above keeps it accessible when text is hidden. */}
        <span className="dm-topbar-collapse">{busy ? 'Syncing…' : 'Sync now'}</span>
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
      /* Topbar mobile collapse (matches the shell's 900px sm breakpoint).
         The freshness label + Sync-now text hide so the account switcher
         stays fully on-screen on a phone. CSS-driven (not a JS hook) so
         there is no post-hydration flash — same rationale as tokens.css. */
      @media (max-width: 900px) {
        .dm-topbar-collapse { display: none; }
      }
    `}</style>
  );
}
