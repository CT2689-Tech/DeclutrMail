'use client';

import type { CSSProperties } from 'react';

import { Button } from '../button';
import { color, font, radius, shadow } from '../../tokens/tokens';
import { getActionSemantics } from '../../actions/action-semantics';
import type { UndoActionKind, UndoTrayDataSource } from './undo-tray.types';

/**
 * Persistent undo tray (D35) — strip across the bottom of every
 * product surface after the user has taken a destructive action.
 *
 * What it does:
 *
 *   - Lists the active undo entries supplied via `dataSource`,
 *     newest-first.
 *   - Per-row "Undo" affordance (D58) — delegates to
 *     `dataSource.revert(token)`. Server remains the source of truth
 *     (D226 — no optimistic UI on destructive *mutations*; this is
 *     the REVERT path and the row simply disappears from the tray
 *     either way).
 *   - "View Activity" link (D35 footer copy) — handed to the
 *     consumer via `onViewActivity` because shared components do not
 *     own the route.
 *
 * Data contract: the tray owns NO transport. The host app injects a
 * `UndoTrayDataSource` built on its own API client — which is what
 * carries the CSRF double-submit header, the API base URL, and the
 * 401-refresh behavior the shared package cannot know about (see
 * `apps/web/src/features/triage/triage-undo-tray.tsx`). A previous
 * revision embedded a raw-fetch live path here; it could never have
 * worked against the CsrfGuard-protected `POST /api/undo/:token` and
 * was removed rather than fixed (founder call: no dead transport in
 * shared pre-launch).
 *
 * What it deliberately does NOT do (PR-scope-bounded):
 *
 *   - Toasts on individual decisions (Doc 05 §7 explicitly bans
 *     toasts for triage; tray IS the feedback channel).
 *   - The "expanded" tray drop-down per D35 (groups by sender) — the
 *     skeleton lists rows linearly; expansion lands when the Triage
 *     feature slice ships and supplies per-row sender labels via the
 *     API.
 *   - Action-preview UI (D226) — preview is OWNED by the destructive
 *     mutation flow; the tray displays after the mutation has
 *     committed.
 *
 * Verbs (D227): only K/A/U/L appear in the action-kind label. The
 * `verbLabel()` function below is the single mapping point — adding
 * a new verb requires touching this AND the API action-kind enum.
 */
export function UndoTray({
  dataSource,
  onViewActivity,
  style,
}: {
  /** Entries + revert callback, built on the host app's API client. */
  dataSource: UndoTrayDataSource;
  /** Click handler for the "View Activity" link in the tray footer. */
  onViewActivity?: () => void;
  style?: CSSProperties;
}) {
  const source = dataSource;

  // Render-order guards — order matters to avoid flicker between
  // an in-progress refetch and a transient error.
  //
  // 1. Empty + no error + not loading → render nothing (D35 "tray
  //    is invisible when no active undo tokens exist"). Checked
  //    FIRST so a successful empty response never momentarily flashes
  //    the error chip while a stale `isError` flag clears.
  // 2. Error → render the error chip (D211 — the tray must NOT
  //    silently empty on network failure). Stays mounted until the
  //    next successful refetch.
  if (!source.isLoading && !source.isError && source.entries.length === 0) {
    return null;
  }
  if (source.isError && source.entries.length === 0) {
    return (
      <aside
        data-dm-undo-tray="error"
        role="alert"
        aria-label="Recent actions failed to load"
        style={{
          position: 'fixed',
          bottom: 16,
          left: '50%',
          transform: 'translateX(-50%)',
          minWidth: 280,
          maxWidth: 480,
          background: color.card,
          border: `1px solid ${color.redBorder}`,
          borderRadius: radius.lg,
          boxShadow: shadow.card,
          padding: '10px 14px',
          fontFamily: font.sans,
          fontSize: 13,
          color: color.fg,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          zIndex: 50,
          ...style,
        }}
      >
        <span style={{ color: color.fgMuted, fontFamily: font.mono, fontSize: 11 }}>
          Couldn’t load recent actions
        </span>
        {onViewActivity ? (
          <button
            type="button"
            onClick={onViewActivity}
            style={{
              background: 'transparent',
              border: 'none',
              padding: 0,
              color: color.primary,
              fontFamily: font.sans,
              fontSize: 12,
              cursor: 'pointer',
              textDecoration: 'underline',
              textUnderlineOffset: 2,
            }}
          >
            View Activity
          </button>
        ) : null}
      </aside>
    );
  }

  return (
    <aside
      data-dm-undo-tray
      role="region"
      aria-label="Recent actions — undo available"
      style={{
        position: 'fixed',
        bottom: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        minWidth: 320,
        maxWidth: 640,
        background: color.card,
        border: `1px solid ${color.line}`,
        borderRadius: radius.lg,
        boxShadow: shadow.card,
        padding: '10px 14px',
        fontFamily: font.sans,
        fontSize: 13,
        color: color.fg,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        zIndex: 50,
        ...style,
      }}
    >
      <Summary count={source.entries.length} isLoading={source.isLoading} />
      <ul
        style={{
          listStyle: 'none',
          padding: 0,
          margin: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          flex: 1,
        }}
      >
        {source.entries.map((entry) => (
          <li
            key={entry.token}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <span style={{ color: color.fgSoft }}>
              {resultLabel(entry.actionKind)}
              <span
                style={{
                  display: 'block',
                  color: color.fgMuted,
                  fontFamily: font.mono,
                  fontSize: 10,
                }}
              >
                Activity Undo until {formatExpiry(entry.expiresAt)}
                {entry.actionKind === 'delete' ? ' · Gmail Trash recovery is separate' : ''}
              </span>
            </span>
            <Button
              size="sm"
              tone="ghost"
              onClick={() => {
                void source.revert(entry.token);
              }}
              ariaLabel={`Undo ${verbLabel(entry.actionKind)}`}
            >
              Undo
            </Button>
          </li>
        ))}
      </ul>
      {onViewActivity ? (
        <button
          type="button"
          onClick={onViewActivity}
          style={{
            background: 'transparent',
            border: 'none',
            padding: 0,
            color: color.primary,
            fontFamily: font.sans,
            fontSize: 12,
            cursor: 'pointer',
            textDecoration: 'underline',
            textUnderlineOffset: 2,
          }}
        >
          View Activity
        </button>
      ) : null}
    </aside>
  );
}

function resultLabel(kind: UndoActionKind): string {
  switch (kind) {
    case 'archive':
    case 'later':
    case 'unsubscribe':
    case 'delete':
      return getActionSemantics(kind).resultLabel;
    case 'apply-rule':
      return 'Rule applied';
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

function formatExpiry(value: string): string {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(new Date(value));
}

/** "3 decisions applied" — the D35 leading-edge label. */
function Summary({ count, isLoading }: { count: number; isLoading: boolean }) {
  if (isLoading && count === 0) {
    return (
      <span style={{ color: color.fgMuted, fontFamily: font.mono, fontSize: 11 }}>Loading…</span>
    );
  }
  return (
    <span style={{ color: color.fgMuted, fontFamily: font.mono, fontSize: 11 }}>
      {count} {count === 1 ? 'decision' : 'decisions'} applied
    </span>
  );
}

/**
 * Single source of truth for action-kind → display verb (D227
 * canonical K/A/U/L + "Rule" for Autopilot applications).
 *
 * INVARIANT (`check-microcopy.sh --rule=canonical-verbs`): "Screen" is
 * NEVER a user-facing label here; the internal enum lives in the API
 * `triage_decision.verdict` column only.
 */
function verbLabel(kind: UndoActionKind): string {
  switch (kind) {
    case 'archive':
      return 'Archive';
    case 'unsubscribe':
      return 'Unsubscribe';
    case 'later':
      return 'Later';
    case 'apply-rule':
      return 'Rule applied';
    case 'delete':
      // ADR-0019 — Delete verb label. Recoverable for 30 days from
      // Gmail Trash; the tray surfaces the longer recovery window via
      // formatTimeLeft on the entry's expiresAt timestamp.
      return 'Delete';
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}
