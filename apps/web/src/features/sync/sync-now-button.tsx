'use client';

import { tokens } from '@declutrmail/shared';

import { useSyncStatus } from '@/features/onboarding/api/use-sync-status';
import { useSyncNow } from './api/use-sync-now';

const { color, font, radius } = tokens;

/**
 * "Sync now" button (D38 prod-ready pass).
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
 *   - **Idle** — ready + not in-flight. Click → mutation fires.
 *   - **Pending** — mutation in flight. Button is `aria-busy` + the
 *     label flips to "Syncing…". Disabled during the request.
 *
 * Privacy posture: the button NEVER renders message-derived data —
 * the cursor + last-history-id never reach the UI string. (D7/§2.1)
 *
 * Accessibility:
 *   - `aria-busy` toggles with `isPending` so screen readers announce
 *     the state change.
 *   - The button is a real `<button>` with a label, not an icon-only
 *     surface — works fine without alt text.
 */
export function SyncNowButton() {
  const status = useSyncStatus();
  const sync = useSyncNow('app_shell');

  // Only render when the mailbox is past initial-sync. Pre-ready states
  // (`queued` / `syncing`) already render the sync-gate.
  const ready = status.data?.readiness_status === 'ready';
  if (!ready) return null;

  return (
    <button
      type="button"
      onClick={() => sync.mutate()}
      disabled={sync.isPending}
      aria-busy={sync.isPending}
      aria-label="Check Gmail for new emails"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        height: 30,
        padding: '0 12px',
        borderRadius: radius.pill,
        background: sync.isPending ? color.mutedBg : color.card,
        border: `1px solid ${color.line}`,
        color: color.fg,
        fontFamily: font.sans,
        fontSize: 12.5,
        fontWeight: 500,
        cursor: sync.isPending ? 'progress' : 'pointer',
        opacity: sync.isPending ? 0.7 : 1,
        transition: 'background 120ms ease, opacity 120ms ease',
      }}
    >
      <SyncIcon spinning={sync.isPending} />
      {sync.isPending ? 'Syncing…' : 'Sync now'}
    </button>
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
