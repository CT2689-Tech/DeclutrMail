import { RouteLoading } from '@/app/(app)/route-loading';

/**
 * The settings segment's streamed fallback (`settings/loading.tsx`).
 *
 * The resolved page's first paint must be this same tree. `loading.tsx`
 * and the page are one Suspense boundary; when the reveal lands during
 * hydration, React hydrates the page into whichever DOM is already
 * showing. A different first paint is React #418.
 */
export function SettingsRouteFallback() {
  return (
    <RouteLoading
      gap={32}
      kicker="Settings"
      title="Settings"
      label="Loading settings"
      rows={5}
      rowHeight={56}
    />
  );
}
