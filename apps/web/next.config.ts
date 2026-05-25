import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@declutrmail/shared'],

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

export default nextConfig;
