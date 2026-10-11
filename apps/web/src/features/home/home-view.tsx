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
import { ErrorState, Skeleton, useLabels } from '@declutrmail/shared';
import type { CleanupSummaryDto } from '@declutrmail/shared/contracts';
import { planName, type TierId } from '@declutrmail/shared/entitlements';
import { InboxReportCard } from '@/features/inbox-report';
import { QuotaChipSlot } from '@/features/shell/quota-chip-slot';
import { loadErrorDescription } from '@/lib/load-error-copy';
import { track } from '@/lib/posthog';

import { fillDeck, formatCount, HOME_DECK } from './home-deck-copy';
import { HomeFixDialog } from './home-fix-dialog';
import {
  homeCalmTemplate,
  homeFixCopy,
  homeReportCopy,
  homeReportNamesSenders,
  homeTileCopy,
} from './home-ws5-copy';
import { HomeScanRecovery } from './home-scan-recovery';
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
  onConfirmFix?: (step: HomeFixCandidate) => void;
}) {
  const steps = rankHomeNextSteps(nextSteps, { senderSizeView });
  const mode = homeV1Mode(state.kind, state.kind === 'ready' ? steps.length : 0);
  const [pendingFix, setPendingFix] = useState<HomeFixCandidate | null>(null);
  const reportRef = useRef<HTMLDivElement>(null);
  const reportMounted = useInboxReportMounted(reportRef);
  const fixReady =
    homeFixCopy() !== null &&
    homeReportNamesSenders() &&
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
              <Link href={BILLING_HREF} className="dm-external-link">
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
        onOpenFix={(step) => {
          void track('home_next_step_clicked', { kind: step.kind });
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
  const reported = useRef(false);
  const caughtUp = useRef(false);
  useEffect(() => {
    if (mode !== 'full' && mode !== 'fallback') return;
    if (!reported.current) {
      reported.current = true;
      void track('report_viewed', { surface: 'home' });
    }
    if (mode === 'fallback' && !caughtUp.current) {
      caughtUp.current = true;
      void track('caught_up_viewed', { surface: 'home' });
    }
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
    setMounted(ref.current?.querySelector('[data-inbox-report]') != null);
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
  onOpenFix: (step: HomeFixCandidate) => void;
}) {
  const report = (
    <ReportCard
      reportRef={reportRef}
      mode={mode}
      reportSizeLabel={reportSizeLabel}
      indexedEmailCount={indexedEmailCount}
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
          <TrustLine />
        </>
      );
    case 'sync-failed':
      return (
        <>
          <section className={styles.beginning} aria-label={HOME_DECK.failedEyebrow}>
            <span className={styles.eyebrow}>{HOME_DECK.failedEyebrow}</span>
            <h2>Gmail scan failed.</h2>
            {state.mailboxId ? (
              <HomeScanRecovery mailboxId={state.mailboxId} needsReconnect={state.needsReconnect} />
            ) : (
              <>
                <p>
                  {state.needsReconnect
                    ? 'Reconnect it in Settings → Gmail accounts.'
                    : 'Scan again in Settings → Gmail accounts.'}
                </p>
                <PrimaryLink action={SYNC_FAILED_ACTION} />
              </>
            )}
          </section>
          <TrustLine />
        </>
      );
    case 'ready':
      return (
        <>
          {report}
          {steps.length > 0 && (
            <NextSteps steps={steps} reportMounted={reportMounted} onOpenFix={onOpenFix} />
          )}
          <TrustLine />
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
    return (
      <section
        className={styles.beginning}
        aria-label={state.queued ? HOME_DECK.queuedTitle : undefined}
      >
        {state.queued && (
          <>
            <h2>{HOME_DECK.queuedTitle}</h2>
            <p>{HOME_DECK.queuedBody}</p>
          </>
        )}
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
}: {
  reportRef: RefObject<HTMLDivElement | null>;
  mode: HomeV1Mode;
  reportSizeLabel: string | null;
  indexedEmailCount: number | null;
}) {
  const copy = homeReportCopy();
  const calmTemplate = homeCalmTemplate();
  const calm =
    copy !== null &&
    calmTemplate !== null &&
    mode === 'fallback' &&
    indexedEmailCount !== null &&
    indexedEmailCount > 0
      ? fillDeck(calmTemplate, { total: formatCount(indexedEmailCount) })
      : null;
  const tileCopy = homeTileCopy();
  const tile =
    copy !== null && tileCopy !== null && reportSizeLabel !== null && reportSizeLabel !== ''
      ? fillDeck(tileCopy.value, { size: reportSizeLabel })
      : null;
  if (copy === null) {
    return (
      <div ref={reportRef} hidden>
        <InboxReportCard surface="home" />
      </div>
    );
  }
  return (
    <section ref={reportRef} className={styles.report} aria-label={copy.title}>
      <InboxReportCard surface="home" />
      <div className={styles.reportFallback}>
        <h2>{copy.title}</h2>
        <p>{copy.body}</p>
        {copy.cta !== '' && <p>{copy.cta}</p>}
        {calm !== null && <p data-testid="home-calm">{calm}</p>}
        {tile !== null && tileCopy !== null && (
          <div className={styles.storageTile}>
            <strong>{tile}</strong>
            <span>{tileCopy.label}</span>
            {tileCopy.note !== null && <small>{tileCopy.note}</small>}
          </div>
        )}
      </div>
    </section>
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
  onOpenFix,
}: {
  steps: readonly HomeFixCandidate[];
  reportMounted: boolean;
  onOpenFix: (step: HomeFixCandidate) => void;
}) {
  const visible = steps.filter(
    (step) =>
      step.kind !== 'unsub_archive' ||
      (homeFixCopy() !== null && reportMounted && homeReportNamesSenders()),
  );
  const [primary, ...secondary] = visible;
  if (!primary) return null;
  return (
    <section className={styles.steps} aria-label={HOME_DECK.nextSteps}>
      <h2 className={styles.eyebrow}>{HOME_DECK.nextSteps}</h2>
      <div className={styles.stepGrid}>
        <FixCard step={primary} primary reportMounted={reportMounted} onOpenFix={onOpenFix} />
        {secondary.map((step) => (
          <FixCard
            key={step.kind}
            step={step}
            primary={false}
            reportMounted={reportMounted}
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
  onOpenFix,
}: {
  step: HomeFixCandidate;
  primary: boolean;
  reportMounted: boolean;
  onOpenFix: (step: HomeFixCandidate) => void;
}) {
  if (step.kind === 'unsub_archive') {
    const copy = homeFixCopy();
    // "of these senders" counts a set the report names. Hide it until that
    // sentence is on the page.
    if (copy === null || !reportMounted || !homeReportNamesSenders()) return null;
    const heading =
      step.senderCount === 1
        ? copy.headingOne
        : fillDeck(copy.headingOther, { n: formatCount(step.senderCount) });
    const label =
      step.senderCount === 1
        ? copy.primaryOne
        : fillDeck(copy.primaryOther, { n: formatCount(step.senderCount) });
    const support = step.senderCount === 1 ? copy.supportOne : copy.supportOther;
    if (heading === null || label === null) return null;
    return (
      <article className={primary ? styles.fixCard : styles.secondaryCard} data-step={step.kind}>
        <h3>{heading}</h3>
        <p>{support}</p>
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

function LaterCard({ step }: { step: HomeFixCandidate }) {
  const labels = useLabels();
  return (
    <article className={styles.secondaryCard} data-step={step.kind}>
      <h3>
        <Link
          href="/later"
          className="dm-external-link"
          onClick={() => {
            void track('home_next_step_clicked', { kind: 'later_due' });
          }}
        >
          {labels.snoozed}
        </Link>
      </h3>
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
