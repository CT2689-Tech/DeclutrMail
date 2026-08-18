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
