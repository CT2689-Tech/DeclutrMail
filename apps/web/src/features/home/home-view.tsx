'use client';

import Link from 'next/link';
import { ErrorState, ScreenIntro, Skeleton } from '@declutrmail/shared';
import { EditorialKicker } from '@/features/editorial/page';
import { loadErrorDescription } from '@/lib/load-error-copy';
import { SYNC_FAILED_ACTION, type HomeAction, type HomeStat, type HomeState } from './home-state';
import styles from './home-view.module.css';

/** Real cleanup history and the next available task, with no inferred savings or inbox score. */
export function HomeView({ state }: { state: HomeState }) {
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
      <HomeBody state={state} />
    </div>
  );
}

function HomeBody({ state }: { state: HomeState }) {
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
        <section className={styles.beginning} aria-label="Your next step">
          <span className={styles.eyebrow}>
            {state.syncing ? 'Getting the picture' : 'A fresh start'}
          </span>
          <h2>{state.syncing ? 'Reading your inbox' : 'Nothing cleared yet'}</h2>
          <p>
            {state.syncing
              ? 'Your first scan is in progress. Available senders are ready to explore as the picture comes together.'
              : 'Start with the senders in your inbox. See their activity, then decide what deserves a place.'}
          </p>
          <PrimaryLink action={state.action} />
          <span className={styles.footnote}>You’ll see a preview before email is moved.</span>
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
                A few decisions.
                <br />A little more space.
              </h2>
              <p>
                {state.action.href === '/triage'
                  ? 'Your daily review is ready. Take a look at these senders and decide what still belongs.'
                  : state.action.href === '/screener'
                    ? 'New senders are ready for your attention. Their email keeps arriving until you choose what to do.'
                    : 'Explore your senders, look at their activity, and decide what still belongs in your inbox.'}
              </p>
              <PrimaryLink action={state.action} />
              <span className={styles.footnote}>Nothing changes until you confirm.</span>
            </div>
            <div className={styles.opportunityList}>
              {state.senders && state.senders.length > 0 ? (
                <>
                  <div className={styles.listLabel}>
                    <span>Sender</span>
                    <span>Last 90 days</span>
                  </div>
                  {state.senders.map((sender) => (
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
                        {sender.recentCount.toLocaleString('en-US')}
                        <small>emails</small>
                      </span>
                      <span aria-hidden="true">↗</span>
                    </Link>
                  ))}
                  <p className={styles.footnote}>
                    From your daily review queue. Counts cover the last 90 days.
                  </p>
                </>
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
          <section className={styles.overviewLower}>
            <div className={styles.attention}>
              <h2>A little attention.</h2>
              {state.pending?.triagePending != null && state.pending.triagePending > 0 && (
                <AttentionLink
                  href="/triage"
                  title={`${state.pending.triagePending.toLocaleString('en-US')} to review today`}
                  description="One sender at a time, with the detail to decide."
                />
              )}
              {state.pending?.screenerPending != null && state.pending.screenerPending > 0 && (
                <AttentionLink
                  href="/screener"
                  title={`${state.pending.screenerPending.toLocaleString('en-US')} new senders`}
                  description="Review unfamiliar senders on your terms."
                />
              )}
              <AttentionLink
                href="/senders"
                title="See your senders"
                description="Revisit the senders that have a place in your inbox."
              />
            </div>
            <div className={styles.activity}>
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
          {state.senders && state.senders.length > 0 && state.secondary.length > 0 && (
            <SecondaryRow stats={state.secondary} />
          )}
          <p className={styles.closing}>A considered inbox, one decision at a time.</p>
        </>
      );
  }
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
