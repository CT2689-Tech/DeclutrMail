'use client';

import type { CSSProperties } from 'react';

import { Button } from '../button';
import { color, font, radius, shadow } from '../../tokens/tokens';
import { useUndoTray } from './use-undo-tray';
import type { UndoActionKind, UndoTrayDataSource } from './undo-tray.types';

/**
 * Persistent undo tray (D35) — strip across the bottom of every
 * product surface after the user has taken a destructive action.
 *
 * What it does:
 *
 *   - Reads active undo tokens from `GET /api/undo` (via
 *     `useUndoTray`) and lists them newest-first.
 *   - Per-row "Undo" affordance (D58) — POST `/api/undo/:token`,
 *     optimistically removes the row from the tray on click. Server
 *     remains the source of truth (D226 — no optimistic UI on
 *     destructive *mutations*; this is the REVERT path and the row
 *     simply disappears from the tray either way).
 *   - "View Activity" link (D35 footer copy) — handed to the
 *     consumer via `onViewActivity` because shared components do not
 *     own the route.
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
  mailboxAccountId,
  dataSource,
  onViewActivity,
  apiBaseUrl,
  style,
}: {
  mailboxAccountId: string;
  /** Test/Storybook override (skips the network fetch). */
  dataSource?: UndoTrayDataSource;
  /** Click handler for the "View Activity" link in the tray footer. */
  onViewActivity?: () => void;
  apiBaseUrl?: string;
  style?: CSSProperties;
}) {
  const source = useUndoTray({
    mailboxAccountId,
    ...(dataSource ? { dataSource } : {}),
    ...(apiBaseUrl ? { apiBaseUrl } : {}),
  });

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
            <span style={{ color: color.fgSoft }}>{verbLabel(entry.actionKind)}</span>
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
