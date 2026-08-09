// Storybook seed (D210 / D187 PR 3).
//
// Stories across this repo were written long before Storybook was
// installed, using local CSF3 shims so they typechecked without
// `@storybook/react` present. Those shims are structurally CSF3
// (default-export meta + named exports carrying `args` / `render`), so
// they load unchanged — the seed adds the runtime, not a rewrite.
//
// Builder is `@storybook/nextjs-vite`: the app is Next.js App Router,
// and the components under test import `next/link`, `next/navigation`
// and the `@/` path alias. A generic react-vite builder would need all
// three stubbed by hand.

import type { StorybookConfig } from '@storybook/nextjs-vite';

const config: StorybookConfig = {
  // `packages/shared` components are promoted primitives with their own
  // stories (D199/D220), so the glob deliberately reaches outside
  // apps/web — a design system whose primitives are invisible in
  // Storybook is the drift D210 exists to prevent.
  stories: ['../src/**/*.stories.@(ts|tsx)', '../../../packages/shared/src/**/*.stories.@(ts|tsx)'],
  addons: [],
  framework: {
    name: '@storybook/nextjs-vite',
    options: {},
  },
  // Autodocs only where a story opts in via `tags: ['autodocs']`, which
  // is what the existing story files already declare.
  docs: { autodocs: 'tag' },
  typescript: {
    // The repo typechecks in CI (`pnpm typecheck`); re-running a full
    // program check inside the Storybook build would double the cost
    // for no extra signal.
    check: false,
  },
};

export default config;
