import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Vite 8 transforms via Oxc. Pin automatic JSX so `.tsx` tests
  // compile without a React import — same contract as apps/web.
  oxc: {
    jsx: { runtime: 'automatic' },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    // SSR-only — components render via `react-dom/server`, no jsdom
    // toolchain is wired into the shared package yet.
    environment: 'node',
  },
});
