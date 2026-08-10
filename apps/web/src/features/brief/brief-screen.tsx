'use client';

import { useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';

import {
  Avatar,
  Button,
  EmptyState,
  ErrorState as RetryableErrorState,
  Eyebrow,
  ScreenIntro,
  tokens,
  useIsAtMost,
} from '@declutrmail/shared';

import { ApiError } from '@/lib/api/client';
import type {
  BriefItemWire,
  BriefNoiseSenderWire,
  BriefSenderGroupWire,
  BriefWire,
} from '@/lib/api/brief';
import { getActiveMailboxEmail, useOptionalAuth } from '@/features/auth/auth-provider';
import { InlineFeedback } from '@/features/feedback/inline-feedback';
import { GmailOpenLinkService } from '@/lib/gmail/open-link';

import { useBriefToday } from './api/use-brief-today';
import { useMarkBriefOpened } from './api/use-mark-brief-opened';
import {
  blockedReason,
  buildNoiseTargets,
  useNoiseArchive,
  type NoiseTarget,
} from './api/use-noise-archive';
import { NoiseArchiveSheet } from './noise-archive-sheet';
import { track } from '@/lib/posthog';
import { addBreadcrumb, captureFeatureException } from '@/lib/sentry';

const { color, font } = tokens;

/**
 * Daily Brief screen (D61, D63, D67, D69, D70).
 *
 * Layout (D61 + D63):
 *   1. ScreenIntro — "Daily Brief" + the local-date the snapshot covers.
 *   2. Narrative — the D62 "sharp executive assistant" pre-amble.
 *   3. Reply section (max 6 per D63).
 *   4. FYI section (max 4 per D63).
 *   5. Noise section (uncapped) — per-sender checkboxes, default-all
 *      checked, over one bulk Archive (D65). See
 *      `api/use-noise-archive.ts` for the lifecycle and the exact scope
 *      of the mutation.
 *
 * D69 (frozen snapshot): the BE returns one row keyed
 * `(mailbox, run_date_local)` and never recomputes within the day.
 * The FE refetches on focus but `staleTime` is generous; user actions
 * during the day do not change the displayed payload (they show up
 * in Activity, per D69's contract). An archived Noise sender is marked
 * Done in client state — the frozen counts beside it keep describing
 * yesterday, because that is all the snapshot ever claimed.
 *
 * D70 (empty state): when reply + fyi + noise are all empty we render
 * the "quiet inbox" message instead of three empty sections.
 *
 * D61 first-view tracker: on first render of a Brief whose
 * `openedAt === null`, fire `POST /briefs/:id/mark-opened` once. A ref
 * guard prevents StrictMode double-fire + duplicate calls if the cache
 * patches in mid-render.
 *
 * D68 (Free/Plus tier preview): NOT YET WIRED — see FOUNDER-FOLLOWUPS
 * entry "Brief Pro-tier gate". The BE controller does not currently
 * check tier (no users.tier or workspaces.tier column exists at the BE
 * layer), so every authenticated mailbox holder sees the real Brief.
 * The tier-gate lands with the billing slice (D17-D21, D77, D81).
 *
 * D62 (provenance) is rendered as a tiny mono-font marker next to the
 * date — `via template` when the LLM fallback ran, omitted when Haiku
 * succeeded (the "happy path" is silent; we surface the fallback so
 * the user has context for any prose oddities).
 *
 * Privacy (D7, D228): the screen reads only sender identity, subject,
 * Gmail message ids, and the narrative string. The wire shape on
 * `apps/web/src/lib/api/brief.ts` does not declare body, snippet, or
 * non-allowlisted headers — body-adjacent content cannot reach this
 * screen by construction.
 */
export function BriefScreen() {
  const auth = useOptionalAuth();
  const activeMailboxEmail = auth ? getActiveMailboxEmail(auth.me) : null;
  const query = useBriefToday();

  // `mailbox_id: null` keeps the historical event contract. The nullable
  // auth hook above binds Gmail links in production without making isolated
  // stories invent a mailbox; PostHog identity still attaches separately.
  useEffect(() => {
    void track('page_viewed', { page: 'brief', mailbox_id: null });
  }, []);

  if (query.isLoading) return <LoadingState />;

  if (query.isError) {
    // 404 is a designed state, not a real error (D69 worker tick can
    // lag yesterday's wall-clock 8am by up to an hour for some UTC
    // offsets). Branch on `ApiError.status === 404` so we render the
    // "Brief lands soon" message instead of the generic retry CTA.
    if (query.error instanceof ApiError && query.error.status === 404) {
      return <NotYetState onRefresh={() => handleBriefRefresh(query.refetch)} />;
    }
    // Non-404 → log to Sentry as a feature exception so the dashboard
    // separates 'brief failed to load' from 'brief is just late'.
    captureFeatureException(query.error, { surface: 'brief', reason: 'fetch_failed' });
    return (
      <BriefErrorState error={query.error} onRetry={() => handleBriefRefresh(query.refetch)} />
    );
  }

  const brief = query.data;
  if (!brief) {
    // Defensive: success + no data shouldn't happen (envelope contract
    // guarantees data on 2xx), but render the not-yet branch rather
    // than crashing if it does.
    return <NotYetState onRefresh={() => handleBriefRefresh(query.refetch)} />;
  }

  return <BriefBody brief={brief} mailboxEmail={activeMailboxEmail} />;
}

/**
 * Shared refresh handler — instruments PostHog + Sentry on every Brief
 * refresh click, regardless of which CTA path the user takes
 * (NotYetState refresh / ErrorState retry / defensive fallback). The
 * mailbox_id isn't reachable from this leaf component without a
 * provider hop; PostHog `brief_refresh_clicked` ships an empty mailbox
 * string and the FE proxies enrich via PostHog's identifyUser tag.
 */
function handleBriefRefresh(refetch: () => Promise<unknown>): void {
  void track('brief_refresh_clicked', { mailbox_id: '' });
  addBreadcrumb({ category: 'navigation', message: 'brief: refresh clicked', level: 'info' });
  void refetch();
}

/**
 * Renders the loaded Brief. Split out so the mark-opened effect lives
 * alongside a guaranteed-present `brief` payload and the effect's
 * dependency array stays narrow.
 */
function BriefBody({ brief, mailboxEmail }: { brief: BriefWire; mailboxEmail: string | null }) {
  const { reply, fyi, noise, narrative } = brief.briefPayload;
  const isEmpty = reply.length === 0 && fyi.length === 0 && noise.length === 0;

  // Below `sm` (D60 mobile treatment) the multi-column reply/FYI/noise
  // rows overflow a phone viewport — resolve the breakpoint once here
  // and thread it down so each row restacks to a single-column card.
  const isMobile = useIsAtMost('sm');

  // Fire mark-opened exactly once per Brief-id when openedAt is null.
  // Ref guard avoids StrictMode double-mount duplicate calls and
  // covers the post-mutation re-render (the cache patch flips
  // openedAt to non-null and the effect bails on the dependency check).
  const markOpened = useMarkBriefOpened();
  const markedRef = useRef<string | null>(null);
  useEffect(() => {
    if (brief.openedAt !== null) return;
    if (markedRef.current === brief.id) return;
    markedRef.current = brief.id;
    markOpened.mutate(brief.id);
    // `markOpened` intentionally excluded from the dep array — its
    // identity is stable for a given queryClient and including it
    // would re-fire the mutation on every internal state transition
    // (pending/success/idle) the hook walks through.
  }, [brief.id, brief.openedAt, markOpened]);

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
        id="brief"
        title="Daily Brief"
        body={`A short summary of yesterday's mail. Reply first, FYI for context, Noise to clear.`}
        tip="Open a message in Gmail to reply or review it."
      />
      <BriefMeta brief={brief} />
      <BriefReturnLinks />

      {isEmpty ? (
        <QuietInboxState />
      ) : (
        <>
          {narrative.trim().length > 0 && <Narrative text={narrative} />}
          {reply.length > 0 && (
            <ReplyFyiSection
              label="Reply"
              rows={reply}
              max={6}
              isMobile={isMobile}
              mailboxEmail={mailboxEmail}
            />
          )}
          {fyi.length > 0 && (
            <ReplyFyiSection
              label="FYI"
              rows={fyi}
              max={4}
              isMobile={isMobile}
              mailboxEmail={mailboxEmail}
            />
          )}
          {noise.length > 0 && (
            <NoiseSection
              groups={noise}
              noiseSenders={brief.noiseSenders}
              isMobile={isMobile}
              mailboxEmail={mailboxEmail}
            />
          )}
        </>
      )}
      <InlineFeedback surface="brief" referenceId={brief.id} initialRating={brief.feedbackRating} />
    </div>
  );
}

// ── Header meta ───────────────────────────────────────────────────────

/**
 * Sub-line under ScreenIntro showing the date the Brief covers + a
 * provenance marker when the LLM fell back to the template (D62). The
 * happy-path Haiku case is silent — surfacing it would add noise to
 * every Brief.
 */
function BriefMeta({ brief }: { brief: BriefWire }) {
  const dateLabel = formatRunDate(brief.runDateLocal);
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        fontSize: 12,
        color: color.fgMuted,
        fontFamily: font.mono,
      }}
    >
      <span>{dateLabel}</span>
      {brief.generatedBy === 'template' && (
        <>
          <span aria-hidden="true">·</span>
          <span title="A standard summary is shown for this Brief.">Standard summary</span>
        </>
      )}
    </div>
  );
}

/** D69/D245 — make the frozen snapshot useful as a return surface. */
function BriefReturnLinks() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 12,
        flexWrap: 'wrap',
        padding: '10px 12px',
        border: `1px solid ${color.lineSoft}`,
        borderRadius: 9,
        background: color.paper,
        fontSize: 12,
        color: color.fgMuted,
      }}
    >
      <span>This Brief is a morning snapshot. Actions taken afterward appear in Activity.</span>
      <Link
        href="/activity"
        onClick={() =>
          void track('brief_cta_clicked', {
            cta_kind: 'review_session_start',
            target: 'activity',
          })
        }
        style={{ color: color.primary, textDecoration: 'none', whiteSpace: 'nowrap' }}
      >
        See what changed →
      </Link>
    </div>
  );
}

// ── Narrative ─────────────────────────────────────────────────────────

function Narrative({ text }: { text: string }) {
  return (
    <p
      style={{
        margin: 0,
        padding: '14px 16px',
        background: color.card,
        border: `1px solid ${color.lineSoft}`,
        borderRadius: 10,
        fontSize: 14,
        lineHeight: 1.55,
        color: color.fg,
        fontStyle: 'normal',
      }}
    >
      {text}
    </p>
  );
}

// ── Sections ──────────────────────────────────────────────────────────

/**
 * Reply / FYI shared layout. Both render the same row shape — sender,
 * subject and Gmail deep-link. Section caps (D63) are
 * enforced by the BE; `max` here is for the heading label only ("3 of 6").
 */
function ReplyFyiSection({
  label,
  rows,
  max,
  isMobile,
  mailboxEmail,
}: {
  label: 'Reply' | 'FYI';
  rows: BriefItemWire[];
  max: number;
  isMobile: boolean;
  mailboxEmail: string | null;
}) {
  const tone = label === 'Reply' ? 'accent' : 'muted';
  return (
    <section
      aria-label={`${label} (${rows.length})`}
      style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      <SectionHeading label={label} count={rows.length} max={max} tone={tone} />
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
          <ReplyFyiRow
            key={`${row.senderKey}-${row.messageIds[0] ?? row.subject}`}
            row={row}
            isMobile={isMobile}
            mailboxEmail={mailboxEmail}
          />
        ))}
      </ul>
    </section>
  );
}

/**
 * Noise section (D63) with the D65 bulk-archive control.
 *
 * Every sender is a checkbox row, checked by default. Protected senders
 * (D245) and senders we can no longer address render as rows the user
 * can read but not select, each stating why — the exclusion is visible,
 * never a silent omission from the count.
 *
 * The archive itself is the standard lifecycle: the footer button opens
 * the mandatory preview (D226), which is the only thing that can arm the
 * mutation. Undo lives where every other action's undo lives — the
 * global Recent actions tray.
 */
function NoiseSection({
  groups,
  noiseSenders,
  isMobile,
  mailboxEmail,
}: {
  groups: BriefSenderGroupWire[];
  noiseSenders: BriefNoiseSenderWire[];
  isMobile: boolean;
  mailboxEmail: string | null;
}) {
  const totalMessages = useMemo(() => groups.reduce((sum, g) => sum + g.messageCount, 0), [groups]);
  const targets = useMemo(() => buildNoiseTargets(groups, noiseSenders), [groups, noiseSenders]);
  const archive = useNoiseArchive(targets);

  const excludedCount = targets.filter((t) => blockedReason(t) !== null).length;
  const selectedCount = archive.selectedTargets.length;

  return (
    <section
      aria-label={`Noise (${groups.length} senders, ${totalMessages} messages)`}
      style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      <SectionHeading
        label="Noise"
        count={groups.length}
        subline={`${totalMessages} messages yesterday`}
        tone="soft"
      />
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
        {targets.map((target) => (
          <NoiseRow
            key={target.senderKey}
            target={target}
            checked={archive.selected.has(target.senderKey)}
            archived={archive.archivedKeys.has(target.senderKey)}
            busy={archive.busy}
            onToggle={archive.toggle}
            isMobile={isMobile}
            mailboxEmail={mailboxEmail}
            messageIds={groups.find((g) => g.senderKey === target.senderKey)?.messageIds ?? []}
          />
        ))}
      </ul>

      <NoiseArchiveBar
        selectedCount={selectedCount}
        excludedCount={excludedCount}
        busy={archive.busy}
        receipt={archive.receipt}
        onArchive={archive.openSheet}
      />

      <NoiseArchiveSheet
        open={archive.sheetOpen}
        targets={archive.pendingTargets}
        preview={archive.preview}
        {...(mailboxEmail ? { mailboxEmail } : {})}
        onCancel={archive.closeSheet}
        onConfirm={archive.confirm}
        onRetryPreview={archive.retryPreview}
      />
    </section>
  );
}

/**
 * D65's bottom CTA. The button names the SENDER count, which the client
 * knows exactly; the message count is deliberately absent here because
 * the only truthful one — how much is in the inbox right now — comes
 * from the server, and it arrives in the preview one click later. The
 * frozen "N messages yesterday" in the heading above is a different
 * number, and putting it on an archive button would promise a scope the
 * action does not have.
 */
function NoiseArchiveBar({
  selectedCount,
  excludedCount,
  busy,
  receipt,
  onArchive,
}: {
  selectedCount: number;
  excludedCount: number;
  busy: boolean;
  receipt: { senderCount: number; affectedCount: number } | null;
  onArchive: () => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        flexWrap: 'wrap',
        padding: '10px 12px',
        border: `1px solid ${color.lineSoft}`,
        borderRadius: 9,
        background: color.paper,
      }}
    >
      <span style={{ fontSize: 12, color: color.fgMuted, lineHeight: 1.5 }}>
        {receipt ? (
          <>
            Archived {receipt.affectedCount.toLocaleString()} email
            {receipt.affectedCount === 1 ? '' : 's'} from {receipt.senderCount} sender
            {receipt.senderCount === 1 ? '' : 's'}. Undo it from Recent actions at the bottom of the
            screen.
          </>
        ) : (
          <>
            Archives everything from the checked senders that is in your inbox now — you see the
            exact count before anything moves.
            {excludedCount > 0 && (
              <>
                {' '}
                {excludedCount} sender{excludedCount === 1 ? '' : 's'} below cannot be included.
              </>
            )}
          </>
        )}
      </span>
      <Button
        tone="primary"
        disabled={selectedCount === 0 || busy}
        onClick={onArchive}
        aria-label={`Archive ${selectedCount} senders`}
      >
        {busy ? 'Archiving…' : `Archive ${selectedCount} sender${selectedCount === 1 ? '' : 's'}`}
      </Button>
    </div>
  );
}

type SectionTone = 'accent' | 'muted' | 'soft';

function SectionHeading({
  label,
  count,
  max,
  subline,
  tone,
}: {
  label: string;
  count: number;
  max?: number;
  subline?: string;
  tone: SectionTone;
}) {
  const dotColor =
    tone === 'accent' ? color.primary : tone === 'muted' ? color.fgSoft : color.fgMuted;
  const countLabel = max != null ? `${count} of ${max}` : `${count}`;
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
      <span style={{ color: color.fgMuted, fontWeight: 500 }}>· {countLabel}</span>
      {subline && <span style={{ color: color.fgMuted, fontWeight: 500 }}>· {subline}</span>}
    </h2>
  );
}

// ── Rows ──────────────────────────────────────────────────────────────

/**
 * One Reply or FYI row. Avatar → sender name
 * → email domain → subject (truncated) → "Open in Gmail →".
 *
 * D41 deep-link: links to the first message id in the row's group via
 * Gmail's `#all/<id>` permalink. The BE collapses multi-message rows
 * into one BriefItem so this is the most-actionable message.
 */
function ReplyFyiRow({
  row,
  isMobile,
  mailboxEmail,
}: {
  row: BriefItemWire;
  isMobile: boolean;
  mailboxEmail: string | null;
}) {
  const displayName = row.senderName || row.senderEmail;
  const domain = domainOf(row.senderEmail);
  const subject = truncate(row.subject, 70);
  const href = gmailHref(mailboxEmail, row.messageIds[0]);
  return (
    <li
      style={{
        display: 'grid',
        // Mobile (D60): avatar + identity on row 1, subject + Gmail link
        // restack full-width below so the row never overflows a phone.
        gridTemplateColumns: isMobile
          ? 'auto 1fr'
          : 'auto minmax(180px, 1.1fr) minmax(220px, 2fr) auto',
        alignItems: 'center',
        gap: isMobile ? '8px 12px' : 14,
        padding: '12px 14px',
        background: color.card,
        border: `1px solid ${color.lineSoft}`,
        borderRadius: 10,
      }}
    >
      <Avatar size={32} name={displayName} domain={row.senderEmail} />
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 13.5,
            fontWeight: 600,
            color: color.fg,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          <span
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {row.senderName || row.senderEmail}
          </span>
        </div>
        <div style={{ fontSize: 12, color: color.fgMuted, fontFamily: font.mono }}>{domain}</div>
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
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
          ...(isMobile ? { gridColumn: '1 / -1', justifySelf: 'start' } : null),
        }}
      >
        <SenderReviewLink query={row.senderEmail} label={displayName} />
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => {
              void track('brief_cta_clicked', {
                cta_kind: 'open_in_gmail',
                target: 'gmail',
              });
              void track('gmail_deep_link_opened', {
                source: 'activity_row',
                deep_link_kind: 'thread',
              });
              addBreadcrumb({
                category: 'navigation',
                message: 'brief: reply-fyi → gmail',
                level: 'info',
              });
            }}
            style={{
              fontSize: 12.5,
              color: color.primary,
              textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            Open in Gmail →
          </a>
        )}
      </div>
    </li>
  );
}

/** Why a Noise row cannot join the bulk archive, in the user's words. */
const BLOCKED_COPY = {
  protected: 'Protected — kept out of bulk actions',
  unresolved: "We can't act on this sender right now",
} as const;

/**
 * One Noise sender row: checkbox → avatar → sender name → yesterday's
 * count → Gmail deep-link (D65).
 *
 * The checkbox is checked by default (D65) and disabled for a Protected
 * sender or one we cannot address — those rows say why, in place of the
 * checkbox, so a user counting the senders they selected can see exactly
 * which ones the archive will leave alone (D245).
 *
 * An archived row is struck through and marked Done (D69). Its count is
 * NOT recomputed: it still reads as yesterday's, because that is what
 * the frozen snapshot measured.
 */
function NoiseRow({
  target,
  checked,
  archived,
  busy,
  onToggle,
  messageIds,
  isMobile,
  mailboxEmail,
}: {
  target: NoiseTarget;
  checked: boolean;
  archived: boolean;
  busy: boolean;
  onToggle: (senderKey: string) => void;
  messageIds: string[];
  isMobile: boolean;
  mailboxEmail: string | null;
}) {
  const count = target.messageCount;
  const countLabel = `${count} message${count === 1 ? '' : 's'} yesterday`;
  const href = gmailHref(mailboxEmail, messageIds[0]);
  const blocked = blockedReason(target);
  const selectable = blocked === null && !archived;
  return (
    <li
      style={{
        display: 'grid',
        // Mobile (D60): checkbox + avatar + sender on row 1, count +
        // Gmail link restack full-width below.
        gridTemplateColumns: isMobile ? 'auto auto 1fr' : 'auto auto minmax(180px, 2fr) auto auto',
        alignItems: 'center',
        gap: isMobile ? '8px 12px' : 14,
        padding: '12px 14px',
        background: color.card,
        border: `1px solid ${color.lineSoft}`,
        borderRadius: 10,
        opacity: archived ? 0.6 : 1,
      }}
    >
      {selectable ? (
        <input
          type="checkbox"
          checked={checked}
          disabled={busy}
          onChange={() => onToggle(target.senderKey)}
          aria-label={`Include ${target.senderName} in the archive`}
          style={{ width: 16, height: 16, accentColor: color.primary, cursor: 'pointer' }}
        />
      ) : (
        <span
          aria-hidden="true"
          style={{ width: 16, height: 16, display: 'inline-block', textAlign: 'center' }}
        >
          {archived ? '✓' : '—'}
        </span>
      )}
      <Avatar size={32} name={target.senderName || '·'} />
      <div
        style={{
          fontSize: 13.5,
          fontWeight: 600,
          color: color.fg,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          textDecoration: archived ? 'line-through' : 'none',
        }}
      >
        {target.senderName}
      </div>
      <div
        style={{
          fontSize: 12,
          color: color.fgMuted,
          fontFamily: font.mono,
          whiteSpace: 'nowrap',
          ...(isMobile ? { gridColumn: '1 / -1' } : null),
        }}
      >
        {/* The frozen count stays put in every state (D69) — it says
            what yesterday held, which an archive taken today does not
            change. The status that follows it is about now. */}
        {countLabel}
        {archived ? ' · Archived ✓' : blocked ? ` · ${BLOCKED_COPY[blocked]}` : ''}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
          ...(isMobile ? { gridColumn: '1 / -1', justifySelf: 'start' } : null),
        }}
      >
        <SenderReviewLink query={target.senderName} label={target.senderName} />
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => {
              void track('brief_cta_clicked', {
                cta_kind: 'open_in_gmail',
                target: 'gmail',
              });
              void track('gmail_deep_link_opened', {
                source: 'activity_row',
                deep_link_kind: 'thread',
              });
              addBreadcrumb({
                category: 'navigation',
                message: 'brief: noise-row → gmail',
                level: 'info',
                data: { message_count: count },
              });
            }}
            style={{
              fontSize: 12.5,
              color: color.primary,
              textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            Open in Gmail →
          </a>
        )}
      </div>
    </li>
  );
}

function SenderReviewLink({ query, label }: { query: string; label: string }) {
  return (
    <Link
      href={senderSearchHref(query)}
      aria-label={`Review sender ${label}`}
      onClick={() =>
        void track('brief_cta_clicked', {
          cta_kind: 'sender_detail_open',
          target: 'sender_detail',
        })
      }
      style={{ fontSize: 12.5, color: color.primary, textDecoration: 'none', whiteSpace: 'nowrap' }}
    >
      Review sender →
    </Link>
  );
}

// ── Edge states ───────────────────────────────────────────────────────

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
      {[64, 56, 56, 56, 56].map((h, i) => (
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
      <span style={{ position: 'absolute', left: -9999 }}>Loading today&rsquo;s Brief</span>
    </div>
  );
}

function BriefErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const message =
    error instanceof ApiError
      ? "We couldn't load your Brief. Try again in a moment."
      : "We couldn't load your Brief right now. Try again in a moment.";
  return (
    <div style={{ padding: '20px 24px 28px', maxWidth: 720, fontFamily: font.sans }}>
      <RetryableErrorState
        title="We couldn't load your Brief"
        description={message}
        onRetry={onRetry}
      />
    </div>
  );
}

/**
 * 404 branch — the snapshot worker hasn't fired yet for the caller's
 * mailbox. D69's hourly tick means a freshly-connected user (or one
 * in a tail UTC offset relative to UTC midnight) can hit this state
 * briefly. Copy matches D70's calm tone without claiming "no email";
 * we don't know that yet.
 */
function NotYetState({ onRefresh }: { onRefresh: () => void }) {
  return (
    <div style={{ padding: '20px 24px 28px', maxWidth: 720, fontFamily: font.sans }}>
      <Eyebrow>Daily Brief</Eyebrow>
      <EmptyState
        title="Your Brief lands soon"
        description={
          <>
            We snapshot yesterday&rsquo;s mail every morning. If you connected recently or
            you&rsquo;re early in your time zone, refresh in a few minutes.
          </>
        }
        action={
          <Button tone="primary" onClick={onRefresh}>
            Refresh
          </Button>
        }
      />
    </div>
  );
}

/**
 * D70 — "Your inbox was quiet yesterday. Enjoy the morning — we'll be
 * back tomorrow." Verbatim copy from the plan; the Noise section
 * disappears automatically because the BE returns `[]` for it.
 */
function QuietInboxState() {
  return (
    <EmptyState
      title="Your inbox was quiet yesterday."
      description={<>Enjoy the morning — we&rsquo;ll be back tomorrow.</>}
    />
  );
}

// ── Helpers ───────────────────────────────────────────────────────────

/**
 * Format a YYYY-MM-DD run-date into a friendly "Mon, May 28" label.
 * Local-date arithmetic only — no timezone conversion (the BE already
 * resolved the local-date semantic for the user).
 */
export function formatRunDate(runDateLocal: string): string {
  const match = runDateLocal.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return runDateLocal;
  const [, yStr, mStr, dStr] = match;
  // Construct using UTC to skip the locale-dependent timezone shift —
  // we only want the calendar fields, not a moment in time.
  const utc = new Date(Date.UTC(Number(yStr), Number(mStr) - 1, Number(dStr)));
  if (!Number.isFinite(utc.getTime())) return runDateLocal;
  return utc.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** Trailing-ellipsis truncate; collapses trailing whitespace. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

/** First-character domain suffix for the sender's email. */
export function domainOf(email: string): string {
  const at = email.lastIndexOf('@');
  return at === -1 ? email : email.slice(at + 1);
}

/** Gmail "all-mail" deep-link bound to the active account. Missing context -> null. */
export function gmailHref(
  mailboxEmail: string | null,
  messageId: string | undefined,
): string | null {
  if (!mailboxEmail || !messageId) return null;
  return GmailOpenLinkService.buildOpenLink({ mailboxEmail, gmailMessageId: messageId });
}

/** Senders accepts a shareable `q` value; Brief payloads do not carry sender UUIDs. */
export function senderSearchHref(query: string): string {
  return `/senders?q=${encodeURIComponent(query)}`;
}
