import { WS2_COPY } from '@declutrmail/shared/copy/launch';

import { RouteLoading } from '@/app/(app)/route-loading';

/**
 * The settings segment's streamed fallback (`settings/loading.tsx`).
 *
 * The resolved page's first paint must be this same tree. `loading.tsx`
 * and the page are one Suspense boundary; when the reveal lands during
 * hydration, React hydrates the page into whichever DOM is already
 * showing. A different first paint is React #418.
 */
export function SettingsRouteFallback({
  label = WS2_COPY.simplify.settings.loading,
}: {
  label?: string;
} = {}) {
  return (
    <RouteLoading gap={28} maxWidth={1120} title="Settings" label={label} rows={5} rowHeight={64} />
  );
}
