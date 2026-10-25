'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ErrorState, Skeleton } from '@declutrmail/shared';
import type { CleanupSummaryDto } from '@declutrmail/shared/contracts';
import { planName, type TierId } from '@declutrmail/shared/entitlements';
import { QuotaChipSlot } from '@/features/shell/quota-chip-slot';
import { loadErrorDescription } from '@/lib/load-error-copy';
import { track } from '@/lib/posthog';

import { fillDeck, formatCount, HOME_DECK } from './home-deck-copy';
import { HomeLoadingSlots } from './home-loading-shell';
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

function canPreviewFix(step: HomeFixCandidate): boolean {
  return (
    step.kind === 'unsub_archive' &&
    step.senderIds.length > 0 &&
    step.emailCount !== undefined &&
    Number.isFinite(step.emailCount) &&
    step.emailCount > 0
  );
}

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

/** One next action; supporting context stays in Details. No auto-confirm. */
export function HomeView({
  state,
  tier = 'free',
  visitSummary,
  summary = null,
  nextSteps = [],
  senderSizeView = false,
  reportSizeLabel = null,
  indexedEmailCount = null,
  mailboxId = '',
  mailboxEmail = null,
  previewReport = null,
  reportLead = null,
  supportText = null,
  onConfirmFix,
}: {
  state: HomeState;
  visitSummary?: ReactNode;
  tier?: TierId;
  summary?: CleanupSummaryDto | null;
  nextSteps?: readonly HomeFixCandidate[];
  /** F2 size view. Largest is dropped by the ranker before it arrives here. */
  senderSizeView?: boolean;
  /** Total Gmail size label, already formatted (for example "7.7 GB"). Never an amount freed. */
  reportSizeLabel?: string | null;
  indexedEmailCount?: number | null;
  /** Scopes previews and resets the disclosure when the active mailbox changes. */
  mailboxId?: string;
  mailboxEmail?: string | null;
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
  const fixCopy = previewReport?.fix ?? homeFixCopy();
  const namesSenders = previewReport !== null || homeReportNamesSenders();
  const fixReady = fixCopy !== null && namesSenders && steps.some(canPreviewFix);
  useHomeSurfaceEvents(mode);
  const openFix = (step: HomeFixCandidate) => {
    void track('home_next_step_clicked', { kind: homeNextStepEventKind(step.kind) });
    if (step.kind === 'unsub_archive') setPendingFix(step);
  };

  return (
    <div
      className={styles.page}
      data-home-mode={mode}
      data-sender-size-view={senderSizeView ? 'on' : 'off'}
      data-home-priority={mode === 'full' ? 'review' : 'intro'}
      data-home-fix-expected={fixReady ? 'true' : 'false'}
    >
      <header className={styles.header}>
        <div>
          <h1>{HOME_DECK.homeTitle}</h1>
          {mailboxEmail && <p className={styles.mailboxIdentity}>{mailboxEmail}</p>}
        </div>
        <div className={styles.planLine} data-home-slot="quota">
          <QuotaChipSlot summary={summary} />
        </div>
      </header>
      <HomeBody
        state={state}
        mode={mode}
        steps={steps}
        visitSummary={visitSummary}
        reportSizeLabel={reportSizeLabel}
        indexedEmailCount={indexedEmailCount}
        mailboxId={mailboxId}
        previewReport={previewReport}
        reportLead={reportLead}
        supportText={previewReport === null ? supportText : null}
        onOpenFix={openFix}
        plan={
          <div className={styles.planLine} data-home-slot="plan">
            <PlanLabel tier={tier} />
            <Link href={BILLING_HREF} className="dm-external-link dm-tap-target">
              {HOME_DECK.compare}
            </Link>
          </div>
        }
      />
      {pendingFix !== null && (
        <HomeFixDialog
          step={pendingFix}
          mailboxId={previewReport === null ? mailboxId : undefined}
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

function HomeBody({
  state,
  mode,
  steps,
  visitSummary,
  reportSizeLabel,
  indexedEmailCount,
  mailboxId,
  previewReport,
  reportLead,
  supportText,
  onOpenFix,
  plan,
}: {
  state: HomeState;
  plan: ReactNode;
  mode: HomeV1Mode;
  steps: readonly HomeFixCandidate[];
  visitSummary?: ReactNode;
  reportSizeLabel: string | null;
  indexedEmailCount: number | null;
  mailboxId: string;
  previewReport: HomePreviewReport | null;
  reportLead: string | null;
  supportText: string | null;
  onOpenFix: (step: HomeFixCandidate) => void;
}) {
  const [primary, ...secondary] =
    state.kind === 'ready' || (state.kind === 'empty' && !state.syncing) ? steps : [];
  const visit = (
    <div className={styles.visitSlot} data-home-slot="visit">
      {visitSummary}
    </div>
  );
  const report = (
    <ReportCard
      mode={mode}
      reportSizeLabel={reportSizeLabel}
      indexedEmailCount={indexedEmailCount}
      previewReport={previewReport}
      reportLead={reportLead}
      supportText={previewReport?.fix.supportOther ?? supportText}
    />
  );
  const details = (
    <details key={mailboxId} className={styles.details} data-home-slot="details">
      <summary>{HOME_DECK.focus.details}</summary>
      <div className={styles.detailsBody}>
        {primary?.kind === 'unsub_archive' && (
          <div className={styles.recommendationFacts}>
            {canPreviewFix(primary) && (
              <p data-home-impact="">
                {fillDeck(
                  primary.emailCount === 1
                    ? HOME_DECK.focus.impact.one
                    : HOME_DECK.focus.impact.other,
                  { n: formatCount(primary.emailCount!) },
                )}
              </p>
            )}
            {canPreviewFix(primary) && (
              <Link href="/senders" className="dm-external-link dm-tap-target">
                {HOME_DECK.focus.review}
              </Link>
            )}
          </div>
        )}
        {secondary.length > 0 && (
          <div className={styles.secondarySteps}>
            {secondary.map((step) => (
              <FixCard
                key={step.kind}
                step={step}
                primary={false}
                previewReport={previewReport}
                supportText={supportText}
                onOpenFix={onOpenFix}
              />
            ))}
          </div>
        )}
        {state.kind === 'ready' ? (
          <Progress state={state} />
        ) : state.kind === 'empty' && !state.syncing && primary ? (
          <section className={styles.progressLine} aria-label="Progress">
            <h2 className={styles.progressHeading}>{HOME_DECK.focus.progress}</h2>
            <p className={styles.firstProgress}>{HOME_DECK.emptyTitle}</p>
            <Link href="/activity?window=all" className="dm-external-link dm-tap-target">
              {HOME_DECK.activityLink}
            </Link>
          </section>
        ) : null}
        {visit}
        {report}
        {plan}
      </div>
    </details>
  );
  switch (state.kind) {
    case 'loading':
      return <HomeSkeleton />;
    case 'error':
      return (
        <ErrorState
          headingLevel={2}
          title="We couldn’t load Home"
          description={loadErrorDescription(state.error)}
          onRetry={state.retry}
        />
      );
    case 'sync-failed':
      return (
        <>
          <section className={styles.beginning} aria-label={HOME_DECK.failedEyebrow}>
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
          {details}
        </>
      );
    case 'empty':
    case 'ready':
      return (
        <>
          <div className={styles.focusLead}>
            {primary ? (
              <NextSteps
                primary={primary}
                secondary={[]}
                previewReport={previewReport}
                supportText={supportText}
                onOpenFix={onOpenFix}
              />
            ) : state.kind === 'empty' ? (
              <EmptyCopy state={state} />
            ) : (
              <section aria-label="Your next step" className={styles.calmStart}>
                <h2>{HOME_DECK.focus.calmTitle}</h2>
                <PrimaryLink action={state.action} />
              </section>
            )}
          </div>
          {details}
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
      {!isRetiredReviewCta(state.action.label) && <PrimaryLink action={state.action} />}
    </section>
  );
}

function ReportCard({
  mode,
  reportSizeLabel,
  indexedEmailCount,
  previewReport,
  reportLead,
  supportText,
}: {
  mode: HomeV1Mode;
  reportSizeLabel: string | null;
  indexedEmailCount: number | null;
  previewReport: HomePreviewReport | null;
  reportLead: string | null;
  supportText: string | null;
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
  const headline = previewReport?.headline ?? reportLead;
  if (copy === null) return null;
  return (
    <section className={styles.report} aria-label={copy.title} data-home-slot="report">
      <h2 className={styles.progressHeading}>{copy.title}</h2>
      {headline && <p data-report-lead="">{headline}</p>}
      {supportText && <p className={styles.reportSupport}>{supportText}</p>}
      {calm !== null && <p data-testid="home-calm">{calm}</p>}
      {tile !== null && (
        <p data-report-tile="">
          {tile.value} {tile.label}
          {tile.note && <> — {tile.note}</>}
        </p>
      )}
      <Link href="/senders#inbox-report" className="dm-external-link dm-tap-target">
        {copy.cta}
      </Link>
      <Link href="/settings/privacy#what-we-store" className="dm-external-link dm-tap-target">
        {HOME_DECK.focus.privacy}
      </Link>
    </section>
  );
}

/** A template that still has `{n}` is not a sentence. Preview copy is already filled. */
function supportLine(template: string, filled: string | null): string | null {
  if (filled !== null && filled !== '') return filled;
  if (template.includes('{')) return null;
  return template;
}

function NextSteps({
  primary,
  secondary,
  previewReport,
  supportText,
  onOpenFix,
}: {
  primary: HomeFixCandidate;
  secondary: readonly HomeFixCandidate[];
  previewReport: HomePreviewReport | null;
  supportText: string | null;
  onOpenFix: (step: HomeFixCandidate) => void;
}) {
  return (
    <section className={styles.steps} aria-label={HOME_DECK.nextSteps} data-home-slot="primary">
      <h2 className={styles.srOnly}>{HOME_DECK.nextSteps}</h2>
      <div className={styles.stepGrid}>
        <FixCard
          step={primary}
          primary
          previewReport={previewReport}
          supportText={supportText}
          onOpenFix={onOpenFix}
        />
        {secondary.map((step) => (
          <FixCard
            key={step.kind}
            step={step}
            primary={false}
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
  previewReport,
  supportText,
  onOpenFix,
}: {
  step: HomeFixCandidate;
  primary: boolean;
  previewReport: HomePreviewReport | null;
  supportText: string | null;
  onOpenFix: (step: HomeFixCandidate) => void;
}) {
  if (step.kind === 'unsub_archive') {
    const copy = previewReport?.fix ?? homeFixCopy();
    const namesSenders = previewReport !== null || homeReportNamesSenders();
    if (copy === null || !namesSenders) return null;
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
        {primary ? (
          <h3 className={styles.focusTitle}>
            {fillDeck(
              step.senderCount === 1
                ? HOME_DECK.focus.reviewTitle.one
                : HOME_DECK.focus.reviewTitle.other,
              { n: formatCount(step.senderCount) },
            )}
          </h3>
        ) : (
          <>
            <h3>{heading}</h3>
            {support !== null && <p>{support}</p>}
          </>
        )}
        {primary ? (
          <div className={styles.fixActions}>
            {canPreviewFix(step) ? (
              <button
                type="button"
                data-dm-button=""
                className={`dm-button-link ${styles.primaryAction}`}
                onClick={() => onOpenFix(step)}
              >
                {HOME_DECK.focus.preview}
              </button>
            ) : (
              <PrimaryLink action={{ label: HOME_DECK.focus.review, href: '/senders' }} />
            )}
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
        <Link
          href="/senders"
          className={
            primary ? `dm-button-link ${styles.primaryAction}` : 'dm-external-link dm-tap-target'
          }
        >
          {HOME_DECK.largestCta}
        </Link>
      </article>
    );
  }
  if (step.kind === 'later_due') {
    return <LaterCard step={step} primary={primary} />;
  }
  const unreachable: never = step.kind;
  return unreachable;
}

/** Same clock as the Later row in the shell. The count key is held, so the card shows none. */
const LATER_ICON = 'M12 6v6l4 2M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z';

function LaterCard({ step, primary }: { step: HomeFixCandidate; primary: boolean }) {
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
      {!primary && <p>{HOME_DECK.laterBody}</p>}
      <Link
        href="/later"
        className={
          primary
            ? `dm-button-link ${styles.primaryAction}`
            : `dm-external-link dm-tap-target ${styles.cardAction}`
        }
        onClick={() => {
          void track('home_next_step_clicked', { kind: homeNextStepEventKind('later_due') });
        }}
      >
        {HOME_DECK.laterCta}
      </Link>
    </article>
  );
}

function Progress({ state }: { state: Extract<HomeState, { kind: 'ready' }> }) {
  return (
    <section className={styles.progressLine} aria-label="Progress">
      <h2 className={styles.progressHeading}>{HOME_DECK.focus.progress}</h2>
      <p className={styles.progressSentence}>
        <strong data-testid="home-hero">{state.hero.value.toLocaleString('en-US')}</strong>{' '}
        <span>{state.hero.label}</span>
        <span className={styles.period}>{HOME_DECK.focus.allTime}</span>
      </p>
      {state.secondary.length > 0 && (
        <dl className={styles.progressDetails}>
          {state.secondary.map((stat) => (
            <div key={stat.label}>
              <dt>{stat.label}</dt>
              <dd>{formatCount(stat.value)}</dd>
            </div>
          ))}
        </dl>
      )}
      <Link href="/activity?window=all" className="dm-external-link dm-tap-target">
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
  return <HomeLoadingSlots labelId={labelId} />;
}
