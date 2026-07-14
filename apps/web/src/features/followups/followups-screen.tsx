'use client';

import { useEffect, useMemo, type FocusEvent, type MouseEvent } from 'react';

import { Button, EmptyState, ScreenIntro, tokens, useIsAtMost } from '@declutrmail/shared';

import type { FollowupRow } from '@/lib/api/followups';
import { track } from '@/lib/posthog';

import { useDismissFollowup } from './api/use-dismiss-followup';
import { useFollowups } from './api/use-followups';

const { color, font } = tokens;

/**
 * Followups screen (D90, D91).
 *
 * Layout per D90:
 *   1. ScreenIntro + observed-state disclosure + stats summary line
 *   2. Grouped sections by D85 age bucket (High / Medium / Low)
 *   3. Per-row: recipient name + domain, subject (truncated to 60 chars),
 *      sent-at relative time, [Open in Gmail →] link
 *
 * D88 "Mark resolved": every row carries a labeled button with the
 * existing trash icon (visible always and emphasized on hover / keyboard focus per D88's
 * "trash icon on hover" — never opacity-0 so touch + keyboard users can
 * reach it). Click → `useDismissFollowup` removes the row optimistically
 * (rolled back with a toast on failure) and the BE flips the
 * `followup_tracker` row + writes the Activity audit entry. When the
 * last row is dismissed the D91 empty state renders on the same pass.
 * The UI explicitly distinguishes this DeclutrMail-only dismissal from
 * observing an actual recipient reply in Gmail.
 *
 * Empty / loading / error states are first-class per D211 / D212 and
 * state the observed 60-day scope instead of implying live Gmail state.
 *
 * Privacy (D7, D228): the screen renders ONLY sender, subject, recipient
 * metadata, and dates. No body. No snippet. No attachments. The wire
 * shape on `apps/web/src/lib/api/followups.ts` does not even declare a
 * `snippet` field — body-adjacent content cannot reach this screen by
 * construction.
 */
export function FollowupsScreen() {
  const query = useFollowups();
  const dismiss = useDismissFollowup();

  // `mailbox_id: null` — the screen deliberately avoids `useAuth()` so
  // its Storybook stories mount without an auth shim; PostHog
  // `identify` ties the event to the user regardless.
  useEffect(() => {
    void track('page_viewed', { page: 'followups', mailbox_id: null });
  }, []);

  // Group BEFORE early-returning so the hook list is stable across
  // every render branch.
  const grouped = useMemo<GroupedFollowups>(() => groupByPriority(query.data ?? []), [query.data]);
  const overAWeek = grouped.high.length;
  const totalAwaiting = (query.data ?? []).length;

  // Below `sm` (D60 mobile treatment) the 5-track row grid overflows a
  // phone viewport — resolve the breakpoint once and thread it to the
  // rows so each restacks to a single-column card with wrapped actions.
  const isMobile = useIsAtMost('sm');

  if (query.isLoading) {
    return <LoadingState />;
  }
  if (query.isError) {
    return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  }

  const rows = query.data ?? [];

  return (
    <div
      style={{
        padding: '20px 24px 28px',
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
        maxWidth: 920,
        fontFamily: font.sans,
      }}
    >
      <ScreenIntro
        id="followups"
        title="Followups"
        body="Observed from indexed Sent mail: threads where your latest indexed message is outgoing and no later reply has been found."
        tip="This is not live Gmail status. Checks run about every six hours across sent mail from the last 60 days."
      />

      <FollowupsScopeDisclosure />

      {rows.length === 0 ? (
        <EmptyState
          title="No follow-ups observed."
          description="No thread in the current 60-day window has an outgoing latest message without a later reply in the indexed data. The next check runs within about six hours."
        />
      ) : (
        <>
          <StatsSummary total={totalAwaiting} overAWeek={overAWeek} />
          {grouped.high.length > 0 && (
            <PriorityGroup
              label="Over a week"
              tone="danger"
              rows={grouped.high}
              onDismiss={dismiss.mutate}
              isMobile={isMobile}
            />
          )}
          {grouped.medium.length > 0 && (
            <PriorityGroup
              label="3–7 days"
              tone="warn"
              rows={grouped.medium}
              onDismiss={dismiss.mutate}
              isMobile={isMobile}
            />
          )}
          {grouped.low.length > 0 && (
            <PriorityGroup
              label="1–3 days"
              tone="muted"
              rows={grouped.low}
              onDismiss={dismiss.mutate}
              isMobile={isMobile}
            />
          )}
          {grouped.fresh.length > 0 && (
            <PriorityGroup
              label="Less than a day"
              tone="muted"
              rows={grouped.fresh}
              onDismiss={dismiss.mutate}
              isMobile={isMobile}
            />
          )}
        </>
      )}
    </div>
  );
}

// ── Layout primitives ─────────────────────────────────────────────────

interface GroupedFollowups {
  high: FollowupRow[];
  medium: FollowupRow[];
  low: FollowupRow[];
  fresh: FollowupRow[];
}

function groupByPriority(rows: readonly FollowupRow[]): GroupedFollowups {
  const grouped: GroupedFollowups = { high: [], medium: [], low: [], fresh: [] };
  for (const row of rows) {
    grouped[row.priority].push(row);
  }
  return grouped;
}

/** D90 — stats summary line at the top of the screen. */
function StatsSummary({ total, overAWeek }: { total: number; overAWeek: number }) {
  const totalLabel = `${total} thread${total === 1 ? '' : 's'} with no later reply observed`;
  const overLabel = `${overAWeek} over a week`;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        fontFamily: font.sans,
        fontSize: 13,
        color: color.fgMuted,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <strong style={{ color: color.fg, fontWeight: 600 }}>{totalLabel}</strong>
      <span aria-hidden="true">·</span>
      <span>{overLabel}</span>
    </div>
  );
}

/** D245 — disclose the observation window and false-positive control in context. */
function FollowupsScopeDisclosure() {
  return (
    <details
      style={{
        background: color.paper,
        border: `1px solid ${color.lineSoft}`,
        borderRadius: 8,
        color: color.fgSoft,
        fontSize: 12.5,
        lineHeight: 1.6,
        padding: '10px 12px',
      }}
    >
      <summary style={{ color: color.primary, cursor: 'pointer', fontWeight: 600 }}>
        Why a thread may still appear — and how to hide it
      </summary>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7, paddingTop: 8 }}>
        <p style={{ margin: 0 }}>
          DeclutrMail uses indexed sender, recipient, subject, thread, and date metadata — not
          message bodies — to find threads where your latest indexed message is outgoing.
        </p>
        <p style={{ margin: 0 }}>
          Checks run about every six hours and consider sent mail from the last 60 days, so a recent
          reply can remain here until the next check.
        </p>
        <p style={{ margin: 0 }}>
          Already resolved elsewhere or not a useful follow-up? Use <strong>Mark resolved</strong>.
          It hides the item in DeclutrMail and records the choice in Activity; it does not mark a
          recipient reply or change Gmail.
        </p>
      </div>
    </details>
  );
}

type GroupTone = 'danger' | 'warn' | 'muted';

function PriorityGroup({
  label,
  tone,
  rows,
  onDismiss,
  isMobile,
}: {
  label: string;
  tone: GroupTone;
  rows: FollowupRow[];
  onDismiss?: (row: FollowupRow) => void;
  isMobile: boolean;
}) {
  return (
    <section
      aria-label={`${label} (${rows.length})`}
      style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      <GroupHeading label={label} tone={tone} count={rows.length} />
      <ul
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        {rows.map((row) => (
          <FollowupListItem key={row.id} row={row} onDismiss={onDismiss} isMobile={isMobile} />
        ))}
      </ul>
    </section>
  );
}

function GroupHeading({ label, tone, count }: { label: string; tone: GroupTone; count: number }) {
  const dotColor = tone === 'danger' ? color.red : tone === 'warn' ? color.amber : color.fgMuted;
  return (
    <h2
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        margin: 0,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: color.fgSoft,
        fontFamily: font.mono,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: dotColor,
        }}
      />
      {label}
      <span style={{ color: color.fgMuted, fontWeight: 500 }}>· {count}</span>
    </h2>
  );
}

/**
 * Single Followups row. Recipient name + domain leads, subject is
 * truncated to 60 chars per D90, sent-at renders as a relative time,
 * a trailing link opens the thread in Gmail, and the D88 trash-icon
 * button marks the row resolved.
 */
export function FollowupListItem({
  row,
  onDismiss,
  isMobile = false,
}: {
  row: FollowupRow;
  onDismiss?: ((row: FollowupRow) => void) | undefined;
  /** Below `sm` the row restacks to a single-column card (D60). */
  isMobile?: boolean;
}) {
  const recipient = recipientLine(row);
  const subject = truncate(row.subject, 60);
  const relative = relativeTime(row.sentAt);
  const gmailHref = `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(row.providerThreadId)}`;

  return (
    <li
      style={{
        display: 'grid',
        // Mobile (D60): recipient + subject stack full-width; the meta
        // actions (time · Gmail · resolve) wrap onto one row below.
        gridTemplateColumns: isMobile
          ? onDismiss
            ? '1fr auto auto'
            : '1fr auto'
          : onDismiss
            ? 'minmax(180px, 1fr) minmax(220px, 2fr) auto auto auto'
            : 'minmax(180px, 1fr) minmax(220px, 2fr) auto auto',
        alignItems: 'center',
        gap: isMobile ? '8px 12px' : 14,
        padding: '12px 14px',
        background: color.card,
        border: `1px solid ${color.lineSoft}`,
        borderRadius: 10,
        fontFamily: font.sans,
      }}
    >
      <div style={{ minWidth: 0, ...(isMobile ? { gridColumn: '1 / -1' } : null) }}>
        <div
          style={{
            fontSize: 13.5,
            fontWeight: 600,
            color: color.fg,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {recipient.name}
        </div>
        <div style={{ fontSize: 12, color: color.fgMuted, fontFamily: font.mono }}>
          {recipient.domain}
        </div>
      </div>
      <div
        title={row.subject}
        style={{
          fontSize: 13,
          color: color.fg,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          ...(isMobile ? { gridColumn: '1 / -1' } : null),
        }}
      >
        {subject}
      </div>
      <time
        dateTime={row.sentAt}
        style={{
          fontSize: 12,
          color: color.fgMuted,
          fontFamily: font.mono,
          whiteSpace: 'nowrap',
        }}
      >
        Sent {relative}
      </time>
      <a
        href={gmailHref}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open in Gmail — ${recipient.name}: ${subject}`}
        style={{
          fontSize: 12.5,
          color: color.primary,
          textDecoration: 'none',
          whiteSpace: 'nowrap',
        }}
      >
        Open in Gmail →
      </a>
      {onDismiss && (
        <button
          type="button"
          onClick={() => onDismiss(row)}
          title="Mark resolved in DeclutrMail — this does not mark a recipient reply"
          aria-label={`Mark resolved in DeclutrMail — ${recipient.name}; does not mark a recipient reply`}
          onMouseEnter={emphasizeDismiss}
          onMouseLeave={resetDismiss}
          onFocus={emphasizeDismiss}
          onBlur={resetDismiss}
          style={{
            height: 28,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 5,
            background: 'transparent',
            color: color.fgMuted,
            border: `1px solid ${color.line}`,
            borderRadius: 6,
            cursor: 'pointer',
            padding: '0 8px',
            flexShrink: 0,
            fontFamily: font.sans,
            fontSize: 11.5,
            fontWeight: 600,
            transition: 'background 0.12s, color 0.12s, border-color 0.12s',
          }}
        >
          <TrashIcon />
          Mark resolved
        </button>
      )}
    </li>
  );
}

/**
 * D88 dismiss affordance styling. The trash button is ALWAYS rendered
 * (never opacity-0 — touch + keyboard users must reach it) at low
 * emphasis, and lifts to full contrast on hover AND keyboard focus.
 * Mirrors the senders `IconVerb` hover treatment so per-row icon
 * actions feel identical across screens.
 */
function emphasizeDismiss(e: FocusEvent<HTMLButtonElement> | MouseEvent<HTMLButtonElement>) {
  e.currentTarget.style.background = color.paper;
  e.currentTarget.style.color = color.red;
  e.currentTarget.style.borderColor = color.fgMuted;
}

function resetDismiss(e: FocusEvent<HTMLButtonElement> | MouseEvent<HTMLButtonElement>) {
  e.currentTarget.style.background = 'transparent';
  e.currentTarget.style.color = color.fgMuted;
  e.currentTarget.style.borderColor = color.line;
}

/** Trash glyph (D88 "trash icon on hover") — feather-style, 11px. */
function TrashIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

// ── Loading / error branches ─────────────────────────────────────────

function LoadingState() {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        padding: '20px 24px 28px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        maxWidth: 920,
      }}
    >
      {[56, 56, 56, 56].map((h, i) => (
        <div
          key={i}
          aria-hidden="true"
          style={{
            height: h,
            background: color.card,
            border: `1px solid ${color.lineSoft}`,
            borderRadius: 10,
          }}
        />
      ))}
      <span style={{ position: 'absolute', left: -9999 }}>
        Loading observed follow-ups from indexed Sent mail
      </span>
    </div>
  );
}

function ErrorState({ onRetry }: { error: unknown; onRetry: () => void }) {
  const message =
    "We couldn't load the observed Sent-mail list. Nothing was changed. Try again in a moment.";
  return (
    <div style={{ padding: '20px 24px 28px', maxWidth: 720, fontFamily: font.sans }}>
      <EmptyState
        title="We couldn't load your Followups"
        description={message}
        action={
          <Button tone="primary" onClick={onRetry}>
            Retry Followups
          </Button>
        }
      />
    </div>
  );
}

// ── Pure helpers ──────────────────────────────────────────────────────

interface RecipientLine {
  name: string;
  domain: string;
}

export function recipientLine(
  row: Pick<FollowupRow, 'recipientDisplayName' | 'recipientEmail'>,
): RecipientLine {
  const email = row.recipientEmail;
  const at = email.lastIndexOf('@');
  const domain = at === -1 ? email : email.slice(at + 1);
  const name = row.recipientDisplayName.trim().length > 0 ? row.recipientDisplayName : email;
  return { name, domain };
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Coarse "sent N days/hours ago" formatter — bounded to the buckets we
 * actually display (`fresh` / `low` / `medium` / `high`). Localized
 * formatting would be a follow-up.
 */
export function relativeTime(iso: string, nowMs: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const diffMs = Math.max(0, nowMs - then);
  const minutes = Math.floor(diffMs / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days >= 1) return `${days}d ago`;
  if (hours >= 1) return `${hours}h ago`;
  if (minutes >= 1) return `${minutes}m ago`;
  return 'just now';
}
