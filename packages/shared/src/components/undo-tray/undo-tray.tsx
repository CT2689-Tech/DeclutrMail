'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';

import { Button } from '../button';
import { InlineProgress } from '../inline-progress/inline-progress';
import { color, font, radius, shadow, text } from '../../tokens/tokens';
import { getActionSemantics } from '../../actions/action-semantics';
import type {
  UndoActionKind,
  UndoTrayDataSource,
  UndoTrayEntry,
  UndoTrayNotice,
} from './undo-tray.types';

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
/** Visually hidden, still read aloud. */
const SR_ONLY: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

/** What a screen reader hears — the headline, without the ticking fraction. */
function headlineSpeech(headline: TrayHeadline | null): string {
  if (headline === null) return '';
  if (headline.kind === 'notice') {
    const { label, who } = headline.notice;
    return who ? `${label} ${who}` : label;
  }
  const { entry } = headline;
  const total =
    typeof entry.affectedCount === 'number' && entry.mixedKinds !== true
      ? ` ${emailCount(entry.affectedCount)}`
      : '';
  return `${doneLabel(entry.actionKind)}${total}. Undo available.`;
}

/**
 * The tray plus its ALWAYS-mounted live region.
 *
 * The pill is the only voice for an action's outcome (no toasts, no
 * strip), and it mounts together with its first message — a live region
 * inserted along with its content is not reliably announced, so the first
 * action after a page load was silent (design gate 2026-09-20). This
 * region exists before anything happens and is only ever filled. Problems
 * are `role="alert"` in the pill itself: alerts ARE announced on insertion.
 */
export function UndoTray(props: Parameters<typeof UndoTrayBody>[0]) {
  const headline = pickHeadline(props.dataSource.notices ?? [], props.dataSource.entries);
  const speech =
    headline?.kind === 'notice' && headline.notice.tone === 'attention'
      ? ''
      : headlineSpeech(headline);
  return (
    <>
      <div role="status" aria-live="polite" data-dm-undo-tray-speech style={SR_ONLY}>
        {speech}
      </div>
      <UndoTrayBody {...props} />
    </>
  );
}

function UndoTrayBody({
  dataSource,
  onViewActivity,
  defaultOpenDecisions = false,
  defaultOpen = false,
  defaultCompact = false,
  style,
}: {
  /** Entries + revert callback, built on the host app's API client. */
  dataSource: UndoTrayDataSource;
  /** Click handler for the "View Activity" link in the tray header. */
  onViewActivity?: () => void;
  /** Render bulk decisions expanded — for stories and visual snapshots. */
  defaultOpenDecisions?: boolean;
  /** Start as the full list rather than the pill — stories and list tests. */
  defaultOpen?: boolean;
  /** Start as the shrunk chip — the state a timer otherwise gates. Stories. */
  defaultCompact?: boolean;
  style?: CSSProperties;
}) {
  const source = dataSource;
  const notices = source.notices ?? [];
  const trayRef = useTrayInset();
  const [open, setOpen] = useState(defaultOpen);
  // Hover / focus holds the pill at full size.
  const [held, setHeld] = useState(false);
  const [compact, setCompact] = useState(defaultCompact);
  const key = headlineKey(pickHeadline(notices, source.entries));
  const settled = key.startsWith('d:');
  // A finished action says its piece, then gets out of the way. Anything
  // running or wrong stays put; so does a pill being read or reached for.
  const firstRun = useRef(true);
  useEffect(() => {
    // `defaultCompact` holds until something actually changes.
    if (!(firstRun.current && defaultCompact)) setCompact(false);
    firstRun.current = false;
    if (!settled || held || open) return;
    const timer = setTimeout(() => setCompact(true), TRAY_COMPACT_AFTER_MS);
    return () => clearTimeout(timer);
  }, [key, settled, held, open, defaultCompact]);

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
  if (!source.isLoading && !source.isError && source.entries.length === 0 && notices.length === 0) {
    return null;
  }
  // A running action outranks a failed undo-list read: the chip below has
  // no room for it, and the list is not what the user is waiting on.
  if (source.isError && source.entries.length === 0 && notices.length === 0) {
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
          fontSize: text.base,
          color: color.fg,
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 10,
          zIndex: 50,
          ...style,
        }}
      >
        <span style={{ color: color.fgMuted, fontFamily: font.mono, fontSize: text.xs }}>
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
              fontSize: text.sm,
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

  const headline = pickHeadline(notices, source.entries);
  const hasMore =
    notices.length + source.entries.length > 1 ||
    (headline?.kind === 'decision' && isBulkDecision(headline.entry));

  const shell: CSSProperties = {
    // Centred by auto margins against the FULL viewport, not by
    // `left: 50%` + `translateX(-50%)`: a fixed box with only `left` set
    // is shrink-to-fit against `viewport - left`, so at `left: 50%` it can
    // never exceed half the screen (browser smoke, 2026-07-29).
    position: 'fixed',
    bottom: 16,
    left: 16,
    right: 16,
    marginInline: 'auto',
    minWidth: 0,
    background: color.card,
    border: `1px solid ${color.line}`,
    boxShadow: shadow.card,
    fontFamily: font.sans,
    fontSize: text.base,
    color: color.fg,
    zIndex: 50,
  };

  if (!open) {
    return (
      <aside
        ref={trayRef}
        data-dm-undo-tray={compact ? 'compact' : 'pill'}
        role="region"
        aria-label="Recent actions"
        // Reading or reaching for it keeps it from shrinking underneath you.
        onMouseEnter={() => setHeld(true)}
        onMouseLeave={() => setHeld(false)}
        onFocus={() => setHeld(true)}
        onBlur={() => setHeld(false)}
        style={{
          ...shell,
          width: 'fit-content',
          maxWidth: 'min(640px, calc(100vw - 32px))',
          borderRadius: 999,
          padding: compact ? '4px 6px' : '6px 8px 6px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          ...style,
        }}
      >
        {compact ? (
          <Button
            size="sm"
            tone="ghost"
            onClick={() => setOpen(true)}
            ariaLabel={`Show ${source.entries.length} recent ${source.entries.length === 1 ? 'action' : 'actions'} — undo available`}
          >
            Undo · {source.entries.length}
          </Button>
        ) : (
          <>
            {headline ? (
              <Headline
                headline={headline}
                onUndo={(token) => void source.revert(token)}
                onViewActivity={onViewActivity}
              />
            ) : (
              <span style={{ color: color.fgMuted }}>Loading…</span>
            )}
            {hasMore ? (
              <Button
                size="sm"
                tone="ghost"
                onClick={() => setOpen(true)}
                ariaLabel="Show all recent actions"
                ariaExpanded={false}
              >
                ▴
              </Button>
            ) : null}
          </>
        )}
      </aside>
    );
  }

  return (
    <aside
      ref={trayRef}
      data-dm-undo-tray="open"
      role="region"
      aria-label="Recent actions"
      style={{
        ...shell,
        width: 'min(640px, calc(100vw - 32px))',
        maxWidth: 640,
        borderRadius: radius.lg,
        padding: '10px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
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
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <span style={{ color: color.fgMuted, fontFamily: font.mono, fontSize: text.xs }}>
          Recent actions
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
          {onViewActivity ? <ActivityLink onClick={onViewActivity} /> : null}
          <Button
            size="sm"
            tone="ghost"
            onClick={() => setOpen(false)}
            ariaLabel="Collapse recent actions"
            ariaExpanded
          >
            ▾
          </Button>
        </span>
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
        {notices.map((notice) => (
          <NoticeRow key={notice.id} notice={notice} />
        ))}
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

/** How long a finished action keeps the full pill before it shrinks. */
export const TRAY_COMPACT_AFTER_MS = 8000;

type TrayHeadline =
  | { kind: 'notice'; notice: UndoTrayNotice; running: number }
  | { kind: 'decision'; entry: UndoTrayEntry };

/**
 * The ONE thing the pill says. Something still running outranks
 * something that went wrong, which outranks the newest thing to undo —
 * the order in which the user is waiting on them.
 */
function pickHeadline(notices: UndoTrayNotice[], entries: UndoTrayEntry[]): TrayHeadline | null {
  const running = notices.filter((n) => n.tone === 'working');
  const notice =
    running[0] ?? notices.find((n) => n.tone === 'attention') ?? notices.find(() => true);
  if (notice) return { kind: 'notice', notice, running: running.length };
  const entry = entries[0];
  return entry ? { kind: 'decision', entry } : null;
}

const headlineKey = (h: TrayHeadline | null): string =>
  h === null
    ? ''
    : h.kind === 'notice'
      ? `n:${h.notice.id}`
      : `d:${h.entry.groupId ?? h.entry.token}`;

function decisionSenderCount(entry: UndoTrayEntry): number {
  const members = entry.members ?? [];
  // Never below what the member list itself proves (see `DecisionRow`).
  return Math.max(
    entry.senderCount ?? 0,
    entry.mixedKinds === true ? 0 : members.length,
    members.length > 0 ? 1 : 0,
  );
}

const isBulkDecision = (entry: UndoTrayEntry): boolean =>
  decisionSenderCount(entry) > 1 || (entry.members ?? []).length > 1;

function Headline({
  headline,
  onUndo,
  onViewActivity,
}: {
  headline: TrayHeadline;
  onUndo: (token: string) => void;
  onViewActivity: (() => void) | undefined;
}) {
  if (headline.kind === 'notice') {
    const { notice, running } = headline;
    const working = notice.tone === 'working';
    const attention = notice.tone === 'attention';
    return (
      <>
        <span
          data-dm-tray-notice={notice.tone}
          {...(attention ? { role: 'alert' as const } : {})}
          style={{ minWidth: 0, color: attention ? color.red : color.fg }}
        >
          <InlineProgress pending={working} mode="trailing" pendingLabel="Working">
            <span>
              {notice.label}
              {notice.detail ? (
                // Ticks every poll; announcing each tick would bury a screen reader.
                <span aria-live="off">{` · ${notice.detail}`}</span>
              ) : notice.who ? (
                ` · ${notice.who}`
              ) : null}
              {running > 1 ? ` · +${running - 1} more` : ''}
            </span>
          </InlineProgress>
        </span>
        {attention && onViewActivity ? (
          <Button size="sm" tone="ghost" onClick={onViewActivity}>
            See Activity
          </Button>
        ) : null}
        {notice.onDismiss ? (
          <Button
            size="sm"
            tone="ghost"
            onClick={notice.onDismiss}
            ariaLabel={`Dismiss: ${notice.label}`}
          >
            Dismiss
          </Button>
        ) : null}
      </>
    );
  }
  const { entry } = headline;
  const senderCount = decisionSenderCount(entry);
  const who = whoLabel(entry, senderCount);
  const total =
    typeof entry.affectedCount === 'number' && entry.mixedKinds !== true
      ? emailCount(entry.affectedCount)
      : null;
  const whose = senderCount > 1 ? `${senderCount.toLocaleString('en-US')} senders` : who;
  return (
    <>
      <span style={{ minWidth: 0 }}>
        {doneLabel(entry.actionKind)}
        {total !== null ? ` ${total}` : ''}
        {whose ? <span style={{ color: color.fgSoft }}>{` · ${whose}`}</span> : null}
      </span>
      <Button
        size="sm"
        tone="ghost"
        onClick={() => onUndo(entry.token)}
        ariaLabel={`Undo ${verbLabel(entry.actionKind)}${who !== null ? ` for ${who}` : ''}`}
      >
        {isBulkDecision(entry) ? 'Undo all' : 'Undo'}
      </Button>
    </>
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
        fontSize: text.sm,
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
              fontSize: text.xs,
            }}
          >
            Undo until {formatExpiry(entry.expiresAt)}
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
              fontFamily: font.sans,
              fontSize: text.sm,
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
                  fontSize: text.sm,
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
            <span style={{ fontSize: text.xs, color: color.fgMuted }}>
              {unlisted.toLocaleString('en-US')} more in Activity — “Undo all” still covers them.
            </span>
          ) : null}
        </details>
      ) : null}
    </li>
  );
}

/**
 * A running or ended-without-undo action. Same two-line shape as a
 * decision so the panel reads as one list; no Undo, because there is
 * nothing to undo yet (or at all).
 */
function NoticeRow({ notice }: { notice: UndoTrayNotice }) {
  const attention = notice.tone === 'attention';
  return (
    <li
      data-dm-tray-notice={notice.tone}
      // A failure interrupts; progress and no-ops wait their turn.
      role={attention ? 'alert' : 'status'}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        ...(attention
          ? {
              background: color.redBg,
              border: `1px solid ${color.redBorder}`,
              borderRadius: radius.md,
              padding: '6px 8px',
            }
          : null),
      }}
    >
      <span style={{ color: attention ? color.red : color.fgSoft, minWidth: 0 }}>
        {notice.label}
        {notice.who ? <span style={{ color: color.fg }}>{` · ${notice.who}`}</span> : null}
        {notice.detail ? (
          <span
            // Ticks every poll; announcing each tick would bury the screen reader.
            aria-live="off"
            style={{
              display: 'block',
              color: color.fgMuted,
              fontFamily: font.sans,
              fontSize: text.xs,
            }}
          >
            {notice.detail}
          </span>
        ) : null}
      </span>
      {notice.onDismiss ? (
        <Button
          size="sm"
          tone="ghost"
          onClick={notice.onDismiss}
          ariaLabel={`Dismiss: ${notice.label}`}
        >
          Dismiss
        </Button>
      ) : null}
    </li>
  );
}

/**
 * The pill's past-tense verb — the short form; the expanded list keeps the
 * registry's full result label. Unsubscribe states the request, never the
 * outcome (D58: nothing here knows the sender honoured it).
 */
function doneLabel(kind: UndoActionKind): string {
  switch (kind) {
    case 'archive':
      return 'Archived';
    case 'later':
      return 'Moved to Later';
    case 'delete':
      return 'Deleted';
    case 'unsubscribe':
      return 'Unsubscribe requested';
    case 'apply-rule':
      return 'Rule applied';
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
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
