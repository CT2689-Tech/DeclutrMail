import { describe, expect, it } from 'vitest';
import { FEATURE_FLAGS, flagEnvKey } from '@declutrmail/shared';

import { WEB_FLAG_ENV } from './flags';

describe('web flag env wiring', () => {
  it('lists a literal NEXT_PUBLIC_* read for every manifest flag', () => {
    // Next.js only inlines literally-written env keys, so this map
    // cannot be generated — this test is the sync contract with the
    // shared manifest.
    for (const flag of FEATURE_FLAGS) {
      expect(
        Object.prototype.hasOwnProperty.call(WEB_FLAG_ENV, flagEnvKey(flag)),
        `WEB_FLAG_ENV is missing ${flagEnvKey(flag)} — add the literal ` +
          `process.env.NEXT_PUBLIC_${flagEnvKey(flag)} read in lib/flags.ts`,
      ).toBe(true);
    }
    expect(Object.keys(WEB_FLAG_ENV)).toHaveLength(FEATURE_FLAGS.length);
  });
});
