import { describe, expect, it } from 'vitest';

import {
  parseSenderViews,
  SENDER_VIEWS_CAP,
  SenderViewsPutSchema,
  type SavedSenderView,
} from './sender-views';

const VIEW: SavedSenderView = {
  name: 'Unsub ready + quiet',
  compose: {
    activity: 'quiet',
    activityNegate: false,
    unsubReady: true,
    replied: null,
    protectedFlag: null,
    windowDays: 90,
    domain: null,
    unsubIgnored: false,
  },
  sort: 'total',
  direction: 'desc',
};

describe('parseSenderViews', () => {
  it('returns stored views verbatim', () => {
    expect(parseSenderViews({ senderViews: [VIEW] })).toEqual([VIEW]);
  });

  it('degrades a missing / malformed key to [] without throwing', () => {
    expect(parseSenderViews({})).toEqual([]);
    expect(parseSenderViews(null)).toEqual([]);
    expect(parseSenderViews({ senderViews: 'garbage' })).toEqual([]);
    expect(parseSenderViews({ senderViews: [{ name: '' }] })).toEqual([]);
  });

  it('rejects a bag above the cap (degrades to [])', () => {
    const many = Array.from({ length: SENDER_VIEWS_CAP + 1 }, (_, i) => ({
      ...VIEW,
      name: `v${i}`,
    }));
    expect(parseSenderViews({ senderViews: many })).toEqual([]);
  });
});

describe('SenderViewsPutSchema', () => {
  it('accepts a full-replace body at the cap', () => {
    const views = Array.from({ length: SENDER_VIEWS_CAP }, (_, i) => ({
      ...VIEW,
      name: `v${i}`,
    }));
    expect(SenderViewsPutSchema.safeParse({ views }).success).toBe(true);
  });

  it('rejects above-cap, unknown keys, and blank names', () => {
    const over = Array.from({ length: SENDER_VIEWS_CAP + 1 }, (_, i) => ({
      ...VIEW,
      name: `v${i}`,
    }));
    expect(SenderViewsPutSchema.safeParse({ views: over }).success).toBe(false);
    expect(SenderViewsPutSchema.safeParse({ views: [], extra: 1 }).success).toBe(false);
    expect(SenderViewsPutSchema.safeParse({ views: [{ ...VIEW, name: '   ' }] }).success).toBe(
      false,
    );
  });
});
