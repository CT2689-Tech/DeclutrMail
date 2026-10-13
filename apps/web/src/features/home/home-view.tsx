'use client';

import Link from 'next/link';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { ErrorState, Skeleton } from '@declutrmail/shared';
import type { CleanupSummaryDto } from '@declutrmail/shared/contracts';
import { planName, type TierId } from '@declutrmail/shared/entitlements';
import { InboxReportCard } from '@/features/inbox-report';
import { QuotaChipSlot } from '@/features/shell/quota-chip-slot';
import { loadErrorDescription } from '@/lib/load-error-copy';
import { track } from '@/lib/posthog';

import { fillDeck, formatCount, HOME_DECK } from './home-deck-copy';
import type { HomePreviewReport } from './home-preview-report';
import { HomeFixDialog } from './home-fix-dialog';
import {
  homeCalmTemplate,
  homeFixCopy,
  homeReportCopy,
  homeReportNamesSenders,
  homeTileCopy,
} from './home-ws5-copy';
import { HomeScanFailedCopy, HomeScanRecovery } from './home-scan-recovery';
import {
  homeV1Mode,
  isRetiredReviewCta,
  rankHomeNextSteps,
  type HomeFixCandidate,
  type HomeV1Mode,
} from './home-next-steps';
import { SYNC_FAILED_ACTION, type HomeAction, type HomeState } from './home-state';
import styles from './home-view.module.css';

const BILLING_HREF = '/billing?from=%2Fhome';

/** The shipped card marks the mailbox on its root, not only on an anchor. */
const REPORT_CARD_MARK = '[data-mailbox]';

function homeNextStepEventKind(
  kind: HomeFixCandidate['kind'],
): 'unsubscribe_archive' | 'largest_senders' | 'later_due' {
  switch (kind) {
    case 'unsub_archive':
      return 'unsubscribe_archive';
    case 'largest':
      return 'largest_senders';
    case 'later_due':
      return 'later_due';
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

/** Home v1: report, suggested next steps, progress. No promo and no auto-confirm. */
export function HomeView({
  state,
  tier = 'free',
  timeZone = 'UTC',
  visitSummary,
  summary = null,
  nextSteps = [],
  senderSizeView = false,
  reportSizeLabel = null,
  indexedEmailCount = null,
  mailboxId = '',
  previewReport = null,
  reportLead = null,
  supportText = null,
  onConfirmFix,
}: {
  state: HomeState;
  visitSummary?: ReactNode;
  tier?: TierId;
  timeZone?: string;
  summary?: CleanupSummaryDto | null;
  nextSteps?: readonly HomeFixCandidate[];
  /** F2 size view. Largest is dropped by the ranker before it arrives here. */
  senderSizeView?: boolean;
  /** Total Gmail size label, already formatted (for example "7.7 GB"). Never an amount freed. */
  reportSizeLabel?: string | null;
  indexedEmailCount?: number | null;
  /** Passed through to `InboxReportCard`. Empty until a mailbox is in scope. */
  mailboxId?: string;
  /** Preview route only. Production Home leaves this null. */
  previewReport?: HomePreviewReport | null;
  /** Filled report headline. Preview uses `previewReport.headline` instead. */
  reportLead?: string | null;
  /** Filled mostly-unread support. Preview uses its own deck sample. */
  supportText?: string | null;
  onConfirmFix?: (step: HomeFixCandidate) => void;
}) {
  const steps = rankHomeNextSteps(nextSteps, { senderSizeView });
  const mode = homeV1Mode(state.kind, state.kind === 'ready' ? steps.length : 0);
  const [pendingFix, setPendingFix] = useState<HomeFixCandidate | null>(null);
  const reportRef = useRef<HTMLDivElement>(null);
  const reportMounted = useInboxReportMounted(reportRef);
  const fixCopy = previewReport?.fix ?? homeFixCopy();
  const namesSenders = previewReport !== null || homeReportNamesSenders();
  const fixReady =
    fixCopy !== null &&
    namesSenders &&
    reportMounted &&
    steps.some((step) => step.kind === 'unsub_archive');
  useHomeSurfaceEvents(mode);

  return (
    <div
      className={styles.page}
      data-home-mode={mode}
      data-sender-size-view={senderSizeView ? 'on' : 'off'}
      data-home-priority={mode === 'full' ? 'review' : 'intro'}
      data-home-fix-expected={fixReady ? 'true' : 'false'}
    >
      <header className={styles.header}>
        <h1>{HOME_DECK.homeTitle}</h1>
        {state.kind !== 'loading' && (
          <div className={styles.planLine}>
            <QuotaChipSlot summary={summary} />
            <span>
              <PlanLabel tier={tier} />
              <Link href={BILLING_HREF} className="dm-external-link dm-tap-target">
                {HOME_DECK.compare}
              </Link>
            </span>
          </div>
        )}
      </header>
      {visitSummary}
      <HomeBody
        state={state}
        timeZone={timeZone}
        mode={mode}
        steps={steps}
        reportRef={reportRef}
        reportMounted={reportMounted}
        reportSizeLabel={reportSizeLabel}
        indexedEmailCount={indexedEmailCount}
        mailboxId={mailboxId}
        previewReport={previewReport}
        reportLead={reportLead}
        supportText={previewReport === null ? supportText : null}
        onOpenFix={(step) => {
          void track('home_next_step_clicked', { kind: homeNextStepEventKind(step.kind) });
          if (step.kind === 'unsub_archive') setPendingFix(step);
        }}
      />
      {pendingFix !== null && (
        <HomeFixDialog
          step={pendingFix}
          onCancel={() => setPendingFix(null)}
          onConfirm={() => {
            const step = pendingFix;
            setPendingFix(null);
            onConfirmFix?.(step);
          }}
        />
      )}
    </div>
  );
}

function useHomeSurfaceEvents(mode: HomeV1Mode) {
  const caughtUp = useRef(false);
  useEffect(() => {
    if (mode !== 'fallback' || caughtUp.current) return;
    caughtUp.current = true;
    void track('caught_up_viewed', { surface: 'home' });
  }, [mode]);
}

function PlanLabel({ tier }: { tier: TierId }) {
  const name = planName(tier);
  if (!name) return null;
  return (
    <>
      {name}
      {' · '}
    </>
  );
}

function useInboxReportMounted(ref: RefObject<HTMLElement | null>): boolean {
  const [mounted, setMounted] = useState(false);
  useLayoutEffect(() => {
    setMounted(ref.current?.querySelector(`[data-inbox-report], ${REPORT_CARD_MARK}`) != null);
  });
  return mounted;
}

function HomeBody({
  state,
  timeZone,
  mode,
  steps,
  reportRef,
  reportMounted,
  reportSizeLabel,
  indexedEmailCount,
  mailboxId,
  previewReport,
  reportLead,
  supportText,
  onOpenFix,
}: {
  state: HomeState;
  timeZone: string;
  mode: HomeV1Mode;
  steps: readonly HomeFixCandidate[];
  reportRef: RefObject<HTMLDivElement | null>;
  reportMounted: boolean;
  reportSizeLabel: string | null;
  indexedEmailCount: number | null;
  mailboxId: string;
  previewReport: HomePreviewReport | null;
  reportLead: string | null;
  supportText: string | null;
  onOpenFix: (step: HomeFixCandidate) => void;
}) {
  const afterCard =
    state.kind === 'ready' && steps.length > 0 ? (
      <NextSteps
        steps={steps}
        reportMounted={reportMounted}
        previewReport={previewReport}
        supportText={supportText}
        onOpenFix={onOpenFix}
      />
    ) : null;
  const report = (
    <ReportCard
      reportRef={reportRef}
      mode={mode}
      reportSizeLabel={reportSizeLabel}
      indexedEmailCount={indexedEmailCount}
      mailboxId={mailboxId}
      previewReport={previewReport}
      reportLead={reportLead}
      afterCard={afterCard}
    />
  );
  switch (state.kind) {
    case 'loading':
      return <HomeSkeleton />;
    case 'error':
      return (
        <ErrorState
          headingLevel={2}
          title="We couldn't load Home"
          description={loadErrorDescription(state.error)}
          onRetry={state.retry}
        />
      );
    case 'empty':
      return (
        <>
          {report}
          <EmptyCopy state={state} />
        </>
      );
    case 'sync-failed':
      return (
        <>
          <section className={styles.beginning} aria-label={HOME_DECK.failedEyebrow}>
            <span className={styles.eyebrow}>{HOME_DECK.failedEyebrow}</span>
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
          <TrustLine />
        </>
      );
    case 'ready':
      return (
        <>
          {report}
          <Progress state={state} timeZone={timeZone} />
        </>
      );
    default: {
      const unreachable: never = state;
      return unreachable;
    }
  }
}

function EmptyCopy({ state }: { state: Extract<HomeState, { kind: 'empty' }> }) {
  if (state.syncing) {
    const title = state.queued ? HOME_DECK.queuedTitle : HOME_DECK.syncingTitle;
    const status = state.queued
      ? HOME_DECK.queuedBody
      : (state.stageSentence ?? HOME_DECK.syncingBody);
    return (
      <section className={styles.beginning} aria-label={title}>
        <h2>{title}</h2>
        <p>{status}</p>
        <div className={styles.scanBar} data-testid="home-scan-bar" aria-hidden="true">
          <span />
        </div>
      </section>
    );
  }
  return (
    <section className={styles.beginning} aria-label="Your next step">
      <h2>{HOME_DECK.emptyTitle}</h2>
      <p>{HOME_DECK.emptyBody}</p>
      {!isRetiredReviewCta(state.action.label) && <PrimaryLink action={state.action} />}
    </section>
  );
}

function ReportCard({
  reportRef,
  mode,
  reportSizeLabel,
  indexedEmailCount,
  mailboxId,
  previewReport,
  reportLead,
  afterCard,
}: {
  reportRef: RefObject<HTMLDivElement | null>;
  mode: HomeV1Mode;
  reportSizeLabel: string | null;
  indexedEmailCount: number | null;
  mailboxId: string;
  previewReport: HomePreviewReport | null;
  reportLead: string | null;
  afterCard: ReactNode;
}) {
  const deck = homeReportCopy();
  const copy = previewReport ?? deck;
  const calmTemplate = homeCalmTemplate();
  const calm =
    previewReport !== null
      ? previewReport.calm
      : copy !== null &&
          calmTemplate !== null &&
          mode === 'fallback' &&
          indexedEmailCount !== null &&
          indexedEmailCount > 0
        ? fillDeck(calmTemplate, { total: formatCount(indexedEmailCount) })
        : null;
  const tileCopy = homeTileCopy();
  const deckTile =
    previewReport === null &&
    copy !== null &&
    tileCopy !== null &&
    reportSizeLabel !== null &&
    reportSizeLabel !== ''
      ? {
          value: fillDeck(tileCopy.value, { size: reportSizeLabel }),
          label: tileCopy.label,
          note: tileCopy.note,
        }
      : null;
  const tile =
    previewReport !== null && previewReport.tileValue !== null && previewReport.tileLabel !== null
      ? {
          value: previewReport.tileValue,
          label: previewReport.tileLabel,
          note: previewReport.tileNote,
        }
      : deckTile;
  const trust = previewReport?.trust ?? deck?.trust ?? null;
  const trustLink = previewReport?.trustLink ?? deck?.trustLink ?? null;
  const headline = previewReport?.headline ?? reportLead;
  const lead = headline !== null && headline !== '' ? <LeadLine headline={headline} /> : null;
  // The card link owns title, body, and the Open report action. The lead
  // sits at the top of that card, outside the link. Tile and trust follow
  // the suggested step so the primary action stays above the tab bar.
  const [cardOwnsIntro, setCardOwnsIntro] = useState(false);
  useLayoutEffect(() => {
    setCardOwnsIntro(reportRef.current?.querySelector(REPORT_CARD_MARK) != null);
  });
  if (copy === null) {
    return (
      <div ref={reportRef} hidden>
        <InboxReportCard surface="home" mailboxId={mailboxId} lead={lead} />
      </div>
    );
  }
  return (
    <section ref={reportRef} className={styles.report} aria-label={copy.title}>
      <div className={`${styles.reportCard} dm-home-report-card`} data-home-report-card="">
        <InboxReportCard surface="home" mailboxId={mailboxId} lead={lead} />
      </div>
      {!cardOwnsIntro && (
        <div className={styles.reportIntro} data-report-intro="">
          <h2>{copy.title}</h2>
          <p>{copy.body}</p>
          {copy.cta !== '' && (
            // There is no /inbox-report route. Senders is where the report card opens.
            <Link
              href="/senders"
              data-dm-button=""
              className={`dm-button-link ${styles.primaryAction}`}
            >
              {copy.cta}
            </Link>
          )}
        </div>
      )}
      {afterCard}
      <div
        className={styles.reportFacts}
        data-report-facts=""
        {...(lead !== null ? { 'data-inbox-report': '' } : {})}
      >
        {calm !== null && <p data-testid="home-calm">{calm}</p>}
        {tile !== null && (
          <div className={styles.storageTile} data-report-tile="">
            <strong>{tile.value}</strong>
            <span>{tile.label}</span>
            {tile.note !== null && <small>{tile.note}</small>}
          </div>
        )}
        {trust !== null && (
          <p className={styles.trust} data-report-trust="">
            {trust}{' '}
            {trustLink !== null && (
              <Link href="/settings/privacy#what-we-store" className="dm-external-link">
                {trustLink}
                <span aria-hidden="true"> →</span>
              </Link>
            )}
          </p>
        )}
      </div>
    </section>
  );
}

/** A template that still has `{n}` is not a sentence. Preview copy is already filled. */
function supportLine(template: string, filled: string | null): string | null {
  if (filled !== null && filled !== '') return filled;
  if (template.includes('{')) return null;
  return template;
}

function LeadLine({ headline }: { headline: string }) {
  const match = /^(\d+%)\s+([\s\S]+)$/.exec(headline);
  if (match === null) {
    return <p data-report-lead="">{headline}</p>;
  }
  return (
    <p className={styles.lead} data-report-lead="">
      <strong className={styles.leadFigure}>{match[1]}</strong>
      <span>{match[2]}</span>
    </p>
  );
}

function TrustLine() {
  const copy = homeReportCopy();
  if (copy === null) return null;
  return (
    <p className={styles.trust}>
      {copy.trust}{' '}
      {copy.trustLink !== null && (
        <Link href="/settings/privacy#what-we-store" className="dm-external-link">
          {copy.trustLink}
          <span aria-hidden="true"> →</span>
        </Link>
      )}
    </p>
  );
}

function NextSteps({
  steps,
  reportMounted,
  previewReport,
  supportText,
  onOpenFix,
}: {
  steps: readonly HomeFixCandidate[];
  reportMounted: boolean;
  previewReport: HomePreviewReport | null;
  supportText: string | null;
  onOpenFix: (step: HomeFixCandidate) => void;
}) {
  const fixCopy = previewReport?.fix ?? homeFixCopy();
  const namesSenders = previewReport !== null || homeReportNamesSenders();
  const visible = steps.filter(
    (step) => step.kind !== 'unsub_archive' || (fixCopy !== null && reportMounted && namesSenders),
  );
  const [primary, ...secondary] = visible;
  if (!primary) return null;
  return (
    <section className={styles.steps} aria-label={HOME_DECK.nextSteps}>
      <h2 className={styles.eyebrow}>{HOME_DECK.nextSteps}</h2>
      <div className={styles.stepGrid}>
        <FixCard
          step={primary}
          primary
          reportMounted={reportMounted}
          previewReport={previewReport}
          supportText={supportText}
          onOpenFix={onOpenFix}
        />
        {secondary.map((step) => (
          <FixCard
            key={step.kind}
            step={step}
            primary={false}
            reportMounted={reportMounted}
            previewReport={previewReport}
            supportText={supportText}
            onOpenFix={onOpenFix}
          />
        ))}
      </div>
    </section>
  );
}

function FixCard({
  step,
  primary,
  reportMounted,
  previewReport,
  supportText,
  onOpenFix,
}: {
  step: HomeFixCandidate;
  primary: boolean;
  reportMounted: boolean;
  previewReport: HomePreviewReport | null;
  supportText: string | null;
  onOpenFix: (step: HomeFixCandidate) => void;
}) {
  if (step.kind === 'unsub_archive') {
    const copy = previewReport?.fix ?? homeFixCopy();
    const namesSenders = previewReport !== null || homeReportNamesSenders();
    // "of these senders" counts a set the report names. Hide it until that
    // sentence is on the page.
    if (copy === null || !reportMounted || !namesSenders) return null;
    const heading =
      step.senderCount === 1
        ? copy.headingOne
        : fillDeck(copy.headingOther, { n: formatCount(step.senderCount) });
    const label =
      step.senderCount === 1
        ? copy.primaryOne
        : fillDeck(copy.primaryOther, { n: formatCount(step.senderCount) });
    const supportTemplate = step.senderCount === 1 ? copy.supportOne : copy.supportOther;
    const support = supportLine(supportTemplate, supportText);
    if (heading === null || label === null) return null;
    return (
      <article className={primary ? styles.fixCard : styles.secondaryCard} data-step={step.kind}>
        <h3>{heading}</h3>
        {support !== null && <p>{support}</p>}
        {primary ? (
          <div className={styles.fixActions}>
            <button
              type="button"
              data-dm-button=""
              className={`dm-button-link ${styles.primaryAction}`}
              onClick={() => onOpenFix(step)}
            >
              {label}
            </button>
            <Link href="/senders" className="dm-external-link">
              {copy.review}
            </Link>
          </div>
        ) : (
          <button type="button" className={styles.textButton} onClick={() => onOpenFix(step)}>
            {label}
          </button>
        )}
      </article>
    );
  }
  if (step.kind === 'largest') {
    const title =
      step.senderCount === 1
        ? HOME_DECK.largestTitleOne
        : fillDeck(HOME_DECK.largestTitleOther, { k: formatCount(step.senderCount) });
    const body =
      step.sizeLabel !== undefined && step.sizeLabel !== ''
        ? fillDeck(HOME_DECK.largestBody, { size: step.sizeLabel })
        : null;
    if (title === null) return null;
    return (
      <article className={styles.secondaryCard} data-step={step.kind}>
        <h3>{title}</h3>
        {body !== null && <p>{body}</p>}
        <Link href="/senders" className="dm-external-link">
          {HOME_DECK.largestCta}
        </Link>
      </article>
    );
  }
  if (step.kind === 'later_due') {
    return <LaterCard step={step} />;
  }
  const unreachable: never = step.kind;
  return unreachable;
}

/** Same clock as the Later row in the shell. The count key is held, so the card shows none. */
const LATER_ICON = 'M12 6v6l4 2M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z';

function LaterCard({ step }: { step: HomeFixCandidate }) {
  return (
    <article className={styles.secondaryCard} data-step={step.kind}>
      <div className={styles.cardTitle}>
        <svg
          className={styles.cardIcon}
          width={20}
          height={20}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d={LATER_ICON} />
        </svg>
        <h3>{HOME_DECK.laterTitle}</h3>
      </div>
      <p>{HOME_DECK.laterBody}</p>
      <Link
        href="/later"
        className={`dm-external-link ${styles.cardAction}`}
        onClick={() => {
          void track('home_next_step_clicked', { kind: homeNextStepEventKind('later_due') });
        }}
      >
        {HOME_DECK.laterCta}
      </Link>
    </article>
  );
}

function Progress({
  state,
  timeZone,
}: {
  state: Extract<HomeState, { kind: 'ready' }>;
  timeZone: string;
}) {
  return (
    <section className={styles.progressLine} aria-label="Progress">
      <p className={styles.progressSentence}>
        <strong data-testid="home-hero">{state.hero.value.toLocaleString('en-US')}</strong>{' '}
        <span>{state.hero.label}</span>
        {state.since !== null && (
          <span className={styles.since}>
            {' since '}
            <time dateTime={state.since}>{formatSince(state.since, timeZone)}</time>
          </span>
        )}
      </p>
      <Link href="/activity" className="dm-external-link">
        {HOME_DECK.activityLink}
      </Link>
    </section>
  );
}

function PrimaryLink({ action }: { action: HomeAction }) {
  if (action.loading) {
    return (
      <span role="status" aria-live="polite" className={styles.loadingAction}>
        <Skeleton variant="rect" width={16} height={16} />
        {action.label}
      </span>
    );
  }
  return (
    <Link href={action.href} data-dm-button="" className={`dm-button-link ${styles.primaryAction}`}>
      {action.label}
    </Link>
  );
}

function HomeSkeleton() {
  const labelId = useId();
  return (
    <div role="status" aria-labelledby={labelId} className={styles.summaryGrid}>
      <span id={labelId} className={styles.srOnly}>
        Loading Home
      </span>
      <Skeleton variant="text" width={160} />
      <Skeleton variant="rect" width={210} height={90} />
    </div>
  );
}

function formatSince(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone });
}
