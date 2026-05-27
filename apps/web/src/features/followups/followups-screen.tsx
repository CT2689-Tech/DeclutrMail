'use client';

import { useMemo } from 'react';

import { Button, EmptyState, ScreenIntro, tokens } from '@declutrmail/shared';

import { ApiError } from '@/lib/api/client';
import type { FollowupRow } from '@/lib/api/followups';

import { useFollowups } from './api/use-followups';

const { color, font } = tokens;

/**
 * Followups screen (D90, D91).
 *
 * Layout per D90:
 *   1. ScreenIntro + stats summary line — "N threads awaiting reply · M over a week"
 *   2. Grouped sections by D85 age bucket (High / Medium / Low)
 *   3. Per-row: recipient name + domain, subject (truncated to 60 chars),
 *      sent-at relative time, [Open in Gmail →] link
 *
 * D88 "Mark resolved" is wired by the dismiss endpoint (`POST
 * /api/followups/:id/dismiss`) — kept out of this screen because the
 * mutation slice for Followups is a separate concern from D90's layout
 * shipment. The row trash-icon affordance lands in the follow-up PR
 * tracked by D88 (already 🔵 shipped via #106 on the BE; the FE wiring
 * is intentionally narrow here per the canonical-verbs / surgical-change
 * rule).
 *
 * Empty / loading / error states are first-class per D211 / D212.
 * Empty copy mirrors D91 verbatim.
 *
 * Privacy (D7, D228): the screen renders ONLY sender, subject, recipient
 * metadata, and dates. No body. No snippet. No attachments. The wire
 * shape on `apps/web/src/lib/api/followups.ts` does not even declare a
 * `snippet` field — body-adjacent content cannot reach this screen by
 * construction.
 */
export function FollowupsScreen() {
  const query = useFollowups();

  // Group BEFORE early-returning so the hook list is stable across
  // every render branch.
  const grouped = useMemo<GroupedFollowups>(() => groupByPriority(query.data ?? []), [query.data]);
  const overAWeek = grouped.high.length;
  const totalAwaiting = (query.data ?? []).length;

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
        body="Threads where you sent the last message and haven't heard back. We watch your Sent folder and surface what's overdue — sorted oldest first."
        tip="Mark resolved once you've nudged them another way (phone, Slack, in-person)."
      />

      {rows.length === 0 ? (
        <EmptyState
          title="No follow-ups waiting."
          description={
            <>
              We watch your Sent folder for emails that haven&rsquo;t gotten a reply.
              Nothing&rsquo;s overdue right now.
            </>
          }
        />
      ) : (
        <>
          <StatsSummary total={totalAwaiting} overAWeek={overAWeek} />
          {grouped.high.length > 0 && (
            <PriorityGroup label="Over a week" tone="danger" rows={grouped.high} />
          )}
          {grouped.medium.length > 0 && (
            <PriorityGroup label="3–7 days" tone="warn" rows={grouped.medium} />
          )}
          {grouped.low.length > 0 && (
            <PriorityGroup label="1–3 days" tone="muted" rows={grouped.low} />
          )}
          {grouped.fresh.length > 0 && (
            <PriorityGroup label="Less than a day" tone="muted" rows={grouped.fresh} />
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
  const totalLabel = `${total} thread${total === 1 ? '' : 's'} awaiting reply`;
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

type GroupTone = 'danger' | 'warn' | 'muted';

function PriorityGroup({
  label,
  tone,
  rows,
}: {
  label: string;
  tone: GroupTone;
  rows: FollowupRow[];
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
          <FollowupListItem key={row.id} row={row} />
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
 * and a single trailing link opens the thread in Gmail.
 */
export function FollowupListItem({ row }: { row: FollowupRow }) {
  const recipient = recipientLine(row);
  const subject = truncate(row.subject, 60);
  const relative = relativeTime(row.sentAt);
  const gmailHref = `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(row.providerThreadId)}`;

  return (
    <li
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(180px, 1fr) minmax(220px, 2fr) auto auto',
        alignItems: 'center',
        gap: 14,
        padding: '12px 14px',
        background: color.card,
        border: `1px solid ${color.lineSoft}`,
        borderRadius: 10,
        fontFamily: font.sans,
      }}
    >
      <div style={{ minWidth: 0 }}>
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
        }}
      >
        {subject}
      </div>
      <div
        style={{
          fontSize: 12,
          color: color.fgMuted,
          fontFamily: font.mono,
          whiteSpace: 'nowrap',
        }}
      >
        {relative}
      </div>
      <a
        href={gmailHref}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          fontSize: 12.5,
          color: color.primary,
          textDecoration: 'none',
          whiteSpace: 'nowrap',
        }}
      >
        Open in Gmail →
      </a>
    </li>
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
      <span style={{ position: 'absolute', left: -9999 }}>Loading followups</span>
    </div>
  );
}

function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const message =
    error instanceof ApiError
      ? `We couldn't load your followups (${error.status}). Try again in a moment.`
      : "We couldn't load your followups right now. Try again in a moment.";
  return (
    <div style={{ padding: '20px 24px 28px', maxWidth: 720, fontFamily: font.sans }}>
      <EmptyState
        title="We couldn't load your followups"
        description={message}
        action={
          <Button tone="primary" onClick={onRetry}>
            Try again
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
