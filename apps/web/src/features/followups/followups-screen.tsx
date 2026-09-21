'use client';

import { useEffect, useMemo } from 'react';
import { useNow } from '@/lib/use-now';

import {
  EmptyState,
  ErrorState as RecoverableErrorState,
  ScreenIntro,
  tokens,
  useIsAtMost,
} from '@declutrmail/shared';

import type { FollowupRow } from '@/lib/api/followups';
import { track } from '@/lib/posthog';
import { getActiveMailboxEmail, useOptionalAuth } from '@/features/auth/auth-provider';
import { InlineFeedback } from '@/features/feedback/inline-feedback';
import { GmailOpenLinkService } from '@/lib/gmail/open-link';

import { useDismissFollowup } from './api/use-dismiss-followup';
import { useFollowups } from './api/use-followups';

const { color, font, motion, text } = tokens;

/**
 * Followups screen (D90, D91).
 *
 * Layout per D90:
 *   1. One-line header + the two-sentence scope note
 *   2. Grouped sections by D85 age bucket (High / Medium / Low)
 *   3. Per-row: recipient name + domain, subject (truncated to 60 chars),
 *      sent-at relative time, [Open in Gmail →] link
 *
 * D88 "Mark resolved": every row carries an always-visible labeled
 * button (never hover-only — touch + keyboard users must reach it).
 * Click → `useDismissFollowup` removes the row optimistically
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
  const auth = useOptionalAuth();
  const activeMailboxEmail = auth ? getActiveMailboxEmail(auth.me) : null;
  const query = useFollowups();
  const dismiss = useDismissFollowup();

  // `mailbox_id: null` keeps the historical event contract. The nullable
  // auth hook above binds Gmail links in production without making isolated
  // stories invent a mailbox; PostHog identity still attaches separately.
  useEffect(() => {
    void track('page_viewed', { page: 'followups', mailbox_id: null });
  }, []);

  // Group BEFORE early-returning so the hook list is stable across
  // every render branch.
  const grouped = useMemo<GroupedFollowups>(() => groupByPriority(query.data ?? []), [query.data]);
  // Below `sm` (D60 mobile treatment) the 5-track row grid overflows a
  // phone viewport — resolve the breakpoint once and thread it to the
  // rows so each restacks to a single-column card with wrapped actions.
  const isMobile = useIsAtMost('sm');

  if (query.isLoading) {
    return <LoadingState />;
  }
  if (query.isError) {
    return <FollowupsErrorState onRetry={() => query.refetch()} />;
  }

  const rows = query.data ?? [];

  return (
    <div
      style={{
        padding: '20px clamp(16px, 4vw, 24px) 28px',
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
        width: '100%',
        boxSizing: 'border-box',
        maxWidth: 880,
        margin: '0 auto',
        fontFamily: font.sans,
      }}
    >
      <h1
        style={{
          margin: 0,
          fontSize: text['2xl'],
          fontWeight: 600,
          letterSpacing: '-0.015em',
          color: color.fg,
        }}
      >
        Follow-ups
      </h1>
      <ScreenIntro
        id="followups"
        title="Follow-ups"
        body="Conversations where you wrote last and haven't heard back."
      />

      {rows.length === 0 ? (
        <EmptyState
          title="No follow-ups"
          description="Nothing you sent in the last 60 days is waiting on a reply."
        />
      ) : (
        <>
          <FollowupsScopeNote />
          {grouped.high.length > 0 && (
            <PriorityGroup
              label="Over a week"
              rows={grouped.high}
              onDismiss={dismiss.mutate}
              isMobile={isMobile}
              mailboxEmail={activeMailboxEmail}
            />
          )}
          {grouped.medium.length > 0 && (
            <PriorityGroup
              label="3–7 days"
              rows={grouped.medium}
              onDismiss={dismiss.mutate}
              isMobile={isMobile}
              mailboxEmail={activeMailboxEmail}
            />
          )}
          {grouped.low.length > 0 && (
            <PriorityGroup
              label="1–3 days"
              rows={grouped.low}
              onDismiss={dismiss.mutate}
              isMobile={isMobile}
              mailboxEmail={activeMailboxEmail}
            />
          )}
          {grouped.fresh.length > 0 && (
            <PriorityGroup
              label="Less than a day"
              rows={grouped.fresh}
              onDismiss={dismiss.mutate}
              isMobile={isMobile}
              mailboxEmail={activeMailboxEmail}
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

/**
 * D245 — the two facts that change what the user does with a row: the
 * list is a periodic check (not live Gmail), and Mark resolved is local.
 */
function FollowupsScopeNote() {
  return (
    <p style={{ margin: 0, fontSize: text.sm, lineHeight: 1.5, color: color.fgMuted }}>
      Checked about every six hours, so a recent reply can still show. Mark resolved only hides a
      thread here — nothing changes in Gmail.
    </p>
  );
}

function PriorityGroup({
  label,
  rows,
  onDismiss,
  isMobile,
  mailboxEmail,
}: {
  label: string;
  rows: FollowupRow[];
  onDismiss?: (row: FollowupRow) => void;
  isMobile: boolean;
  mailboxEmail: string | null;
}) {
  return (
    <section
      aria-label={`${label} (${rows.length})`}
      style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
    >
      <GroupHeading label={label} count={rows.length} />
      <ul
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {rows.map((row) => (
          <FollowupListItem
            key={row.id}
            row={row}
            onDismiss={onDismiss}
            isMobile={isMobile}
            mailboxEmail={mailboxEmail}
          />
        ))}
      </ul>
    </section>
  );
}

function GroupHeading({ label, count }: { label: string; count: number }) {
  return (
    <h2
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 6,
        margin: 0,
        fontSize: text.sm,
        fontWeight: 600,
        color: color.fgSoft,
      }}
    >
      {label}
      <span
        style={{
          color: color.fgMuted,
          fontWeight: 500,
          fontFamily: font.mono,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        · {count}
      </span>
    </h2>
  );
}

/**
 * Single Followups row. Recipient name + domain leads, subject is
 * truncated to 60 chars per D90, sent-at renders as a relative time,
 * a trailing link opens the thread in Gmail, and the D88 button marks
 * the row resolved.
 */
export function FollowupListItem({
  row,
  onDismiss,
  isMobile = false,
  mailboxEmail,
}: {
  row: FollowupRow;
  onDismiss?: ((row: FollowupRow) => void) | undefined;
  /** Below `sm` the row restacks to a single-column card (D60). */
  isMobile?: boolean;
  /** Active Gmail account. Null in isolated stories, where links fail closed. */
  mailboxEmail: string | null;
}) {
  const recipient = recipientLine(row);
  const subject = truncate(row.subject, 60);
  const now = useNow();
  const relative = now === null ? '' : relativeTime(row.sentAt, now);
  const gmailHref = mailboxEmail
    ? GmailOpenLinkService.buildOpenLink({
        mailboxEmail,
        gmailMessageId: row.providerThreadId,
      })
    : null;

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
        padding: '12px 0',
        borderTop: `1px solid ${color.line}`,
        fontFamily: font.sans,
      }}
    >
      <div style={{ minWidth: 0, ...(isMobile ? { gridColumn: '1 / -1' } : null) }}>
        <div
          style={{
            fontSize: text.md,
            fontWeight: 600,
            color: color.fg,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {recipient.name}
        </div>
        <div style={{ fontSize: text.sm, color: color.fgMuted, fontFamily: font.mono }}>
          {recipient.domain}
        </div>
      </div>
      <div
        title={row.subject}
        style={{
          fontSize: text.md,
          color: color.fgSoft,
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
          fontSize: text.sm,
          color: color.fgMuted,
          fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'nowrap',
        }}
      >
        Sent {relative}
      </time>
      {gmailHref ? (
        <a
          href={gmailHref}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open in Gmail — ${recipient.name}: ${subject}`}
          style={{
            fontSize: text.sm,
            color: color.primary,
            textDecoration: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          Open in Gmail
        </a>
      ) : (
        <span aria-hidden="true" />
      )}
      {onDismiss && (
        <button
          type="button"
          onClick={() => onDismiss(row)}
          title="Mark resolved in DeclutrMail"
          aria-label={`Mark resolved in DeclutrMail — ${recipient.name}`}
          style={{
            // 44px touch target on phones; compact on desktop.
            minHeight: isMobile ? 44 : 28,
            display: 'inline-flex',
            alignItems: 'center',
            background: 'transparent',
            color: color.fgSoft,
            border: `1px solid ${color.line}`,
            borderRadius: 6,
            cursor: 'pointer',
            padding: '0 10px',
            flexShrink: 0,
            fontFamily: font.sans,
            fontSize: text.sm,
            fontWeight: 500,
            transition: `opacity ${motion.fast} ${motion.ease}`,
          }}
        >
          Mark resolved
        </button>
      )}
      <div style={{ gridColumn: '1 / -1' }}>
        <InlineFeedback
          surface="followups"
          referenceId={row.id}
          initialRating={row.feedbackRating}
        />
      </div>
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
        padding: '20px clamp(16px, 4vw, 24px) 28px',
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        boxSizing: 'border-box',
        maxWidth: 880,
        margin: '0 auto',
      }}
    >
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          aria-hidden="true"
          style={{ height: 56, borderTop: `1px solid ${color.line}` }}
        />
      ))}
      <span style={{ position: 'absolute', left: -9999 }}>
        Loading follow-ups from your sent email
      </span>
    </div>
  );
}

function FollowupsErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      style={{
        width: '100%',
        boxSizing: 'border-box',
        maxWidth: 720,
        margin: '0 auto',
        padding: '20px clamp(12px, 4vw, 24px) 28px',
        fontFamily: font.sans,
      }}
    >
      <RecoverableErrorState
        title="We couldn't load your follow-ups"
        description="Your sent email and tracked follow-ups are unchanged. Try again in a moment."
        onRetry={onRetry}
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
