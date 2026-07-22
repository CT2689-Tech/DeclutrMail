import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

import { legacyDomainRedirects } from './src/lib/legacy-domain-redirects';

const nextConfig: NextConfig = {
  transpilePackages: ['@declutrmail/shared'],

  /**
   * 301 the retired `declutrmail.ai` origin onto the canonical
   * `declutrmail.com` (D128). Host-gated — see the module docblock for
   * why that gate is load-bearing.
   */
  redirects: async () => legacyDomainRedirects(),

  /**
   * Inject release tag into the PUBLIC env at build time so
   * `sentry.client.config.ts` can read it via
   * `process.env.NEXT_PUBLIC_SENTRY_RELEASE`. `VERCEL_GIT_COMMIT_SHA`
   * is a Vercel-system env var auto-injected at build (do NOT set it
   * manually); fallback `'local-dev'` keeps local builds deterministic
   * AND keeps any local-build errors in their own Sentry release
   * bucket. The server runtime uses `SENTRY_RELEASE` (also auto-set
   * by `withSentryConfig` below — this `env` block only matters for
   * the browser bundle).
   */
  env: {
    NEXT_PUBLIC_SENTRY_RELEASE: process.env.VERCEL_GIT_COMMIT_SHA ?? 'local-dev',
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
