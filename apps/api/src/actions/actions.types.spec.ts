import { describe, expect, it } from 'vitest';

import {
  compositeActionRequestSchema,
  unsubscribeIntentRequestSchema,
  unsubscribeManualStatusRequestSchema,
} from './actions.types.js';

const selector = { type: 'sender' as const, senderId: '00000000-0000-4000-8000-000000000001' };
const SENDER_ID = selector.senderId;

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

  it('rejects a message selection because Later returns mail per sender', () => {
    expect(
      compositeActionRequestSchema.safeParse({
        selector: { type: 'messages', messageIds: ['message-1'] },
        primary: { type: 'later', wakeAt: '2099-07-21T09:00:00.000Z' },
      }).success,
    ).toBe(false);
  });
});

describe('unsubscribeManualStatusRequestSchema', () => {
  it('allows only explicit manual-mailto progress states', () => {
    expect(
      unsubscribeManualStatusRequestSchema.safeParse({
        senderId: selector.senderId,
        status: 'draft_opened',
      }).success,
    ).toBe(true);
    expect(
      unsubscribeManualStatusRequestSchema.safeParse({
        senderId: selector.senderId,
        status: 'user_marked_sent',
      }).success,
    ).toBe(true);
    expect(
      unsubscribeManualStatusRequestSchema.safeParse({
        senderId: selector.senderId,
        status: 'endpoint_accepted',
      }).success,
    ).toBe(false);
  });
});

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
