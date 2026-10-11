'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ErrorState, Skeleton } from '@declutrmail/shared';
import type { CleanupSummaryDto } from '@declutrmail/shared/contracts';
import { planName, type TierId } from '@declutrmail/shared/entitlements';
import { InboxReportCard } from '@/features/inbox-report';
import { QuotaChipSlot } from '@/features/shell/quota-chip-slot';
import { loadErrorDescription } from '@/lib/load-error-copy';
import { track } from '@/lib/posthog';

import { fillDeck, formatCount, HOME_DECK } from './home-deck-copy';
import { HomeFixDialog } from './home-fix-dialog';
import { HomeScanRecovery } from './home-scan-recovery';
import {
  homeV1Mode,
  isRetiredReviewCta,
  rankHomeNextSteps,
  type HomeFixCandidate,
  type HomeV1Mode,
} from './home-next-steps';
import { SYNC_FAILED_ACTION, type HomeAction, type HomeStat, type HomeState } from './home-state';
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
  useHomeSurfaceEvents(mode);

  return (
    <div
      className={styles.page}
      data-home-mode={mode}
      data-sender-size-view={senderSizeView ? 'on' : 'off'}
      data-home-priority={mode === 'full' ? 'review' : 'intro'}
    >
      <header className={styles.header}>
        <h1>{HOME_DECK.homeTitle}</h1>
        {state.kind !== 'loading' && (
          <div className={styles.planLine}>
            <QuotaChipSlot summary={summary} />
            <span>
              <PlanLabel tier={tier} />
              <Link href={BILLING_HREF}>{HOME_DECK.compare}</Link>
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

function HomeBody({
  state,
  timeZone,
  mode,
  steps,
  reportSizeLabel,
  indexedEmailCount,
  onOpenFix,
}: {
  state: HomeState;
  timeZone: string;
  mode: HomeV1Mode;
  steps: readonly HomeFixCandidate[];
  reportSizeLabel: string | null;
  indexedEmailCount: number | null;
  onOpenFix: (step: HomeFixCandidate) => void;
}) {
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
          <ReportCard
            mode="empty"
            reportSizeLabel={reportSizeLabel}
            indexedEmailCount={indexedEmailCount}
          />
          <EmptyCopy state={state} />
        </>
      );
    case 'sync-failed':
      return (
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
      );
    case 'ready':
      return (
        <>
          <ReportCard
            mode={mode}
            reportSizeLabel={reportSizeLabel}
            indexedEmailCount={indexedEmailCount}
          />
          {steps.length > 0 && <NextSteps steps={steps} onOpenFix={onOpenFix} />}
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
  if (state.syncing && !state.queued) return null;
  return (
    <section className={styles.beginning} aria-label="Your next step">
      <h2>{state.queued ? HOME_DECK.queuedTitle : HOME_DECK.emptyTitle}</h2>
      <p>{state.queued ? HOME_DECK.queuedBody : HOME_DECK.emptyBody}</p>
      {!state.queued && !isRetiredReviewCta(state.action.label) && (
        <PrimaryLink action={state.action} />
      )}
    </section>
  );
}

function ReportCard({
  mode,
  reportSizeLabel,
  indexedEmailCount,
}: {
  mode: HomeV1Mode;
  reportSizeLabel: string | null;
  indexedEmailCount: number | null;
}) {
  const calm =
    mode === 'fallback' && indexedEmailCount !== null && indexedEmailCount > 0
      ? fillDeck(HOME_DECK.fallbackZero, { total: formatCount(indexedEmailCount) })
      : null;
  const tile =
    reportSizeLabel !== null && reportSizeLabel !== ''
      ? fillDeck(HOME_DECK.tileValue, { size: reportSizeLabel })
      : null;
  return (
    <section className={styles.report} aria-label={HOME_DECK.reportTitle}>
      <InboxReportCard surface="home" />
      <div className={styles.reportFallback}>
        <h2>{HOME_DECK.reportTitle}</h2>
        <p>{HOME_DECK.reportBody}</p>
        {calm !== null && <p data-testid="home-calm">{calm}</p>}
        {tile !== null && (
          <div className={styles.storageTile}>
            <strong>{tile}</strong>
            <span>{HOME_DECK.tileLabel}</span>
            <small>{HOME_DECK.sizesNote}</small>
          </div>
        )}
        <p className={styles.trust}>
          {HOME_DECK.trust}{' '}
          <Link href="/settings/privacy#what-we-store">
            {HOME_DECK.trustLink}
            <span aria-hidden="true"> →</span>
          </Link>
        </p>
      </div>
    </section>
  );
}

function NextSteps({
  steps,
  onOpenFix,
}: {
  steps: readonly HomeFixCandidate[];
  onOpenFix: (step: HomeFixCandidate) => void;
}) {
  const [primary, ...secondary] = steps;
  if (!primary) return null;
  return (
    <section className={styles.steps} aria-label={HOME_DECK.nextSteps}>
      <h2 className={styles.eyebrow}>{HOME_DECK.nextSteps}</h2>
      <div className={styles.stepGrid}>
        <FixCard step={primary} primary onOpenFix={onOpenFix} />
        {secondary.map((step) => (
          <FixCard key={step.kind} step={step} primary={false} onOpenFix={onOpenFix} />
        ))}
      </div>
    </section>
  );
}

function FixCard({
  step,
  primary,
  onOpenFix,
}: {
  step: HomeFixCandidate;
  primary: boolean;
  onOpenFix: (step: HomeFixCandidate) => void;
}) {
  if (step.kind === 'unsub_archive') {
    const heading =
      step.senderCount === 1
        ? HOME_DECK.fixHeadingOne
        : fillDeck(HOME_DECK.fixHeadingOther, { n: formatCount(step.senderCount) });
    const label =
      step.senderCount === 1
        ? HOME_DECK.fixPrimaryOne
        : fillDeck(HOME_DECK.fixPrimaryOther, { n: formatCount(step.senderCount) });
    const support =
      step.senderCount === 1
        ? HOME_DECK.mostlyUnreadSupportOne
        : HOME_DECK.mostlyUnreadSupportOther;
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
            <Link href="/senders">{HOME_DECK.fixReview}</Link>
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
        <Link href="/senders">{HOME_DECK.largestCta}</Link>
      </article>
    );
  }
  if (step.kind === 'later_due') {
    return (
      <article className={styles.secondaryCard} data-step={step.kind}>
        <h3>
          <Link
            href="/later"
            onClick={() => {
              void track('home_next_step_clicked', { kind: 'later_due' });
            }}
          >
            Later
          </Link>
        </h3>
      </article>
    );
  }
  const unreachable: never = step.kind;
  return unreachable;
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
      <strong data-testid="home-hero">{state.hero.value.toLocaleString('en-US')}</strong>
      <span>
        {state.hero.label}
        {state.since !== null && (
          <span className={styles.since}> since {formatSince(state.since, timeZone)}</span>
        )}
      </span>
      {state.secondary.length > 0 && <SecondaryRow stats={state.secondary} />}
      <Link href="/activity">{HOME_DECK.activityLink}</Link>
    </section>
  );
}

function SecondaryRow({ stats }: { stats: HomeStat[] }) {
  return (
    <dl className={styles.stats}>
      {stats.map((stat) => (
        <div key={stat.label}>
          <dt>{stat.label}</dt>
          <dd>{stat.value.toLocaleString('en-US')}</dd>
        </div>
      ))}
    </dl>
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
