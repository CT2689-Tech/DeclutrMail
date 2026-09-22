'use client';

import {
  editorialColumnStyle,
  editorialTitleStyle,
  EditorialKicker,
  EditorialContents,
} from '@/features/editorial/page';

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';

import {
  Avatar,
  Button,
  EmptyState,
  ErrorState as RetryableErrorState,
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

import { shiftLocalDate, useBriefHistory } from './api/use-brief-history';
import { useBriefToday } from './api/use-brief-today';
import { useMarkBriefOpened } from './api/use-mark-brief-opened';
import {
  blockedReason,
  buildNoiseTargets,
  useNoiseArchive,
  type NoiseArchiveOutcome,
  type NoiseTarget,
} from './api/use-noise-archive';
import { flatRowCss } from '@/features/settings/flat-list';
import { SelectWell } from '@/features/settings/settings-list';
import { loadErrorDescription } from '@/lib/load-error-copy';
import { track } from '@/lib/posthog';
import { addBreadcrumb, captureFeatureException } from '@/lib/sentry';

// Opens only from "Archive the noise"; loading it on demand keeps /brief
// inside its first-load bundle budget. It renders nothing while closed.
const NoiseArchiveSheet = dynamic(
  () => import('./noise-archive-sheet').then((m) => m.NoiseArchiveSheet),
  { ssr: false },
);

const { color, font, text } = tokens;

/** One column for every Brief state — header, lists and edge states align. */
const COLUMN = editorialColumnStyle;

const H1_STYLE = editorialTitleStyle;

/**
 * Daily Brief screen (D61, D63, D67, D69, D70).
 *
 * Layout (D61 + D63):
 *   1. One-line header — "Daily Brief" + the local-date the snapshot covers.
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
 * D62 (provenance) is rendered as one muted phrase next to the
 * date — "Standard summary" when the LLM fallback ran, omitted when Haiku
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

  // D61 history. `null` means "showing today"; any other value is a
  // run_date_local the user picked. Held here rather than in BriefBody
  // so switching days does not remount the body and lose the Noise
  // section's Done marks for the day the user came back to.
  const [selectedRunDate, setSelectedRunDate] = useState<string | null>(null);
  const history = useBriefHistory(query.data?.runDateLocal ?? null);

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

  // A selected date that is not in the fetched range falls back to
  // today rather than rendering nothing — the range can legitimately
  // narrow (a mailbox switch resets the scoped cache and refetches).
  const selected =
    selectedRunDate === null
      ? brief
      : (history.data?.find((row) => row.runDateLocal === selectedRunDate) ?? brief);

  return (
    <BriefBody
      brief={selected}
      mailboxEmail={activeMailboxEmail}
      // Only today's Brief is a "first view" worth recording. Marking a
      // three-week-old snapshot opened because someone browsed back to
      // it would make D61's opened_at mean something else entirely.
      isToday={selected.id === brief.id}
      days={history.data ?? []}
      selectedRunDate={selectedRunDate}
      onSelectRunDate={setSelectedRunDate}
    />
  );
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
function BriefBody({
  brief,
  mailboxEmail,
  isToday,
  days,
  selectedRunDate,
  onSelectRunDate,
}: {
  brief: BriefWire;
  mailboxEmail: string | null;
  /** False while a past Brief is being read — suppresses mark-opened. */
  isToday: boolean;
  /** Past Briefs available to switch to (D61 history). */
  days: readonly BriefWire[];
  selectedRunDate: string | null;
  onSelectRunDate: (runDate: string | null) => void;
}) {
  const { reply, fyi, noise, narrative, replyTotal, fyiTotal } = brief.briefPayload;
  const dateLabel = formatRunDate(coveredDateOf(brief.runDateLocal));
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
    if (!isToday) return;
    if (brief.openedAt !== null) return;
    if (markedRef.current === brief.id) return;
    markedRef.current = brief.id;
    markOpened.mutate(brief.id);
    // `markOpened` intentionally excluded from the dep array — its
    // identity is stable for a given queryClient and including it
    // would re-fire the mutation on every internal state transition
    // (pending/success/idle) the hook walks through.
  }, [brief.id, brief.openedAt, isToday, markOpened]);

  return (
    <div style={{ ...COLUMN, display: 'flex', flexDirection: 'column', gap: 24 }}>
      <EditorialKicker>Catch up / Your daily edition</EditorialKicker>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <h1 style={H1_STYLE}>Daily Brief</h1>
        <BriefMeta
          brief={brief}
          days={days}
          selectedRunDate={selectedRunDate}
          onSelectRunDate={onSelectRunDate}
        />
      </div>
      <ScreenIntro
        id="brief"
        title="Daily Brief"
        body={
          // "Yesterday" is only true of the latest Brief. Once the day
          // switcher reaches back, the same sentence over Saturday's
          // mail is simply wrong, so past days name the day instead.
          isToday
            ? `Yesterday's email in three lists: Reply first, FYI for context, Noise to clear.`
            : `Email from ${dateLabel} in three lists: Reply first, FYI for context, Noise to clear.`
        }
      />
      <BriefReturnLinks />

      {isEmpty ? (
        <QuietInboxState />
      ) : (
        <>
          {narrative.trim().length > 0 && <Narrative narrative={narrative} />}
          <EditorialContents
            label="Brief sections"
            items={[
              ...(reply.length
                ? [{ href: '#brief-reply', label: `Reply · ${replyTotal ?? reply.length}` }]
                : []),
              ...(fyi.length
                ? [{ href: '#brief-fyi', label: `FYI · ${fyiTotal ?? fyi.length}` }]
                : []),
              ...(noise.length
                ? [{ href: '#brief-noise', label: `Noise · ${noise.length} senders` }]
                : []),
            ]}
          />
          {reply.length > 0 && (
            <ReplyFyiSection
              label="Reply"
              rows={reply}
              total={replyTotal}
              isMobile={isMobile}
              mailboxEmail={mailboxEmail}
            />
          )}
          {fyi.length > 0 && (
            <ReplyFyiSection
              label="FYI"
              rows={fyi}
              total={fyiTotal}
              isMobile={isMobile}
              mailboxEmail={mailboxEmail}
            />
          )}
          {noise.length > 0 && (
            // Keyed on the Brief id so a mailbox SWITCH remounts the
            // section and drops its selection, its Done marks and its
            // receipt. Sender keys are a hash of the email address and
            // are therefore identical across mailboxes — without this,
            // archiving Old Navy in one mailbox would draw "Archived ✓"
            // on Old Navy in the other one's Brief (§8 scope-change rule).
            <NoiseSection
              key={brief.id}
              groups={noise}
              noiseSenders={brief.noiseSenders}
              isMobile={isMobile}
              mailboxEmail={mailboxEmail}
              dayWord={isToday ? 'yesterday' : `on ${dateLabel}`}
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
 * Right side of the header: the date the Brief covers + a
 * provenance marker when the LLM fell back to the template (D62). The
 * happy-path Haiku case is silent — surfacing it would add noise to
 * every Brief.
 */
function BriefMeta({
  brief,
  days,
  selectedRunDate,
  onSelectRunDate,
}: {
  brief: BriefWire;
  days: readonly BriefWire[];
  selectedRunDate: string | null;
  onSelectRunDate: (runDate: string | null) => void;
}) {
  const dateLabel = formatRunDate(coveredDateOf(brief.runDateLocal));
  // Offer the switcher only when there is somewhere else to go. One
  // Brief in the range means the control would be a dropdown with a
  // single option — chrome that does nothing.
  const hasHistory = days.length > 1;
  const selectedDayValue =
    selectedRunDate !== null && days.slice(1).some((row) => row.runDateLocal === selectedRunDate)
      ? selectedRunDate
      : '';
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        fontSize: text.sm,
        color: color.fgMuted,
      }}
    >
      {hasHistory ? (
        <SelectWell
          // Fall back to the latest option when the selected day is not
          // among the past ones — the range can narrow (a mailbox switch
          // resets the scoped cache and refetches), and a <select> whose
          // value matches no option renders the first one while state
          // says otherwise. The body already falls back the same way.
          //
          // `slice(1)` because the newest day is rendered with value ''
          // (it is the "latest" option), so matching it by date would
          // set a value no option carries — the same bug in reverse.
          value={selectedDayValue}
          onChange={(e) => onSelectRunDate(e.target.value === '' ? null : e.target.value)}
          aria-label="Brief day"
          style={{ fontSize: text.sm, height: 32 }}
        >
          {days.map((row, i) => (
            <option key={row.id} value={i === 0 ? '' : row.runDateLocal}>
              {formatRunDate(coveredDateOf(row.runDateLocal))}
              {i === 0 ? ' — latest' : ''}
            </option>
          ))}
        </SelectWell>
      ) : (
        <span>{dateLabel}</span>
      )}
      {brief.generatedBy === 'template' && (
        <>
          <span aria-hidden="true">·</span>
          <span>Standard summary</span>
        </>
      )}
    </div>
  );
}

/** D69/D245 — make the frozen snapshot useful as a return surface. */
function BriefReturnLinks() {
  return (
    <p style={{ margin: 0, fontSize: text.sm, color: color.fgMuted }}>
      Prepared in the morning.{' '}
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
        See what changed
      </Link>
    </p>
  );
}

// ── Narrative ─────────────────────────────────────────────────────────

function Narrative({ narrative }: { narrative: string }) {
  return (
    <p
      style={{
        margin: 0,
        fontFamily: font.display,
        fontSize: 'clamp(21px, 2.2vw, 27px)',
        padding: '18px 0 22px',
        borderBottom: `1px solid ${color.line}`,
        letterSpacing: '-0.015em',
        lineHeight: 1.55,
        color: color.fg,
        // Cap the reading measure at the ~65-75 characters the eye
        // tracks comfortably, so the narrative doesn't read as a wall
        // above the lists.
        maxWidth: '68ch',
      }}
    >
      {narrative}
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
  total,
  isMobile,
  mailboxEmail,
}: {
  label: 'Reply' | 'FYI';
  rows: BriefItemWire[];
  /** Pre-cap candidate count from the payload; undefined on older rows. */
  total?: number | undefined;
  isMobile: boolean;
  mailboxEmail: string | null;
}) {
  return (
    <section
      id={`brief-${label.toLowerCase()}`}
      aria-label={`${label} (${rows.length})`}
      style={{ display: 'flex', flexDirection: 'column', gap: 8, scrollMarginTop: 24 }}
    >
      <style>{flatRowCss('dm-brief-row', 70)}</style>
      <SectionHeading label={label} count={rows.length} total={total} />
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
  dayWord,
}: {
  groups: BriefSenderGroupWire[];
  noiseSenders: BriefNoiseSenderWire[];
  isMobile: boolean;
  mailboxEmail: string | null;
  /**
   * How to name the day these counts describe — "yesterday" on the
   * latest Brief, the covered date once the day switcher reaches back.
   * The counts are frozen (D69); only the word that anchors them moves.
   */
  dayWord: string;
}) {
  const totalMessages = useMemo(() => groups.reduce((sum, g) => sum + g.messageCount, 0), [groups]);
  const targets = useMemo(() => buildNoiseTargets(groups, noiseSenders), [groups, noiseSenders]);
  const archive = useNoiseArchive(targets);

  const excludedCount = targets.filter((t) => blockedReason(t) !== null).length;
  const selectedCount = archive.selectedTargets.length;

  return (
    <section
      id="brief-noise"
      // Carries the same "yesterday" anchor the visible subline does — a
      // screen reader must not get the un-anchored number this whole
      // surface is careful to avoid.
      aria-label={`Noise (${groups.length} senders, ${totalMessages} messages ${dayWord})`}
      style={{ display: 'flex', flexDirection: 'column', gap: 8, scrollMarginTop: 24 }}
    >
      <style>{flatRowCss('dm-noise-row', 12)}</style>
      <SectionHeading
        label="Noise"
        count={groups.length}
        subline={`${totalMessages} messages ${dayWord}`}
      />
      <ul
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
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
        outcome={archive.outcome}
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
export function NoiseArchiveBar({
  selectedCount,
  excludedCount,
  busy,
  outcome,
  onArchive,
}: {
  selectedCount: number;
  excludedCount: number;
  busy: boolean;
  outcome: NoiseArchiveOutcome | null;
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
        padding: '16px 0 0',
        borderTop: `1px solid ${color.lineSoft}`,
      }}
    >
      {/* Every terminal state gets a PERSISTENT line here. A toast is
          gone in 3.6s, and a bar that reverts to its neutral invite
          re-arms senders that already archived. */}
      <span
        role={outcome ? 'status' : undefined}
        style={{ fontSize: text.sm, color: color.fgMuted, lineHeight: 1.5 }}
      >
        {outcome ? (
          <NoiseOutcomeLine outcome={outcome} />
        ) : selectedCount === 0 ? (
          <>
            Check a sender to archive it.
            {excludedCount > 0 && (
              <>
                {' '}
                {excludedCount} sender{excludedCount === 1 ? '' : 's'} below cannot be included.
              </>
            )}
          </>
        ) : (
          excludedCount > 0 && (
            <>
              {excludedCount} sender{excludedCount === 1 ? '' : 's'} below cannot be included.
            </>
          )
        )}
      </span>
      {/* No aria-label: the visible label already names the count, and a
          second wording would give screen readers a different sentence
          than the one on screen. */}
      <Button tone="primary" disabled={selectedCount === 0 || busy} onClick={onArchive}>
        {busy ? 'Archiving…' : `Archive ${selectedCount} sender${selectedCount === 1 ? '' : 's'}`}
      </Button>
    </div>
  );
}

/**
 * The persistent outcome line. Each branch states only what the server
 * confirmed: what moved, what did not, and where to look. The undo
 * sentence appears only while undo is genuinely available — D211 lists
 * "Undo expired" as its own state, and a receipt that promises undo
 * forever is a claim the Activity window has already retired.
 */
function NoiseOutcomeLine({ outcome }: { outcome: NoiseArchiveOutcome }) {
  switch (outcome.kind) {
    case 'archived': {
      const { affectedCount, senderCount, undo } = outcome;
      return (
        <>
          Archived {affectedCount.toLocaleString('en-US')} email{affectedCount === 1 ? '' : 's'}{' '}
          from {senderCount} sender{senderCount === 1 ? '' : 's'}.
          {undo === 'available' && ' Undo it from Recent actions at the bottom of the screen.'}
          {undo === 'expired' && ' The undo window for this archive has passed.'}
        </>
      );
    }
    case 'reverted':
      return (
        <>
          That archive was undone — mail from {outcome.senderCount} sender
          {outcome.senderCount === 1 ? '' : 's'} is back in your inbox.
        </>
      );
    case 'partial':
      return (
        <>
          {outcome.doneCount} of {outcome.total} senders were archived; {outcome.failedCount} did
          not complete. Check Activity to see which moved, then re-check any that didn&rsquo;t.
        </>
      );
    case 'failed':
      return <>Nothing was archived. The senders are still checked, so you can try again.</>;
    case 'unconfirmed':
      return (
        <>
          We couldn&rsquo;t confirm what that archive did. Check Activity before running it again.
        </>
      );
  }
}

function SectionHeading({
  label,
  count,
  total,
  subline,
}: {
  label: string;
  count: number;
  /**
   * How many items existed before the D63 cap. Undefined on Briefs
   * frozen before the worker recorded it (D69).
   */
  total?: number | undefined;
  subline?: string;
}) {
  // "of N" only when N says something the count does not. This used to
  // read `${count} of ${max}` against the hardcoded cap, so a full
  // section always announced "6 of 6" — a constant dressed as a fact
  // about the day, and silent about the items the cap actually dropped.
  const truncated = total != null && total > count;
  const countLabel = truncated ? `${count} of ${total}` : `${count}`;
  return (
    <h2
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 6,
        margin: 0,
        fontFamily: font.display,
        fontSize: text['2xl'],
        fontWeight: 400,
        letterSpacing: '-0.01em',
        color: color.fg,
      }}
    >
      {label}
      <span
        style={{
          color: color.fgMuted,
          fontSize: text.md,
          fontWeight: 500,
          letterSpacing: 0,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        · {countLabel}
      </span>
      {subline && (
        <span
          style={{
            color: color.fgMuted,
            fontSize: text.md,
            fontWeight: 500,
            letterSpacing: 0,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          · {subline}
        </span>
      )}
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
        minHeight: 72,
        boxSizing: 'border-box',
        paddingTop: 12,
        paddingBottom: 12,
      }}
      className="dm-brief-row"
    >
      <Avatar size={44} name={displayName} domain={row.senderEmail} />
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: text.md,
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
        <div style={{ fontSize: text.sm, color: color.fgMuted, marginTop: 2 }}>{domain}</div>
      </div>
      <div
        title={row.subject}
        style={{
          fontSize: text.md,
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
              fontSize: text.sm,
              color: color.primary,
              textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            Open in Gmail
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
        minHeight: 72,
        boxSizing: 'border-box',
        paddingTop: 12,
        paddingBottom: 12,
        opacity: archived ? 0.6 : 1,
      }}
      className="dm-noise-row"
    >
      {selectable ? (
        <input
          type="checkbox"
          checked={checked}
          disabled={busy}
          onChange={() => onToggle(target.senderKey)}
          aria-label={`Include ${target.senderName} in the archive`}
          style={{
            width: 18,
            height: 18,
            margin: 0,
            accentColor: color.primary,
            cursor: 'pointer',
          }}
        />
      ) : (
        <span
          aria-hidden="true"
          style={{
            width: 18,
            height: 18,
            display: 'inline-block',
            textAlign: 'center',
            color: color.fgMuted,
          }}
        >
          {archived ? '✓' : '—'}
        </span>
      )}
      <Avatar size={44} name={target.senderName || '·'} />
      <div
        style={{
          fontSize: text.md,
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
          fontSize: text.sm,
          color: color.fgMuted,
          fontVariantNumeric: 'tabular-nums',
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
              fontSize: text.sm,
              color: color.primary,
              textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            Open in Gmail
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
      style={{
        fontSize: text.sm,
        color: color.primary,
        textDecoration: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      Review sender
    </Link>
  );
}

// ── Edge states ───────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{ ...COLUMN, display: 'flex', flexDirection: 'column', gap: 24 }}
    >
      <EditorialKicker>Catch up / Your daily edition</EditorialKicker>
      <h1 style={H1_STYLE}>Daily Brief</h1>
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          aria-hidden="true"
          style={{ height: 72, borderTop: `1px solid ${color.lineSoft}` }}
        />
      ))}
      <span style={{ position: 'absolute', left: -9999 }}>Loading today&rsquo;s Brief</span>
    </div>
  );
}

function BriefErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div style={{ ...COLUMN, display: 'flex', flexDirection: 'column', gap: 24 }}>
      <EditorialKicker>Catch up / Your daily edition</EditorialKicker>
      <h1 style={H1_STYLE}>Daily Brief</h1>
      <RetryableErrorState
        title="We couldn't load your Brief"
        description={loadErrorDescription(error)}
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
    <div style={{ ...COLUMN, display: 'flex', flexDirection: 'column', gap: 24 }}>
      <EditorialKicker>Catch up / Your daily edition</EditorialKicker>
      <h1 style={H1_STYLE}>Daily Brief</h1>
      <EmptyState
        title="Your Brief is not available yet"
        description="Briefs summarize the previous day’s email after your inbox has been scanned. There is no edition available for this inbox yet. You can review senders while you wait."
        action={
          <Button tone="primary" onClick={onRefresh}>
            Refresh
          </Button>
        }
      />
      <EditorialContents
        label="While you wait"
        items={[
          { href: '/senders', label: 'Review senders' },
          { href: '/settings#notifications', label: 'Brief delivery settings' },
        ]}
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
/**
 * The local calendar date a Brief actually covers.
 *
 * `run_date_local` is the date the snapshot was GENERATED; the worker
 * reads the window `[previousDayStart, todayStart)`, so the mail in it
 * is always the day before. Rendering `run_date_local` therefore dated
 * every Brief one day late, every day — a Brief generated Aug 26 is
 * headed "Aug 26" over Aug 25's mail.
 *
 * Arithmetic in UTC on the calendar fields only: the string is already
 * a resolved local date, so converting it through a real timezone would
 * reintroduce the shift this is correcting.
 */
export function coveredDateOf(runDateLocal: string): string {
  return shiftLocalDate(runDateLocal, -1);
}

export function formatRunDate(runDateLocal: string): string {
  const match = runDateLocal.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return runDateLocal;
  const [, yStr, mStr, dStr] = match;
  // Construct using UTC to skip the locale-dependent timezone shift —
  // we only want the calendar fields, not a moment in time.
  const utc = new Date(Date.UTC(Number(yStr), Number(mStr) - 1, Number(dStr)));
  if (!Number.isFinite(utc.getTime())) return runDateLocal;
  // Locale pinned: this label is server-rendered into hydrated HTML, so
  // a runtime-default locale mismatches on any non-en-US browser and
  // React discards the server tree (error #418; e2e hydration-smoke).
  return utc.toLocaleDateString('en-US', {
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
