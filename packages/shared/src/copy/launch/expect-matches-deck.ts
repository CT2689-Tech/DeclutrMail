import { readFileSync } from 'node:fs';

import { expect } from 'vitest';

/**
 * Assert `copy` equals the checked-in deck section
 * `packages/shared/src/copy/launch/deck/<section>.json`.
 * An unfilled key fails the snapshot, so a surface cannot ship uncopied.
 */
export function expectMatchesDeck(section: string, copy: object): void {
  const deck = JSON.parse(
    readFileSync(new URL(`./deck/${section}.json`, import.meta.url), 'utf8'),
  ) as unknown;
  expect(copy).toEqual(deck);
}
