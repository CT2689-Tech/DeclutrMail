import { describe, expect, it } from 'vitest';

import { compositeActionRequestSchema } from './actions.types.js';

const selector = { type: 'sender' as const, senderId: '00000000-0000-4000-8000-000000000001' };

describe('compositeActionRequestSchema — D245 Later schedule', () => {
  it('requires a future wakeAt for Later', () => {
    expect(
      compositeActionRequestSchema.safeParse({ selector, primary: { type: 'later' } }).success,
    ).toBe(false);
    expect(
      compositeActionRequestSchema.safeParse({
        selector,
        primary: { type: 'later', wakeAt: '2099-07-21T09:00:00.000Z' },
      }).success,
    ).toBe(true);
  });

  it('rejects a past wakeAt and wakeAt on other verbs', () => {
    expect(
      compositeActionRequestSchema.safeParse({
        selector,
        primary: { type: 'later', wakeAt: '2020-01-01T00:00:00.000Z' },
      }).success,
    ).toBe(false);
    expect(
      compositeActionRequestSchema.safeParse({
        selector,
        primary: { type: 'archive', wakeAt: '2099-07-21T09:00:00.000Z' },
      }).success,
    ).toBe(false);
  });
});
