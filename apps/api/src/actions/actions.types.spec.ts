import { describe, expect, it } from 'vitest';

import { unsubscribeIntentRequestSchema } from './actions.types.js';

const SENDER_ID = '00000000-0000-4000-8000-000000000001';

describe('unsubscribeIntentRequestSchema', () => {
  it('defaults the optional backlog preflight flag to false', () => {
    expect(unsubscribeIntentRequestSchema.parse({ senderId: SENDER_ID })).toEqual({
      senderId: SENDER_ID,
      includesBacklogAction: false,
    });
  });

  it('accepts an explicit strict boolean and rejects unknown fields', () => {
    expect(
      unsubscribeIntentRequestSchema.parse({
        senderId: SENDER_ID,
        includesBacklogAction: true,
      }),
    ).toEqual({ senderId: SENDER_ID, includesBacklogAction: true });
    expect(
      unsubscribeIntentRequestSchema.safeParse({
        senderId: SENDER_ID,
        includesBacklogAction: 'true',
      }).success,
    ).toBe(false);
    expect(
      unsubscribeIntentRequestSchema.safeParse({ senderId: SENDER_ID, backlog: true }).success,
    ).toBe(false);
  });
});
