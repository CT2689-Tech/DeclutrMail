import type { ReactNode } from 'react';
import Link from 'next/link';
import { Skeleton } from '@declutrmail/shared';

import { HOME_DECK } from './home-deck-copy';
import styles from './home-view.module.css';

const BILLING_HREF = '/billing?from=%2Fhome';
const ROUTE_LOADING_LABEL_ID = 'home-route-loading';

/** Shared slot geometry for Home's loading.tsx and HomeView's pending body. */
export function HomeLoadingSlots({
  labelId,
  visitSlot,
}: {
  labelId: string;
  visitSlot: ReactNode;
}) {
  return (
    <div role="status" aria-labelledby={labelId} className={styles.skeleton} data-home-skeleton="">
      <span id={labelId} className={styles.srOnly}>
        Loading Home
      </span>
      <div className={styles.focusGrid}>
        <div className={styles.focusLead}>
          <div className={styles.fixCard} data-home-slot="primary">
            <Skeleton variant="text" width="min(160px, 100%)" />
            <Skeleton variant="rect" width="80%" height={96} />
            <Skeleton variant="text" width="90%" />
            <Skeleton variant="rect" width="min(180px, 100%)" height={44} />
          </div>
        </div>
        <div aria-hidden="true" className={styles.progressLine}>
          <Skeleton variant="text" width="min(110px, 100%)" />
          <Skeleton variant="rect" width="min(170px, 100%)" height={48} />
          <Skeleton variant="text" width="min(150px, 100%)" />
        </div>
      </div>
      <div className={styles.visitSlot} data-home-slot="visit">
        {visitSlot}
      </div>
      <section className={styles.report} data-home-slot="report">
        <div className={styles.lead}>
          <Skeleton variant="rect" width="min(72px, 100%)" height={28} />
        </div>
        <Skeleton variant="text" width="min(200px, 100%)" />
        <Skeleton variant="text" width="min(280px, 100%)" />
      </section>
    </div>
  );
}

/**
 * Route-level Suspense fallback. Must not render `HomeView` — that client
 * component also mounts on the resolved page, and hydrating one instance
 * against the other's markup is React #418.
 */
export function HomeRouteLoading() {
  return (
    <div
      className={styles.page}
      data-home-mode="loading"
      data-sender-size-view="off"
      data-home-priority="intro"
      data-home-fix-expected="false"
    >
      <header className={styles.header}>
        <h1>{HOME_DECK.homeTitle}</h1>
        <div className={styles.headerTools}>
          <Link href="/senders" className={styles.reportLink}>
            {HOME_DECK.focus.report}
          </Link>
          <div className={styles.planLine} data-home-slot="plan">
            <span>
              <Skeleton
                variant="text"
                width="min(48px, 100%)"
                height={14}
                style={{ marginRight: 8 }}
              />
              <Link href={BILLING_HREF} className="dm-external-link dm-tap-target">
                {HOME_DECK.compare}
              </Link>
            </span>
          </div>
        </div>
      </header>
      <HomeLoadingSlots
        labelId={ROUTE_LOADING_LABEL_ID}
        visitSlot={<Skeleton variant="text" width="min(220px, 100%)" />}
      />
    </div>
  );
}
