'use client';

import { useCallback, useEffect, useRef, type CSSProperties } from 'react';

import { Button } from '../button';
import { color, font, radius, shadow } from '../../tokens/tokens';
import { getActionSemantics } from '../../actions/action-semantics';
import type { UndoActionKind, UndoTrayDataSource, UndoTrayEntry } from './undo-tray.types';

/**
 * Live height of the mounted tray, in px, published on the document
 * root — `0px` when no tray is mounted.
 *
 * Scroll containers reserve this as bottom padding so content can
 * always scroll clear of the tray. `AppShell` is the one consumer that
 * matters (every product screen scrolls inside it).
 *
 * A custom property rather than a shared constant because the tray's
 * height is not knowable ahead of time: it grows with the entry count,
 * and any fixed reserve would be wrong for every other count.
 */
export const UNDO_TRAY_INSET_VAR = '--dm-undo-tray-inset';

/** Breathing room between the last scrolled content and the tray's top edge. */
const TRAY_BOTTOM_GAP = 16;

/**
 * Publish the tray's measured height on the document root while it is
 * mounted, and clear it on unmount.
 *
 * Why this exists: the tray is `position: fixed`, mounted by the app
 * layout OUTSIDE the content scroller, so it overlaps whatever the
 * last ~90px of content happens to be. On `/billing` that was the
 * checkout Confirm button — occluded AND unreachable, because the
 * scroller was already at its end (browser smoke 2026-07-29:
 * `elementFromPoint` at the button's centre returned a tray span).
 * A revenue-blocking overlap, and not billing-specific: it reaches
 * every bottom-anchored control on every product screen.
 */
function useTrayInset(): (node: HTMLElement | null) => void {
  const observerRef = useRef<ResizeObserver | null>(null);

  useEffect(
    () => () => {
      observerRef.current?.disconnect();
      document.documentElement.style.removeProperty(UNDO_TRAY_INSET_VAR);
    },
    [],
  );

  return useCallback((node: HTMLElement | null) => {
    observerRef.current?.disconnect();
    if (!node) {
      document.documentElement.style.removeProperty(UNDO_TRAY_INSET_VAR);
      return;
    }
    const publish = () => {
      document.documentElement.style.setProperty(
        UNDO_TRAY_INSET_VAR,
        // From the tray's TOP edge to the viewport bottom — i.e. its
        // height PLUS whatever `bottom` offset the host gave it (the app
        // floats it 78px up to clear the Senders selection bar; assuming
        // the default 16 left ~46px of content under the tray).
        `${Math.ceil(window.innerHeight - node.getBoundingClientRect().top) + TRAY_BOTTOM_GAP}px`,
      );
    };
    publish();
    // Entry count (and so the height) changes without a remount.
    // Guarded because jsdom has no ResizeObserver; the initial publish
    // above is what unit tests assert on.
    if (typeof ResizeObserver !== 'undefined') {
      observerRef.current = new ResizeObserver(publish);
      observerRef.current.observe(node);
    }
  }, []);
}

/**
 * Persistent undo tray (D35) — strip across the bottom of every
 * product surface after the user has taken a destructive action.
 *
 * What it does:
 *
 *   - Lists the DECISIONS supplied via `dataSource`, newest-first —
 *     one row per thing the user did, named and counted; a bulk action
 *     opens to its senders (D35's "expanded tray", see `DecisionRow`).
 *   - Per-row "Undo" / "Undo all" (D58) — delegates to
 *     `dataSource.revert(token)`; per-sender Undo to `revertMember`. Server remains the source of truth
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
  defaultOpenDecisions = false,
  style,
}: {
  /** Entries + revert callback, built on the host app's API client. */
  dataSource: UndoTrayDataSource;
  /** Click handler for the "View Activity" link in the tray header. */
  onViewActivity?: () => void;
  /** Render bulk decisions expanded — for stories and visual snapshots. */
  defaultOpenDecisions?: boolean;
  style?: CSSProperties;
}) {
  const source = dataSource;
  const trayRef = useTrayInset();

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
        ref={trayRef}
        data-dm-undo-tray="error"
        role="alert"
        aria-label="Recent actions failed to load"
        style={{
          // See the note on the main tray below: `left: 50%` + translate
          // halves the available width for a shrink-to-fit fixed box.
          position: 'fixed',
          bottom: 16,
          left: 16,
          right: 16,
          marginInline: 'auto',
          width: 'min(480px, calc(100vw - 32px))',
          minWidth: 0,
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
          flexWrap: 'wrap',
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
      ref={trayRef}
      data-dm-undo-tray
      role="region"
      aria-label="Recent actions — undo available"
      style={{
        // Centred by auto margins against the FULL viewport, not by
        // `left: 50%` + `translateX(-50%)`.
        //
        // That pattern centres correctly but silently halves the layout
        // width: a fixed box with only `left` set is shrink-to-fit against
        // `viewport - left`, so at `left: 50%` it can never exceed half the
        // screen — 351px on a 702px viewport, far under this maxWidth of 640.
        // The transform then moves the already-too-narrow box into place. It
        // hid because at 1280px half the viewport IS 640, so the tray looked
        // correct at desktop width and progressively strangled itself below
        // it, wrapping the message to roughly one word per line by ~700px
        // (found by browser smoke, 2026-07-29).
        //
        // `left/right: 16` gives a full-width containing block with gutters,
        // `width: fit-content` still shrink-wraps to the content, and
        // `marginInline: auto` does the centring.
        position: 'fixed',
        bottom: 16,
        left: 16,
        right: 16,
        marginInline: 'auto',
        width: 'min(640px, calc(100vw - 32px))',
        minWidth: 0,
        maxWidth: 640,
        background: color.card,
        border: `1px solid ${color.line}`,
        borderRadius: radius.lg,
        boxShadow: shadow.card,
        padding: '10px 14px',
        fontFamily: font.sans,
        fontSize: 13,
        color: color.fg,
        // A header row over a full-width list. The summary and the
        // Activity link used to sit BESIDE the list, which was fine for
        // one-line rows and squeezed named, countable decisions into a
        // ~330px column that wrapped mid-sender-name.
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        zIndex: 50,
        // A long session (or an opened 25-sender decision) must never
        // grow the tray past the viewport it floats over.
        maxHeight: 'min(50vh, 420px)',
        overflowY: 'auto',
        ...style,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <Summary count={source.entries.length} isLoading={source.isLoading} />
        {onViewActivity ? <ActivityLink onClick={onViewActivity} /> : null}
      </div>
      <ul
        style={{
          listStyle: 'none',
          padding: 0,
          margin: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {source.entries.map((entry) => (
          <DecisionRow
            key={entry.groupId ?? entry.token}
            entry={entry}
            onUndoAll={() => {
              void source.revert(entry.token);
            }}
            onUndoMember={source.revertMember}
            defaultOpen={defaultOpenDecisions}
          />
        ))}
      </ul>
    </aside>
  );
}

function ActivityLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
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
        whiteSpace: 'nowrap',
      }}
    >
      View Activity
    </button>
  );
}

const emailCount = (n: number): string => `${n.toLocaleString('en-US')} email${n === 1 ? '' : 's'}`;

/**
 * "Yankee Candle", or "Yankee Candle + 1 other" — the largest sender
 * leads because it is the name the reader is likeliest to recognise.
 * Null when the API sent no names (older API, or a token with no job).
 */
function whoLabel(entry: UndoTrayEntry, senderCount: number): string | null {
  // First NAMED member: members sort by size, and an unresolvable sender
  // at the top must not cost the line every other name.
  const first = entry.members?.find((m) => m.senderName !== null)?.senderName ?? null;
  if (first === null) return null;
  const others = senderCount - 1;
  return others > 0 ? `${first} + ${others} other${others === 1 ? '' : 's'}` : first;
}

/**
 * One decision (founder report 2026-09-20).
 *
 * The line states what, how much, and whose — and its button says what
 * it does: `token` has always reversed the WHOLE decision, which the old
 * one-line-per-token list hid behind N identical "Undo" buttons.
 *
 * A native `<details>` holds the per-sender list: no state to own, and
 * keyboard + screen-reader disclosure semantics for free.
 */
function DecisionRow({
  entry,
  onUndoAll,
  onUndoMember,
  defaultOpen,
}: {
  entry: UndoTrayEntry;
  onUndoAll: () => void;
  onUndoMember: ((token: string) => Promise<void>) | undefined;
  defaultOpen: boolean;
}) {
  const rowRef = useRef<HTMLLIElement | null>(null);
  const members = entry.members ?? [];
  const mixed = entry.mixedKinds === true;
  // Never below what the member list itself proves: a job whose selector
  // is not sender-shaped counts 0 senders server-side, and "Undo" beside
  // one name for a multi-member decision is the defect this row replaced.
  const senderCount = Math.max(
    entry.senderCount ?? 0,
    mixed ? 0 : members.length,
    members.length > 0 ? 1 : 0,
  );
  const who = whoLabel(entry, senderCount);
  // "All" = every change behind this one token, senders OR verbs.
  const isBulk = senderCount > 1 || members.length > 1;
  // One total under one verb label is only true when every member shares
  // that verb; otherwise each member states its own below.
  const total =
    typeof entry.affectedCount === 'number' && !mixed ? emailCount(entry.affectedCount) : null;
  const showMembers = isBulk;
  // `memberCount` is the total the server capped `members` against. An
  // API predating it can only be compared sender-for-sender, which is
  // wrong once verbs are mixed (one sender, one member PER verb) — so
  // there the gap is left unstated rather than guessed.
  const unlisted =
    typeof entry.memberCount === 'number'
      ? entry.memberCount - members.length
      : mixed
        ? 0
        : senderCount - members.length;

  return (
    <li ref={rowRef} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <span style={{ color: color.fgSoft, minWidth: 0 }}>
          {resultLabel(entry.actionKind)}
          {total !== null || who !== null ? (
            <span style={{ color: color.fg }}>
              {total !== null ? ` · ${total}` : ''}
              {who !== null ? ` · ${who}` : ''}
            </span>
          ) : null}
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
          onClick={onUndoAll}
          ariaLabel={`Undo ${verbLabel(entry.actionKind)}${who !== null ? ` for ${who}` : ''}`}
        >
          {isBulk ? 'Undo all' : 'Undo'}
        </Button>
      </div>
      {showMembers && members.length > 0 ? (
        // Open by default when verbs are mixed: the headline can only name
        // ONE of them, so the list is what makes the row true.
        <details open={mixed || defaultOpen}>
          <summary
            style={{
              cursor: 'pointer',
              color: color.fgSoft,
              fontFamily: font.mono,
              fontSize: 11.5,
              letterSpacing: '0.04em',
            }}
          >
            {mixed ? 'Show what changed' : `Show ${senderCount.toLocaleString('en-US')} senders`}
          </summary>
          <ul
            // A scroll region with no buttons in it is unreachable by
            // keyboard unless it is itself focusable.
            {...(onUndoMember ? {} : { tabIndex: 0 })}
            aria-label="Senders in this decision"
            style={{
              listStyle: 'none',
              margin: '6px 0 0',
              // Indented under the decision it belongs to.
              padding: '0 0 0 12px',
              borderLeft: `1px solid ${color.line}`,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              maxHeight: 180,
              overflowY: 'auto',
            }}
          >
            {members.map((member) => (
              <li
                key={member.token}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  fontSize: 12,
                  color: color.fgSoft,
                }}
              >
                <span style={{ minWidth: 0 }}>
                  {member.senderName ?? 'Unknown sender'}
                  <span style={{ color: color.fgMuted }}>
                    {' · '}
                    {mixed ? `${resultLabel(member.actionKind)} · ` : ''}
                    {emailCount(member.affectedCount)}
                  </span>
                </span>
                {onUndoMember ? (
                  <Button
                    size="sm"
                    tone="ghost"
                    onClick={() => {
                      // This row unmounts as the undo starts; park focus
                      // on the decision's own button instead of <body>.
                      rowRef.current?.querySelector('button')?.focus();
                      void onUndoMember(member.token);
                    }}
                    ariaLabel={`Undo ${verbLabel(member.actionKind)} for ${member.senderName ?? 'this sender'} only`}
                  >
                    Undo
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
          {unlisted > 0 ? (
            <span style={{ fontSize: 11, color: color.fgMuted }}>
              {unlisted.toLocaleString('en-US')} more in Activity — “Undo all” still covers them.
            </span>
          ) : null}
        </details>
      ) : null}
    </li>
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
  // No `timeZone` override — `Intl.DateTimeFormat` defaults to the
  // reader's own zone. A hardcoded `'UTC'` here disagreed with every
  // other surface stating this same deadline in the reader's zone
  // (QA-triage-20260827-09 / QA-undo-20260828-04). Undo entries ARE
  // SSR-prefetched (`server-app-boundary.tsx`), but this app's own
  // `ProductUndoTray` (`triage-undo-tray.tsx`) hides every token already
  // live when the screen was entered behind a baseline — nothing this
  // formatter renders is ever painted before hydration, so there is no
  // SSR/client TZ mismatch to worry about for THIS consumer. A future
  // consumer of `<UndoTray>` that renders prefetched entries on first
  // paint would need its own guard.
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
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
