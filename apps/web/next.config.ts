import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

import { legacyDomainRedirects, wwwApexRedirects } from './src/lib/legacy-domain-redirects';

const nextConfig: NextConfig = {
  transpilePackages: ['@declutrmail/shared'],

  /**
   * `@declutrmail/shared` is imported through its root barrel from ~25
   * marketing files, and that barrel re-exports the whole design system
   * — AppShell, Sidebar, ToastHost, the Zustand ui store. This rewrites
   * barrel imports to their concrete modules at build time. The package
   * now also declares `sideEffects` (D160, 2026-08-18), which lets the
   * bundler prove unreferenced modules are droppable; the two are
   * complementary, and removing either regresses the budget.
   *
   * Measured with `node scripts/check-web-bundle-budget.mjs` either side
   * of the change; keep it only while it earns its place.
   *
   * The SUBPATH barrels have to be listed one by one. `optimizePackage-
   * Imports` matches the import specifier, not the package, so listing
   * `@declutrmail/shared` alone leaves every
   * `from '@declutrmail/shared/contracts'` untouched — and that barrel
   * re-exports ~20 Zod schema modules, so one import of `Envelope` was
   * dragging billing, onboarding, autopilot, account-deletion and the
   * rest of the contract surface onto every authed route. Adding the
   * subpaths took `/senders` 221.5 -> 206.5 kB and `/triage` 211.4 ->
   * 195.9 kB with no source change at all.
   */
  experimental: {
    optimizePackageImports: [
      '@declutrmail/shared',
      '@declutrmail/shared/actions',
      '@declutrmail/shared/contracts',
      '@declutrmail/shared/copy',
      '@declutrmail/shared/entitlements',
      '@declutrmail/shared/flags',
      '@declutrmail/shared/observability',
      '@declutrmail/shared/senders',
    ],
  },

  /**
   * 301 the retired `declutrmail.ai` origin onto the canonical
   * `declutrmail.com` (D128), and 301 `www.declutrmail.com` onto the
   * apex so Google cannot keep www as a second canonical. Host-gated —
   * see the module docblock for why that gate is load-bearing.
   */
  redirects: async () => [...wwwApexRedirects(), ...legacyDomainRedirects()],

  /**
   * Inject the release tag into the PUBLIC env at build time so the
   * browser runtime can read `process.env.NEXT_PUBLIC_SENTRY_RELEASE`.
   *
   * EMPTY, NOT `'local-dev'`, WHEN THERE IS NO COMMIT SHA.
   *
   * Deployed builds are fine and always were — `VERCEL_GIT_COMMIT_SHA`
   * is present, and production events carry real 40-character SHAs. The
   * fallback only fires where that variable is absent, which in
   * practice means a PRODUCTION BUILD RUN LOCALLY (`next build` sets
   * `NODE_ENV=production`, so `environment` resolves to `production`
   * too). Those events then land in the production environment wearing
   * an invented release, indistinguishable at a glance from real
   * deployed errors — that is where Sentry DECLUTRMAIL-WEB-13/16 came
   * from, and chasing them as production bugs cost real time.
   *
   * Empty means the init below omits `release` entirely, so the Sentry
   * build plugin's own injected release applies — the one its uploaded
   * artifacts are filed under, matching by construction rather than by
   * two env lookups agreeing. A wrong release is worse than none: no
   * release still symbolicates, a wrong one never does. And a local
   * build no longer manufactures a release bucket that looks like
   * production.
   */
  env: {
    NEXT_PUBLIC_SENTRY_RELEASE: process.env.VERCEL_GIT_COMMIT_SHA ?? '',
  },

  /**
   * Webpack `extensionAlias` so ESM-style `.js` imports inside transpiled
   * workspace packages resolve to their `.ts` source.
   *
   * `@declutrmail/shared` follows the NodeNext convention of writing
   * `from './scrubber.js'` in TypeScript source — correct for tsc + the
   * NestJS API (which compiles via swc) — but Next.js's Webpack pipeline
   * does not auto-fall-back from `.js` to `.ts` for paths inside
   * `transpilePackages`. Without this alias the dev server fails with
   *   Module not found: Can't resolve './scrubber.js'
   * at the first browser hit that pulls in @declutrmail/shared.
   *
   * Turbopack handles this natively, so this branch only runs under the
   * default Webpack dev/build path. Order matters: `.ts` / `.tsx` come
   * first so source wins over any emitted `.js` siblings (we don't emit
   * any today, but keeps the rule robust).
   */
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};

/**
 * `withSentryConfig` wraps the Next config to:
 *
 *   1. Auto-upload browser + server source maps on every production
 *      build — requires `SENTRY_AUTH_TOKEN` (Sentry → Settings → Auth
 *      Tokens; scopes `project:releases` + `project:write`). Without
 *      the token the build still succeeds but skips upload silently
 *      (so local + preview builds aren't blocked).
 *   2. Auto-tag uploaded artifacts with the release derived from
 *      `VERCEL_GIT_COMMIT_SHA` (matches the `env.NEXT_PUBLIC_SENTRY_
 *      RELEASE` block above so client + server stay in lockstep).
 *   3. Wrap the Next-emitted error pages so server-component throws
 *      reach Sentry via `onRequestError` (defined in
 *      `instrumentation.ts`).
 *
 * Plugin docs: https://docs.sentry.io/platforms/javascript/guides/nextjs/
 */
export default withSentryConfig(nextConfig, {
  // Sentry project identity. Read from env so the values are not
  // hard-coded in the repo (the org + project change per account).
  // Both `SENTRY_ORG` + `SENTRY_PROJECT` are set in Vercel build env +
  // GitHub Actions; locally they live in `.env.local` (gitignored).
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  // Quiet build output unless we're debugging the plugin itself.
  silent: !process.env.SENTRY_DEBUG,

  // Privacy + size: do NOT widen the bundle by tunneling Sentry events
  // through a Next.js API route. Direct ingest is fine; ad-blocker
  // bypass is not a priority for the founder's use case.
  tunnelRoute: undefined,

  // Webpack-scoped Sentry plugin options (Next 15+ canonical shape;
  // the old top-level `disableLogger` + `reactComponentAnnotation`
  // emit deprecation warnings + will be removed).
  webpack: {
    // Tree-shake Sentry's own debug logging from the production
    // bundle — keeps the SDK chunk small.
    treeshake: { removeDebugLogging: true },
    // React component annotation off — adds Sentry-side data attrs to
    // every JSX element, useful for Replay grouping but Replay is OFF
    // here, so the tax buys nothing.
    reactComponentAnnotation: { enabled: false },
  },
});
