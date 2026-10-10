'use client';

import dynamic from 'next/dynamic';

/** Deletion status is fetched after hydration. Keep its rare-state UI out
 * of every route's initial bundle; the pending banner still mounts once. */
export const GracePeriodBanner = dynamic(
  () => import('./grace-period-banner').then((module) => module.GracePeriodBanner),
  { ssr: false },
);
