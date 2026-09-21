// App Router error boundary (D167 + D170).
//
// Wraps the authed app shell. When a server component throws, or a
// client subtree errors during render, Next.js mounts this component
// with the captured `error` and a `reset()` callback that re-attempts
// render once the upstream is fixed.
//
// What this does:
//
//   1. Auto-fires `Sentry.captureException(error)` on mount via the
//      shared browser bootstrap (`lib/sentry.ts`). The bootstrap is
//      idempotent — re-mounting the boundary will not re-init Sentry.
//      Capture is gated on `NEXT_PUBLIC_SENTRY_DSN` being set, so
//      local dev stays quiet.
//
//   2. Renders calm, branded copy matching D209 microcopy rules. No
//      "Error" / "Oops" / "Something went wrong" placeholders.
//
//   3. Exposes a "Try again" CTA wired to Next's `reset()` prop. A
//      secondary "Back to Triage" link gives the user a way out if
//      the retry would loop.
//
// What this does NOT do:
//
//   - It does not store the error message in the rendered HTML. The
//     `error.digest` (a stable hash Next produces) is surfaced
//     instead, because the message can contain user data and would
//     leak through SSR.

'use client';

import { RouteErrorScreen } from '@/components/route-error-screen';
import { ThemeFallback } from '@/features/theme/theme-fallback';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string | undefined };
  reset: () => void;
}) {
  return (
    <>
      {/* No route group owns the ROOT error boundary, so it gets no
          `<ThemeScript>` — see theme-fallback.tsx for why it resolves
          after hydration here rather than before paint. */}
      <ThemeFallback />
      <RouteErrorScreen
        error={error}
        reset={reset}
        boundary="app-router-error"
        headline="We’ll pick up where you left off."
        body="Your mailbox and decisions are untouched. Try again, or head back to Triage and we’ll retry the rest in the background."
        escape={{ href: '/triage', label: 'Back to Triage' }}
      />
    </>
  );
}
