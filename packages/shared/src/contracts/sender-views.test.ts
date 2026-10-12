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
    wroteTo: null,
    protectedFlag: null,
    windowDays: 90,
    domain: null,
    unsubIgnored: false,
    hasInboxMail: false,
    mostlyUnread: false,
  },
  sort: 'total',
  direction: 'desc',
};

describe('parseSenderViews', () => {
  it('returns stored views verbatim', () => {
    expect(parseSenderViews({ senderViews: [VIEW] })).toEqual([VIEW]);
  });

  it('keeps a size sort', () => {
    const sized = { ...VIEW, name: 'Largest', sort: 'size' as const };
    expect(parseSenderViews({ senderViews: [sized] })).toEqual([sized]);
    expect(SenderViewsPutSchema.safeParse({ views: [sized] }).success).toBe(true);
  });

  it('keeps older saved views usable and defaults the Inbox filter off', () => {
    const { hasInboxMail: _removed, ...oldCompose } = VIEW.compose;
    expect(parseSenderViews({ senderViews: [{ ...VIEW, compose: oldCompose }] })).toEqual([VIEW]);
  });

  it('round-trips an Inbox-only saved view', () => {
    const inboxView = { ...VIEW, compose: { ...VIEW.compose, hasInboxMail: true } };
    expect(SenderViewsPutSchema.safeParse({ views: [inboxView] }).success).toBe(true);
    expect(parseSenderViews({ senderViews: [inboxView] })).toEqual([inboxView]);
  });

  it('accepts the mostly-unread filter and defaults it off', () => {
    const on = { ...VIEW, compose: { ...VIEW.compose, mostlyUnread: true } };
    expect(SenderViewsPutSchema.safeParse({ views: [on] }).success).toBe(true);
    expect(parseSenderViews({ senderViews: [on] })).toEqual([on]);
    const { mostlyUnread: _removed, ...older } = on.compose;
    expect(parseSenderViews({ senderViews: [{ ...VIEW, compose: older }] })).toEqual([
      { ...on, compose: { ...older, mostlyUnread: false } },
    ]);
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
