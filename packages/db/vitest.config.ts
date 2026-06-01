import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
    // PGlite migration apply (17 files, ~60 statements split by breakpoint) takes
    // 5–10s under CI parallel-worker CPU contention. Default 10s hookTimeout
    // intermittently times out senders-total-received's beforeEach. Match
    // testTimeout so migration-heavy hooks don't trip the wall before the
    // tests themselves have a chance.
    hookTimeout: 30000,
  },
});
