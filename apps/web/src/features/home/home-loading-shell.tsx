import { Skeleton } from '@declutrmail/shared';

import { HOME_DECK } from './home-deck-copy';
import styles from './home-view.module.css';

const ROUTE_LOADING_LABEL_ID = 'home-route-loading';

/** Shared slot geometry for Home's loading.tsx and HomeView's pending body. */
export function HomeLoadingSlots({ labelId }: { labelId: string }) {
  return (
    <div role="status" aria-labelledby={labelId} className={styles.skeleton} data-home-skeleton="">
      <span id={labelId} className={styles.srOnly}>
        Loading Home
      </span>
      <div className={styles.focusLead} data-home-slot="primary" aria-hidden="true">
        <div className={styles.loadingRecommendation}>
          <Skeleton variant="rect" width="min(320px, 100%)" height={84} />
          <Skeleton variant="text" width="min(180px, 100%)" height={20} />
          <Skeleton variant="rect" width="min(180px, 100%)" height={44} />
        </div>
      </div>
      <div className={styles.details} data-home-slot="details" aria-hidden="true">
        <Skeleton variant="text" width="min(90px, 100%)" height={44} />
      </div>
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
        <div className={styles.planLine} data-home-slot="quota" aria-hidden="true">
          <Skeleton variant="text" width="min(140px, 100%)" height={14} />
        </div>
      </header>
      <HomeLoadingSlots labelId={ROUTE_LOADING_LABEL_ID} />
    </div>
  );
}
