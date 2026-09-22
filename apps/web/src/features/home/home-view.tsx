'use client';

import Link from 'next/link';
import { ErrorState, ScreenIntro, Skeleton } from '@declutrmail/shared';
import { EditorialKicker, editorialColumnStyle } from '@/features/editorial/page';
import { loadErrorDescription } from '@/lib/load-error-copy';
import { SYNC_FAILED_ACTION, type HomeAction, type HomeStat, type HomeState } from './home-state';
import styles from './home-view.module.css';

/** Real cleanup history and the next available task, with no inferred savings or inbox score. */
export function HomeView({ state }: { state: HomeState }) {
  return (
    <div style={editorialColumnStyle} className={styles.page}>
      <ScreenIntro id="home" title="How Home works" body="Undone actions are not counted." />
      <header className={styles.header}>
        <div>
          <EditorialKicker>Your personal space</EditorialKicker>
          <h1>Home</h1>
          <p className={styles.subtitle}>A clearer view. A little more room for what matters.</p>
        </div>
        <span className={styles.headerNote}>One thoughtful decision at a time.</span>
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
          <div className={styles.summaryGrid}>
            <section className={styles.progress} aria-label="Your cleanup so far">
              <span className={styles.eyebrow}>The space you’ve made</span>
              <span className={styles.number} data-testid="home-hero">
                {state.hero.value.toLocaleString('en-US')}
              </span>
              <p className={styles.numberLabel}>
                {state.hero.label}
                {state.since ? ` since ${formatSince(state.since)}` : ''}
              </p>
              <span className={styles.progressNote}>
                From your recorded decisions. Undone actions are excluded.
              </span>
            </section>
            <section className={styles.nextStep} aria-label="Your next step">
              <span className={styles.eyebrow}>A good place to continue</span>
              <h2>
                Make room
                <br />
                for what’s next.
              </h2>
              <p>
                {state.action.href === '/triage'
                  ? 'Your daily review is ready. Work through one sender at a time, with the detail you need to decide.'
                  : state.action.href === '/screener'
                    ? 'New senders are ready for your attention. Their email keeps arriving until you choose what to do.'
                    : 'Explore your senders, look at their activity, and decide what still belongs in your inbox.'}
              </p>
              <PrimaryLink action={state.action} />
              <span className={styles.footnote}>Preview every change. Keep the final say.</span>
            </section>
          </div>
          {state.secondary.length > 0 && <SecondaryRow stats={state.secondary} />}
          <p className={styles.closing}>Small decisions. A more considered inbox.</p>
        </>
      );
  }
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
