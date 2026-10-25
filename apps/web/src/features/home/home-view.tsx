'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Avatar, ErrorState } from '@declutrmail/shared';
import type { CleanupSummaryDto, SnoozedSenderRow } from '@declutrmail/shared/contracts';
import { hasCapability, type TierId } from '@declutrmail/shared/entitlements';
import {
  formatReportSize,
  reportHeadline,
  reportWindow,
  type InboxReportDto,
} from '@declutrmail/shared/inbox-report';
import { QuotaChipSlot } from '@/features/shell/quota-chip-slot';
import { loadErrorDescription } from '@/lib/load-error-copy';
import { track } from '@/lib/posthog';
import { HOME_DECK } from './home-deck-copy';
import { HomeLoadingSlots } from './home-loading-shell';
import type { HomePreviewReport } from './home-preview-report';
import { HomeFixDialog } from './home-fix-dialog';
import { HomeScanFailedCopy, HomeScanRecovery } from './home-scan-recovery';
import { homeV1Mode, rankHomeNextSteps, type HomeFixCandidate } from './home-next-steps';
import { SYNC_FAILED_ACTION, type HomeAction, type HomeState } from './home-state';
import type { HomePriority } from './home-orientation';
import type { HomeOverview, HomeRead } from './api/use-home-overview';
import type { HomeSummary } from './api/use-home-summary';
import styles from './home-view.module.css';

export interface HomeViewProps {
  state: HomeState;
  tier?: TierId;
  visitSummary?: ReactNode;
  statusLine?: string;
  priority?: HomePriority | null;
  noSuggestions?: boolean;
  summary?: CleanupSummaryDto | null;
  nextSteps?: readonly HomeFixCandidate[];
  senderSizeView?: boolean;
  reportSizeLabel?: string | null;
  indexedEmailCount?: number | null;
  mailboxId?: string;
  mailboxEmail?: string | null;
  previewReport?: HomePreviewReport | null;
  reportLead?: string | null;
  supportText?: string | null;
  onConfirmFix?: (step: HomeFixCandidate) => void;
  overview?: HomeOverview | undefined;
  report?: InboxReportDto | null;
  reportStatus?: 'loading' | 'ready' | 'error';
  newSenders?: HomeRead<number>;
  later?: HomeRead<{ due: number; troubled: number; nextAt: string | null }>;
  timeZone?: string;
  onRefresh?: () => void;
}

/** An action-led overview. Each section keeps its own unknown/error state. */
export function HomeView({
  state,
  tier = 'free',
  visitSummary,
  statusLine,
  priority = null,
  noSuggestions = false,
  summary = null,
  nextSteps = [],
  senderSizeView = false,
  mailboxId = '',
  mailboxEmail = null,
  previewReport = null,
  reportLead = null,
  supportText = null,
  onConfirmFix,
  overview,
  report = null,
  reportStatus = 'ready',
  newSenders,
  later,
  timeZone = 'UTC',
  onRefresh,
}: HomeViewProps) {
  const steps = rankHomeNextSteps(nextSteps, { senderSizeView });
  const primary = steps.find((step) => step.kind === 'unsub_archive');
  const mode = homeV1Mode(state.kind, steps.length);
  const [pendingFix, setPendingFix] = useState<HomeFixCandidate | null>(null);
  const [period, setPeriod] = useState<'7d' | 'all'>(overview ? '7d' : 'all');
  const labelId = useId();
  const caughtUp = useRef(false);
  const reviewOnly = priority?.action?.href === '/senders?view=first-review';
  const scanning = state.kind === 'empty' && state.syncing;
  const urgent = reviewOnly || (scanning && !priority?.action) ? null : priority;
  const canPreview =
    !!primary &&
    primary.senderIds.length > 0 &&
    typeof primary.emailCount === 'number' &&
    Number.isFinite(primary.emailCount) &&
    primary.emailCount > 0 &&
    !urgent &&
    !scanning;
  useEffect(() => {
    if (mode === 'fallback' && !caughtUp.current) {
      caughtUp.current = true;
      void track('caught_up_viewed', { surface: 'home' });
    }
  }, [mode]);
  function openPreview(step: HomeFixCandidate) {
    void track('home_next_step_clicked', { kind: 'unsubscribe_archive' });
    setPendingFix(step);
  }
  return (
    <div
      className={styles.page}
      data-home-mode={mode}
      data-home-priority={canPreview ? 'review' : 'intro'}
      data-home-fix-expected={canPreview ? 'true' : 'false'}
      data-sender-size-view={senderSizeView ? 'on' : 'off'}
    >
      <header className={styles.header}>
        <div>
          <h1>Home</h1>
          {mailboxEmail && <p className={styles.mailboxIdentity}>{mailboxEmail}</p>}
        </div>
        <div className={styles.planLine} data-home-slot="quota">
          <QuotaChipSlot summary={summary} />
        </div>
      </header>
      {statusLine && (
        <p className={styles.statusLine} role="status">
          {statusLine}
        </p>
      )}
      {state.kind === 'loading' ? (
        <HomeLoadingSlots labelId={labelId} />
      ) : state.kind === 'sync-failed' ? (
        <section className={styles.primaryCard} aria-label="Mailbox needs attention">
          <h2>{HOME_DECK.failedTitle}</h2>
          {state.mailboxId ? (
            <HomeScanRecovery mailboxId={state.mailboxId} needsReconnect={state.needsReconnect} />
          ) : state.needsReconnect ? (
            <>
              <p>Reconnect it in Settings → Gmail accounts.</p>
              <PrimaryLink action={SYNC_FAILED_ACTION} />
            </>
          ) : (
            <HomeScanFailedCopy />
          )}
        </section>
      ) : (
        <>
          <div className={styles.visitSlot} data-home-slot="visit">
            {visitSummary}
          </div>
          <div className={styles.overviewGrid}>
            <section
              className={styles.primaryCard}
              aria-label="Suggested next steps"
              data-home-slot="primary"
            >
              {urgent ? (
                <>
                  <h2>{urgent.title}</h2>
                  {urgent.body && <p>{urgent.body}</p>}
                  {urgent.action && <PrimaryLink action={urgent.action} />}
                </>
              ) : scanning ? (
                <>
                  <h2>{state.queued ? HOME_DECK.queuedTitle : HOME_DECK.syncingTitle}</h2>
                  <p>
                    {state.queued
                      ? HOME_DECK.queuedBody
                      : (state.stageSentence ?? HOME_DECK.syncingBody)}
                  </p>
                </>
              ) : primary ? (
                <>
                  <p className={styles.sectionLabel}>Suggested cleanup</p>
                  <h2>
                    Start with {format(primary.senderCount)}{' '}
                    {primary.senderCount === 1 ? 'sender' : 'senders'}.
                  </h2>
                  {typeof primary.emailCount === 'number' &&
                    Number.isFinite(primary.emailCount) &&
                    primary.emailCount > 0 && (
                      <p className={styles.impact} data-home-impact="">
                        <strong>
                          {format(primary.emailCount)}{' '}
                          {primary.emailCount === 1 ? 'email' : 'emails'} in your Inbox.
                        </strong>{' '}
                        Review Unsubscribe + Archive.
                      </p>
                    )}
                  <SenderRows step={primary} />
                  {canPreview ? (
                    <PreviewButton onClick={() => openPreview(primary)} />
                  ) : (
                    <PrimaryLink action={{ label: 'Review senders', href: '/senders' }} />
                  )}
                  <p className={styles.footnote}>Review the exact scope before confirming.</p>
                  {report && report.fix.sendersCount > primary.senderCount && (
                    <Link href="/senders#inbox-report" className={styles.textLink}>
                      View {format(report.fix.sendersCount)} suggested senders
                    </Link>
                  )}
                </>
              ) : (
                <>
                  <p className={styles.sectionLabel}>Suggested cleanup</p>
                  <h2>
                    {reportStatus === 'loading'
                      ? 'Finding a place to start…'
                      : reportStatus === 'error'
                        ? 'Cleanup suggestions unavailable.'
                        : noSuggestions && state.kind !== 'empty'
                          ? 'No suggested cleanup right now.'
                          : state.kind === 'empty'
                            ? 'Start your first cleanup.'
                            : 'Explore your senders.'}
                  </h2>
                  <p>Explore your senders and decide what still belongs.</p>
                  <PrimaryLink action={{ label: 'Review senders', href: '/senders' }} />
                  {reportStatus === 'error' && onRefresh && (
                    <button className={styles.textButton} onClick={onRefresh}>
                      Try again
                    </button>
                  )}
                </>
              )}
            </section>
            <section className={styles.attention} aria-label="Needs your attention">
              <h2>Needs your attention</h2>
              {hasCapability(tier, 'screener') && (
                <Attention
                  href="/senders?view=first-review"
                  title="New senders"
                  detail="Awaiting a first decision"
                  read={newSenders}
                />
              )}
              {hasCapability(tier, 'snoozed') && (
                <Attention
                  href="/later"
                  title="Later"
                  detail={
                    later?.data?.troubled
                      ? `${format(later.data.troubled)} returns need attention`
                      : later?.data?.nextAt
                        ? `Next return ${date(later.data.nextAt, timeZone)}`
                        : 'Sender returns due'
                  }
                  read={
                    later
                      ? { status: later.status, data: later.data?.due ?? null }
                      : steps.some((step) => step.kind === 'later_due')
                        ? {
                            status: 'ready',
                            data: steps.find((step) => step.kind === 'later_due')!.senderCount,
                          }
                        : undefined
                  }
                />
              )}
              {overview && hasCapability(tier, 'followups') && (
                <Attention
                  href="/followups"
                  title="Follow-ups"
                  detail="Conversations awaiting a reply"
                  read={overview.followups}
                />
              )}
              {overview &&
                hasCapability(tier, 'brief') &&
                overview.brief.data &&
                !overview.brief.data.opened && (
                  <Link className={styles.briefLink} href="/brief">
                    Your Daily Brief is ready
                  </Link>
                )}
              {overview && hasCapability(tier, 'autopilot') && (
                <div className={styles.automation}>
                  <h3>Automations</h3>
                  {overview.rules.data ? (
                    <p>
                      {format(overview.rules.data.active)} active ·{' '}
                      {format(overview.rules.data.watching)} watching ·{' '}
                      {format(overview.rules.data.paused)} paused
                    </p>
                  ) : (
                    <p>{readLabel(overview.rules)}</p>
                  )}
                  <p>
                    {overview.suggestions.data === null
                      ? readLabel(overview.suggestions)
                      : `${format(overview.suggestions.data)} preset suggestions awaiting approval`}
                  </p>
                  <Link href="/autopilot" className={styles.textLink}>
                    Review automations
                  </Link>
                </div>
              )}
            </section>
          </div>
          <div className={styles.lowerGrid}>
            <section className={styles.results} aria-label="Your results" data-home-slot="progress">
              <div className={styles.sectionHeading}>
                <h2>Your results</h2>
                {overview && (
                  <div className={styles.periods} role="group" aria-label="Results period">
                    <button aria-pressed={period === '7d'} onClick={() => setPeriod('7d')}>
                      Past 7 days
                    </button>
                    <button aria-pressed={period === 'all'} onClick={() => setPeriod('all')}>
                      All time
                    </button>
                  </div>
                )}
              </div>
              {state.kind === 'error' ? (
                <ErrorState
                  headingLevel={3}
                  title="We couldn’t load Home results"
                  description={loadErrorDescription(state.error)}
                  onRetry={() => {
                    state.retry();
                    onRefresh?.();
                  }}
                />
              ) : period === '7d' && overview && state.kind !== 'empty' ? (
                <SummaryNumbers summary={overview.week} />
              ) : state.kind === 'ready' ? (
                <>
                  <p className={styles.progressSentence}>
                    <strong data-testid="home-hero">{format(state.hero.value)}</strong>{' '}
                    {state.hero.label}
                    <span className={styles.period}>All time</span>
                  </p>
                  <dl className={styles.progressDetails}>
                    {state.secondary.map((stat) => (
                      <div key={stat.label}>
                        <dt>{stat.label}</dt>
                        <dd>{format(stat.value)}</dd>
                      </div>
                    ))}
                  </dl>
                </>
              ) : (
                <p className={styles.muted}>Your confirmed cleanup results will appear here.</p>
              )}
              {overview?.recent.data && (
                <div className={styles.receipt}>
                  <h3>Recent completed cleanup</h3>
                  <p>
                    {format(overview.recent.data.affectedCount)} emails{' '}
                    {overview.recent.data.action === 'archive' ? 'archived' : 'moved to Trash'}
                  </p>
                  <p className={styles.footnote}>
                    {date(overview.recent.data.occurredAt, timeZone)}
                  </p>
                </div>
              )}
              <Link href={`/activity?window=${period}`} className={styles.textLink}>
                See your activity & Undo
              </Link>
              <p className={styles.footnote}>Archive + Delete outcomes. Undone actions excluded.</p>
            </section>
            <section
              className={styles.insights}
              aria-label="Your Inbox Report"
              data-home-slot="report"
            >
              <h2>Worth a look</h2>
              {report?.insights.length ? (
                report.insights.slice(0, 2).map((insight) => (
                  <div className={styles.insight} key={insight.id}>
                    <h3>{insightTitle(insight.id)}</h3>
                    <p>{reportHeadline(insight).sentence}</p>
                    <small>{reportWindow(insight)}</small>
                  </div>
                ))
              ) : previewReport?.headline || reportLead ? (
                <div className={styles.insight}>
                  <p>{previewReport?.headline ?? reportLead}</p>
                  {supportText && <p className={styles.footnote}>{supportText}</p>}
                </div>
              ) : (
                <p className={styles.muted}>
                  {reportStatus === 'error'
                    ? 'Inbox Report unavailable.'
                    : reportStatus === 'loading'
                      ? 'Loading mailbox insights…'
                      : 'Open your report to explore the scanned mail.'}
                </p>
              )}
              <Link href="/senders#inbox-report" className={styles.textLink}>
                Open Inbox Report
              </Link>
            </section>
          </div>
          {overview && (
            <section className={styles.snapshot} aria-label="Mailbox snapshot">
              {overview.snapshot.data ? (
                <>
                  <div>
                    <strong>{format(overview.snapshot.data.inboxCount)}</strong>
                    <span>Scanned Inbox emails</span>
                    <small>{format(overview.snapshot.data.unreadInboxCount)} unread</small>
                  </div>
                  <div>
                    <strong>{format(overview.snapshot.data.receivedCount)}</strong>
                    <span>Scanned received emails</span>
                    <small>Including archived and Trash</small>
                  </div>
                  <div>
                    <strong>
                      {overview.snapshot.data.totalBytes === null
                        ? 'Unavailable'
                        : `≈${formatReportSize(overview.snapshot.data.totalBytes)}`}
                    </strong>
                    <span>Scanned mail estimate</span>
                    <small>
                      {overview.snapshot.data.sizeKnownCount < overview.snapshot.data.receivedCount
                        ? 'Size estimates are incomplete'
                        : 'Based on Gmail size estimates'}
                    </small>
                  </div>
                  <p className={styles.snapshotNote}>
                    Scanned inbound metadata · Updated {date(overview.snapshot.data.asOf, timeZone)}
                    <br />
                    Gmail storage quota is separate.
                  </p>
                </>
              ) : (
                <p className={styles.muted}>
                  {readLabel(overview.snapshot)}
                  {onRefresh && overview.snapshot.status === 'error' && (
                    <button className={styles.textButton} onClick={onRefresh}>
                      Try again
                    </button>
                  )}
                </p>
              )}
            </section>
          )}
        </>
      )}
      {pendingFix && (
        <HomeFixDialog
          step={pendingFix}
          mailboxId={previewReport === null ? mailboxId || undefined : undefined}
          onCancel={() => setPendingFix(null)}
          onConfirm={(step) => {
            setPendingFix(null);
            onConfirmFix?.(step);
          }}
        />
      )}
    </div>
  );
}

function SenderRows({ step }: { step: HomeFixCandidate }) {
  return step.senders?.length ? (
    <ul className={styles.senderPreview} aria-label="Some senders to review">
      {step.senders
        .filter((sender) => step.senderIds.includes(sender.id))
        .slice(0, 3)
        .map((sender) => (
          <li key={sender.id}>
            <Avatar
              name={sender.name}
              domain={sender.domain}
              hasMark={sender.brandMark === true}
              size={32}
            />
            <Link
              href={`/senders?sender=${encodeURIComponent(sender.id)}`}
              className={styles.senderIdentity}
            >
              <strong>{sender.name}</strong>
              <small>
                {typeof sender.readRate === 'number'
                  ? `${Math.round(sender.readRate * 100)}% marked read · 90 days`
                  : sender.domain}
              </small>
            </Link>
            {typeof sender.inboxCount === 'number' && (
              <span className={styles.senderCount}>
                {format(sender.inboxCount)}
                <small>in Inbox</small>
              </span>
            )}
          </li>
        ))}
    </ul>
  ) : null;
}
function Attention({
  href,
  title,
  detail,
  read,
}: {
  href: string;
  title: string;
  detail: string;
  read: HomeRead<number> | undefined;
}) {
  return (
    <Link href={href} className={styles.attentionLink}>
      <span>
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
      <span className={styles.attentionCount}>
        {read?.status === 'ready' && read.data !== null
          ? format(read.data)
          : read?.status === 'loading'
            ? '…'
            : 'Unavailable'}
      </span>
    </Link>
  );
}
function SummaryNumbers({ summary }: { summary: HomeRead<HomeSummary> }) {
  if (!summary.data) return <p className={styles.muted}>{readLabel(summary)}</p>;
  const archive = summary.data.emailsByVerb?.archive;
  const deleted = summary.data.emailsByVerb?.delete;
  if (archive === undefined || deleted === undefined)
    return <p className={styles.muted}>Email totals unavailable.</p>;
  return (
    <div aria-live="polite">
      <p className={styles.progressSentence}>
        <strong data-testid="home-hero">{format(archive + deleted)}</strong> emails cleared
      </p>
      <dl className={styles.progressDetails}>
        <div>
          <dt>Emails archived</dt>
          <dd>{format(archive)}</dd>
        </div>
        <div>
          <dt>Emails moved to Trash</dt>
          <dd>{format(deleted)}</dd>
        </div>
      </dl>
    </div>
  );
}
function PreviewButton({ onClick }: { onClick: () => void }) {
  const [interactive, setInteractive] = useState(false);
  useEffect(() => setInteractive(true), []);
  return (
    <button
      type="button"
      data-dm-button=""
      disabled={!interactive}
      className={`dm-button-link ${styles.primaryAction}`}
      onClick={onClick}
    >
      Preview cleanup
    </button>
  );
}
function PrimaryLink({ action }: { action: HomeAction }) {
  return action.loading ? (
    <span role="status">{action.label}</span>
  ) : (
    <Link href={action.href} className={`dm-button-link ${styles.primaryAction}`} data-dm-button="">
      {action.label}
    </Link>
  );
}
function format(value: number) {
  return new Intl.NumberFormat('en-US').format(value);
}
function date(value: string, timeZone: string) {
  const instant = new Date(value);
  return Number.isNaN(instant.getTime())
    ? 'Time unavailable'
    : new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone,
      }).format(instant);
}
function readLabel(read: HomeRead<unknown>) {
  return read.status === 'loading'
    ? 'Loading…'
    : read.status === 'locked'
      ? 'Not available on this plan'
      : 'Unavailable';
}
function insightTitle(id: string) {
  return (
    (
      {
        mostly_unread_share: 'Mostly unread senders',
        large_mail: 'Large messages',
        third_party_labels: 'Mail under other-app labels',
        people_share: 'People you write to',
        years_deep: 'Older mail',
        top10_share: 'Your busiest senders',
        trash_bytes: 'Mail in Trash',
      } as Record<string, string>
    )[id] ?? 'Mailbox insight'
  );
}

/** Due means the return time has passed; future timers keep their own next-return label. */
export function homeLaterOverview(
  rows: readonly Pick<SnoozedSenderRow, 'senderId' | 'returnStatus' | 'snoozedUntil'>[],
  now: number | null,
) {
  const troubled = rows.filter(
    (row) => row.returnStatus === 'missed' || row.returnStatus === 'retrying',
  ).length;
  const due = rows.filter(
    (row) =>
      row.returnStatus === 'missed' ||
      row.returnStatus === 'retrying' ||
      (now !== null && Date.parse(row.snoozedUntil) <= now),
  ).length;
  const next =
    now === null
      ? []
      : rows
          .filter((row) => row.returnStatus === 'scheduled' && Date.parse(row.snoozedUntil) > now)
          .map((row) => row.snoozedUntil)
          .sort((a, b) => Date.parse(a) - Date.parse(b));
  return { due, troubled, nextAt: next[0] ?? null };
}
