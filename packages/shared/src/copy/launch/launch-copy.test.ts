import { describe, expect, it } from 'vitest';

import { expectMatchesDeck } from './expect-matches-deck';
import { WS1_COPY, WS2_COPY, WS3_COPY, WS4_COPY, WS5_COPY } from './index';

describe('launch copy deck snapshots', () => {
  it.each([
    ['ws1', WS1_COPY],
    ['ws2', WS2_COPY],
    ['ws3', WS3_COPY],
    ['ws4', WS4_COPY],
    ['ws5', WS5_COPY],
  ] as const)('%s matches its checked-in deck section', (section, copy) => {
    expectMatchesDeck(section, copy);
  });

  it('fails when a module drifts from the deck section', () => {
    expect(() => expectMatchesDeck('ws1', { extra: 'not in the deck' })).toThrow();
  });
});
