'use client';

import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState, type MouseEvent } from 'react';
import { useOptionalAuth } from '@/features/auth/auth-provider';
import { useMailboxScopeReset } from '@/features/mailboxes/use-mailbox-scope-reset';
import { useCachedScreenerCount } from '@/features/screener/api/use-screener';
import { SendersScreen } from '@/features/senders/senders-screen';
import { useHydrated } from '@/lib/use-hydrated';
import { hasCapability } from '@declutrmail/shared/entitlements';
import { ScreenIntro } from '@declutrmail/shared';
import { cleanupView, cleanupViewHref, type CleanupView } from './cleanup-view';
import styles from './cleanup-workspace.module.css';

const FirstReviewWorkspace = dynamic(() =>
  import('@/features/senders/first-review-workspace').then((module) => module.FirstReviewWorkspace),
);

export function CleanupViewNavigation({
  view,
  pending,
  onChange,
  search = '',
}: {
  view: CleanupView;
  pending?: number | undefined;
  onChange: (view: CleanupView) => void;
  search?: string;
}) {
  const navigate = (event: MouseEvent<HTMLAnchorElement>, next: CleanupView) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    onChange(next);
  };
  return (
    <nav aria-label="Senders views" className={styles.views}>
      <a
        href={cleanupViewHref('all', search)}
        aria-current={view === 'all' ? 'page' : undefined}
        onClick={(e) => navigate(e, 'all')}
      >
        All senders
      </a>
      <a
        href={cleanupViewHref('first-review', search)}
        aria-current={view === 'first-review' ? 'page' : undefined}
        onClick={(e) => navigate(e, 'first-review')}
      >
        Needs first review
        {pending !== undefined && (
          <span aria-label={`${pending} senders awaiting first review`}>{pending}</span>
        )}
      </a>
    </nav>
  );
}

/** Keep visited action owners alive while only one workspace accepts input. */
export function CleanupWorkspace() {
  const params = useSearchParams();
  const requestedView = cleanupView(params.get('view'));
  const [view, setView] = useState<CleanupView>(requestedView);
  const [visitedFirstReview, setVisitedFirstReview] = useState(requestedView === 'first-review');
  const auth = useOptionalAuth();
  const hydrated = useHydrated();
  const cachedPending = useCachedScreenerCount();

  useEffect(() => {
    setView(requestedView);
    if (requestedView === 'first-review') setVisitedFirstReview(true);
  }, [requestedView]);

  const changeView = useCallback((next: CleanupView) => {
    if (next === 'first-review') setVisitedFirstReview(true);
    setView(next);
    // The client query owners already have their scope. Avoid an RSC navigation
    // replacing them or fetching the same list twice during a review transition.
    window.history.pushState(
      null,
      '',
      cleanupViewHref(next, window.location.search) + window.location.hash,
    );
  }, []);
  const reset = useCallback(() => {
    // A visited owner may still reconcile a job in the previous mailbox.
    // Its own scope reset clears visible rows/previews without dropping polls.
    setView('all');
    window.history.replaceState(null, '', cleanupViewHref('all', window.location.search));
  }, []);
  useMailboxScopeReset(auth?.me.activeMailboxId ?? undefined, reset);
  const navigation = (
    <CleanupViewNavigation
      view={view}
      pending={
        hydrated && auth && hasCapability(auth.me.tier, 'screener') ? cachedPending : undefined
      }
      search={params.toString()}
      onChange={changeView}
    />
  );
  const firstReview = view === 'first-review';
  return (
    <>
      <div hidden={firstReview} inert={firstReview}>
        <SendersScreen
          guided={view === 'guided'}
          active={!firstReview}
          navigation={navigation}
          showIntro={false}
          onStartGuided={() => changeView('guided')}
          onExitGuided={() => changeView('all')}
        />
      </div>
      {(visitedFirstReview || firstReview) && (
        <div hidden={!firstReview} inert={!firstReview}>
          <FirstReviewWorkspace navigation={navigation} active={firstReview} />
        </div>
      )}
      <ScreenIntro
        id="senders"
        title={
          firstReview
            ? 'How first review works'
            : view === 'guided'
              ? 'How guided review works'
              : 'How Senders works'
        }
        body={
          firstReview
            ? 'Review new senders in context, then decide what to do. Their email keeps arriving until you decide.'
            : view === 'guided'
              ? 'Review one sender at a time. Next leaves the sender unchanged. You’ll see a preview before moving any email.'
              : 'Archive, Later and Delete change email you already have; Unsubscribe asks the sender to stop.'
        }
        learnMore={{
          href: '/help',
          label: 'Learn about Keep, Archive, Unsubscribe, Later and Delete',
        }}
      />
    </>
  );
}
