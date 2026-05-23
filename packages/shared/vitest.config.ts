import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    // SSR-only — components render via `react-dom/server`, no jsdom
    // toolchain is wired into the shared package yet.
    environment: 'node',
  },
});
