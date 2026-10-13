import type { ReactNode } from 'react';
import Link from 'next/link';
import { Skeleton } from '@declutrmail/shared';
import { planName } from '@declutrmail/shared/entitlements';

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
      <div className={styles.fixCard} data-home-slot="primary">
        <Skeleton variant="text" width={240} />
        <Skeleton variant="text" width={180} />
        <Skeleton variant="rect" width={210} height={44} />
      </div>
      <div className={styles.visitSlot} data-home-slot="visit">
        {visitSlot}
      </div>
      <section className={styles.report} data-home-slot="report">
        <div className={styles.lead}>
          <Skeleton variant="rect" width={72} height={28} />
        </div>
        <Skeleton variant="text" width={200} />
        <Skeleton variant="text" width={280} />
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
  const plan = planName('free');
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
        <div className={styles.planLine} data-home-slot="plan">
          <span>
            {plan !== null && plan !== '' ? `${plan} · ` : null}
            <Link href={BILLING_HREF} className="dm-external-link dm-tap-target">
              {HOME_DECK.compare}
            </Link>
          </span>
        </div>
      </header>
      <HomeLoadingSlots
        labelId={ROUTE_LOADING_LABEL_ID}
        visitSlot={<Skeleton variant="text" width={220} />}
      />
    </div>
  );
}
