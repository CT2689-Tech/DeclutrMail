import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { BaseSequencer } from 'vitest/node';

import { weightedSequencer } from '../../scripts/vitest-weighted-shard.mjs';

/**
 * apps/api vitest config — `testTimeout`/`hookTimeout` raised because
 * many read-service specs spin up PGlite + apply every migration per
 * `it()`. PGlite 0.4 (bumped from 0.2 in the deps group) made the
 * fixture setup slower on CI than the 10s default `hookTimeout`
 * budget. Mirrors `packages/workers` + `packages/db`.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts', 'src/**/*.spec.tsx'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // CI's `--shard` legs split by recorded file duration, not path hash.
    sequence: {
      sequencer: weightedSequencer(
        BaseSequencer,
        fileURLToPath(new URL('./vitest.shard-weights.json', import.meta.url)),
      ),
    },
  },
});
