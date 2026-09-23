'use client';

import Link from 'next/link';
import { ErrorState, ScreenIntro, Skeleton } from '@declutrmail/shared';
import {
  hasCapability,
  minimumTierForCapability,
  TIER_MANIFEST,
  type TierId,
} from '@declutrmail/shared/entitlements';
import { EditorialKicker } from '@/features/editorial/page';
import { loadErrorDescription } from '@/lib/load-error-copy';
import { SYNC_FAILED_ACTION, type HomeAction, type HomeStat, type HomeState } from './home-state';
import type { HomeSenderPreview } from './api/use-home-pending';
import type { HomeWorkflows } from './api/use-home-workflows';
import styles from './home-view.module.css';

/** Real cleanup history and the next available task, with no inferred savings or inbox score. */
export function HomeView({
  state,
  tier = 'free',
  workflows,
}: {
  state: HomeState;
  tier?: TierId;
  workflows?: HomeWorkflows | undefined;
}) {
  return (
    <div className={styles.page}>
      <ScreenIntro id="home" title="How Home works" body="Undone actions are not counted." />
      <header className={styles.header}>
        <div>
          <EditorialKicker>Your personal space / Home</EditorialKicker>
          <h1>
            A little room
            <br />
            for a <em>clearer day.</em>
          </h1>
          <p className={styles.subtitle}>A clearer view. A little more room for what matters.</p>
        </div>
        {state.kind === 'ready' && (
          <section className={styles.stamp} aria-label="Your cleanup so far">
            <span className={styles.eyebrow}>
              The space
              <br />
              you’ve made
            </span>
            <strong data-testid="home-hero">{state.hero.value.toLocaleString('en-US')}</strong>
            <span>
              {state.hero.label}
              {state.since ? ` since ${formatSince(state.since)}` : ''}
            </span>
            <small>Undone actions excluded</small>
          </section>
        )}
      </header>
      <HomeBody state={state} tier={tier} workflows={workflows} />
    </div>
  );
}

function HomeBody({
  state,
  tier,
  workflows,
}: {
  state: HomeState;
  tier: TierId;
  workflows?: HomeWorkflows | undefined;
}) {
  const hasAttention =
    state.kind === 'ready' &&
    (state.action.href !== '/senders' ||
      (state.pending?.triagePending ?? 0) > 0 ||
      (state.pending?.screenerPending ?? 0) > 0);
  switch (state.kind) {
    case 'loading':
      return <HomeSkeleton />;
    case 'error':
      return (
        <ErrorState
          title="We couldn't load Home"
          description={loadErrorDescription(state.error)}
          onRetry={state.retry}
        />
      );
    case 'empty':
      return (
        <section
          className={state.senders?.length ? styles.summaryGrid : styles.beginning}
          aria-label="Your next step"
        >
          <div className={state.senders?.length ? styles.nextStep : undefined}>
            <span className={styles.eyebrow}>
              {state.syncing ? 'Getting the picture' : 'A fresh start'}
            </span>
            <h2>
              {state.syncing
                ? 'Reading your inbox'
                : state.senders?.length
                  ? 'Your first review is ready'
                  : 'Nothing cleared yet'}
            </h2>
            <p>
              {state.syncing
                ? 'Your first scan is in progress. Available senders are ready to explore as the picture comes together.'
                : 'Start with the senders in your inbox. See their activity, then decide what deserves a place.'}
            </p>
            <PrimaryLink action={state.action} />
            <span className={styles.footnote}>You’ll see a preview before email is moved.</span>
          </div>
          {!!state.senders?.length && (
            <div className={styles.opportunityList}>
              <SenderPreviews senders={state.senders} />
            </div>
          )}
        </section>
      );
    case 'sync-failed':
      return (
        <section className={styles.beginning} aria-label="Mailbox needs attention">
          <span className={styles.eyebrow}>Connection needs attention</span>
          <h2>Gmail scan failed</h2>
          <p>Open your Gmail account settings to review the connection and try again.</p>
          <PrimaryLink action={SYNC_FAILED_ACTION} />
        </section>
      );
    case 'ready':
      return (
        <>
          <section className={styles.summaryGrid} aria-label="Your next step">
            <div className={styles.nextStep}>
              <span className={styles.eyebrow}>A good place to start</span>
              <h2>
                A few decisions.<span className={styles.nextLine}>A little more space.</span>
              </h2>
              <p>
                {state.action.href === '/triage'
                  ? 'Your daily review is ready. Take a look at these senders and decide what still belongs.'
                  : state.action.href === '/screener'
                    ? 'Senders awaiting a first decision are ready for your attention. Their email keeps arriving until you choose what to do.'
                    : 'Explore your senders, look at their activity, and decide what still belongs in your inbox.'}
              </p>
              <PrimaryLink action={state.action} />
              <span className={styles.footnote}>Nothing changes until you confirm.</span>
            </div>
            <div className={styles.opportunityList}>
              {state.senders && state.senders.length > 0 ? (
                <SenderPreviews senders={state.senders} />
              ) : (
                <>
                  <span className={styles.eyebrow}>Your recorded progress</span>
                  {state.secondary.length > 0 ? (
                    <SecondaryRow stats={state.secondary} />
                  ) : (
                    <p className={styles.quietCopy}>
                      Every considered decision makes room for what matters. Explore your senders to
                      find your next step.
                    </p>
                  )}
                  <p className={styles.footnote}>
                    From your cleanup history. Undone actions are excluded.
                  </p>
                </>
              )}
            </div>
          </section>
          <section
            className={styles.overviewLower}
            style={!hasAttention ? { gridTemplateColumns: '1fr' } : undefined}
          >
            {hasAttention && (
              <div className={styles.attention}>
                <h2>A little attention.</h2>
                {state.action.href !== '/triage' &&
                  state.pending?.triagePending != null &&
                  state.pending.triagePending > 0 && (
                    <AttentionLink
                      href="/triage"
                      title={`${state.pending.triagePending.toLocaleString('en-US')} to review today`}
                      description="One sender at a time, with the detail to decide."
                    />
                  )}
                {state.action.href !== '/screener' &&
                  state.pending?.screenerPending != null &&
                  state.pending.screenerPending > 0 && (
                    <AttentionLink
                      href="/screener"
                      title={`${state.pending.screenerPending.toLocaleString('en-US')} unreviewed senders`}
                      description="Give each sender a first decision on your terms."
                    />
                  )}
                {state.action.href !== '/senders' && (
                  <AttentionLink
                    href="/senders"
                    title="See your senders"
                    description="Revisit the senders that have a place in your inbox."
                  />
                )}
              </div>
            )}
            <div
              className={styles.activity}
              style={!hasAttention ? { borderLeft: 0, paddingLeft: 0 } : undefined}
            >
              <span className={styles.eyebrow}>Small decisions add up</span>
              <h2>
                More space.
                <br />
                Less second-guessing.
              </h2>
              <p>
                Your cleanup history keeps every outcome in view, with Undo available for supported
                actions.
              </p>
              <Link href="/activity">
                See your activity <span aria-hidden="true">↗</span>
              </Link>
            </div>
          </section>
          <WorkspaceOverview tier={tier} workflows={workflows} />
          {state.senders && state.senders.length > 0 && state.secondary.length > 0 && (
            <SecondaryRow stats={state.secondary} />
          )}
          <p className={styles.closing}>A considered inbox, one decision at a time.</p>
        </>
      );
  }
}

function WorkspaceOverview({
  tier,
  workflows,
}: {
  tier: TierId;
  workflows?: HomeWorkflows | undefined;
}) {
  const access = (capability: 'brief' | 'followups' | 'snoozed' | 'autopilot' | 'quiet') =>
    hasCapability(tier, capability)
      ? undefined
      : `Included with ${TIER_MANIFEST[minimumTierForCapability(capability)].name}`;
  const briefStatus = workflows?.brief
    ? workflows.brief.opened
      ? "Today's edition read"
      : workflows.brief.replyCount > 0
        ? `${workflows.brief.replyCount} ${workflows.brief.replyCount === 1 ? 'reply' : 'replies'} to consider`
        : "Today's edition is ready"
    : 'Open the latest edition';
  const followupStatus =
    workflows?.followups === null || workflows?.followups === undefined
      ? 'See conversations awaiting a reply'
      : workflows.followups === 0
        ? 'No conversations waiting'
        : `${workflows.followups} ${workflows.followups === 1 ? 'conversation' : 'conversations'} waiting`;
  const suggestionStatus =
    workflows?.suggestions === null || workflows?.suggestions === undefined
      ? 'Inspect rules and suggestions'
      : workflows.suggestions === 0
        ? 'No suggestions waiting'
        : `${workflows.suggestions === 50 ? '50+' : workflows.suggestions} suggestions to review`;

  return (
    <section className={styles.workflows} aria-labelledby="workflows-title">
      <div className={styles.workflowsHeading}>
        <span className={styles.eyebrow}>Your workspace</span>
        <h2 id="workflows-title">The rest of your day, in view.</h2>
        <p>Pick up a conversation, check what will return, or let a rule handle the repeat work.</p>
      </div>
      <div className={styles.workflowGrid}>
        <div className={styles.workflowGroup}>
          <h3>Catch up</h3>
          <WorkflowLink
            href="/brief"
            title="Daily Brief"
            detail={briefStatus}
            locked={access('brief')}
          />
          <WorkflowLink
            href="/followups"
            title="Follow-ups"
            detail={followupStatus}
            locked={access('followups')}
          />
          <WorkflowLink
            href="/later"
            title="Later"
            detail="See what is set to return"
            locked={access('snoozed')}
          />
        </div>
        <div className={styles.workflowGroup}>
          <h3>Keep it clear</h3>
          <WorkflowLink
            href="/autopilot"
            title="Autopilot"
            detail={suggestionStatus}
            locked={access('autopilot')}
          />
          <WorkflowLink
            href="/quiet"
            title="Quiet Hours"
            detail="Choose when the inbox can wait"
            locked={access('quiet')}
          />
          <WorkflowLink
            href="/activity"
            title="Activity & Undo"
            detail="See decisions and recover supported actions"
          />
        </div>
      </div>
    </section>
  );
}

function WorkflowLink({
  href,
  title,
  detail,
  locked,
}: {
  href: string;
  title: string;
  detail: string;
  locked?: string | undefined;
}) {
  return (
    <Link href={href} className={styles.workflowLink}>
      <span>
        <strong>{title}</strong>
        <small>{locked ?? detail}</small>
      </span>
      <span aria-hidden="true">↗</span>
    </Link>
  );
}

function SenderPreviews({ senders }: { senders: HomeSenderPreview[] }) {
  return (
    <>
      <div className={styles.listLabel}>
        <span>Sender</span>
        <span>In inbox now</span>
      </div>
      {senders.map((sender) => (
        <Link
          className={styles.senderRow}
          key={sender.id}
          href={`/senders?sender=${encodeURIComponent(sender.id)}`}
        >
          <span className={styles.avatar} aria-hidden="true">
            {sender.name.slice(0, 1)}
          </span>
          <span className={styles.senderIdentity}>
            <strong>{sender.name}</strong>
            <small>{sender.domain}</small>
          </span>
          <span className={styles.senderCount}>
            {sender.inboxCount.toLocaleString('en-US')}
            <small>emails</small>
          </span>
          <span aria-hidden="true">↗</span>
        </Link>
      ))}
      <p className={styles.footnote}>
        From your daily review queue. Preview confirms the exact scope.
      </p>
    </>
  );
}

function AttentionLink({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description: string;
}) {
  return (
    <Link href={href} className={styles.attentionLink}>
      <span className={styles.attentionIcon} aria-hidden="true">
        ↗
      </span>
      <span>
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      <span aria-hidden="true">→</span>
    </Link>
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
  return (
    <Link href={action.href} data-dm-button="" className={styles.primary}>
      {action.label}
      <span aria-hidden="true">↗</span>
    </Link>
  );
}

function HomeSkeleton() {
  return (
    <div role="status" aria-label="Loading Home" className={styles.summaryGrid}>
      <div className={styles.progress}>
        <Skeleton variant="text" width={160} />
        <Skeleton variant="rect" width={210} height={90} />
        <Skeleton variant="text" width={180} />
      </div>
      <div className={styles.nextStep}>
        <Skeleton variant="text" width={150} />
        <Skeleton variant="rect" width={210} height={80} />
        <Skeleton variant="text" width={180} />
        <Skeleton variant="rect" width={180} height={44} />
      </div>
    </div>
  );
}

function formatSince(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}
