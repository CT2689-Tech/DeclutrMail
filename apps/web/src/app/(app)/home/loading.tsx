import { HomeView } from '@/features/home/home-view';

/**
 * Home's own loading state, from its presentational view: the identical
 * centred skeleton the screen shows while its reads are pending. See
 * `../route-loading.tsx` for why every sidebar route has a `loading.tsx`.
 */
export default function Loading() {
  return <HomeView state={{ kind: 'loading' }} />;
}
