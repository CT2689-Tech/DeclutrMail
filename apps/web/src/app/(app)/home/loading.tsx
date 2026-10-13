import { HomeRouteLoading } from '@/features/home/home-loading-shell';

/**
 * Home's route-level Suspense fallback. Uses the same slot geometry as
 * HomeView's pending body, but must not mount `HomeView` itself — that
 * client component also renders on the resolved page. See
 * `../route-loading.tsx` for why every sidebar route has a `loading.tsx`.
 */
export default function Loading() {
  return <HomeRouteLoading />;
}
