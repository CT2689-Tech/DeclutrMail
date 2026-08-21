import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/next-env.d.ts',
      '**/coverage/**',
      '**/storybook-static/**',
      '.claude/**',
      'pnpm-lock.yaml',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // Frontend packages run in the browser — expose browser globals
    // (window, document, localStorage, …) so no-undef does not fire.
    files: ['apps/web/**/*.{ts,tsx}', 'packages/shared/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },
  {
    // NestJS DI relies on `emitDecoratorMetadata`: a constructor-injected
    // provider must be a *value* import so `design:paramtypes` resolves at
    // runtime. `consistent-type-imports` can't see decorator metadata and
    // would rewrite those to `import type`, breaking DI — disable it here.
    files: ['apps/api/**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    // Hydration determinism (D200): a `toLocale*String` call — or an
    // `Intl.DateTimeFormat`/`Intl.NumberFormat` construction — that
    // falls back to the runtime locale renders one string on the server
    // and a different one in any non-en-US browser, so React discards
    // the whole server tree (error #418 — caught by the e2e hydration
    // smoke under de-DE / Asia/Kolkata). Pin 'en-US' — and pass an
    // explicit `timeZone` (from `useUserTimeZone()`) when the value is
    // an instant and the label can reach server-rendered HTML — or
    // gate the label behind `useNow()`. The zero-arg `Intl.*Format()`
    // form stays allowed: `Intl.DateTimeFormat().resolvedOptions()
    // .timeZone` is the legitimate browser-zone READ.
    files: ['apps/web/src/**/*.{ts,tsx}'],
    rules: {
      // `skipToken` looks like "this observer must never fetch", and it is
      // — but it is also written onto the SHARED query: `useQuery` re-runs
      // `observer.setOptions(query)` in an effect on every render, so the
      // query's resting `queryFn` belongs to whichever observer rendered
      // last. `Query.fetch()` only rescues a FALSY `queryFn`, and skipToken
      // is a truthy symbol, so it slips past into `ensureQueryFn` and any
      // later keyless refetch (`invalidateQueries`) rejects with
      // `Missing queryFn`. That killed the production app on 2026-08-21.
      // `enabled: false` expresses the same intent and is read per-observer,
      // so it cannot disarm anybody else's query. See MISTAKES.md.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@tanstack/react-query',
              importNames: ['skipToken'],
              message:
                "skipToken is written onto the SHARED query and disarms every other observer of that key (Missing queryFn — prod outage 2026-08-21). Use `enabled: false`, which is read per-observer, and spread the owning hook's query options so queryFn/retry cannot diverge.",
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.property.name=/^toLocale(Date|Time)?String$/] > Identifier.arguments[name='undefined']",
          message:
            "toLocale*String(undefined, …) renders with the runtime locale and breaks hydration (React #418). Pin 'en-US' (plus an explicit timeZone for instants in server-rendered HTML).",
        },
        {
          selector:
            'CallExpression[callee.property.name=/^toLocale(Date|Time)?String$/][arguments.length=0]',
          message:
            "toLocale*String() renders with the runtime locale and breaks hydration (React #418). Pin 'en-US' (plus an explicit timeZone for instants in server-rendered HTML).",
        },
        {
          selector:
            ":matches(NewExpression, CallExpression)[callee.object.name='Intl'][callee.property.name=/^(DateTimeFormat|NumberFormat)$/] > Identifier.arguments[name='undefined']",
          message:
            "Intl.*Format(undefined, …) renders with the runtime locale and breaks hydration (React #418). Pin 'en-US' (plus an explicit timeZone for instants in server-rendered HTML).",
        },
      ],
    },
  },
);
