import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const flag = vi.hoisted(() => ({ enabled: false }));

vi.mock('@/lib/flags', () => ({
  isFeatureEnabled: () => flag.enabled,
}));

import { GmailOpenLinkService } from './open-link';

describe('GmailOpenLinkService', () => {
  beforeEach(() => {
    flag.enabled = false;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('binds direct all-mail links to the mailbox instead of /u/0', () => {
    expect(
      GmailOpenLinkService.buildOpenLink({
        mailboxEmail: 'owner+work@example.com',
        gmailMessageId: 'msg/123',
      }),
    ).toBe('https://mail.google.com/mail/?authuser=owner%2Bwork%40example.com#all/msg%2F123');
  });

  it('builds the D231 sender/subject/date fallback without Message-ID', () => {
    expect(
      GmailOpenLinkService.buildOpenLink({
        mailboxEmail: 'owner@example.com',
        gmailMessageId: 'msg-1',
        senderEmail: 'news@example.com',
        subject: 'Quarterly "hello"',
        internalDate: '2026-07-12T23:30:00.000Z',
        forceSearchFallback: true,
      }),
    ).toBe(
      'https://mail.google.com/mail/?authuser=owner%40example.com#search/' +
        'from%3A%22news%40example.com%22%20subject%3A%22Quarterly%20%5C%22hello%5C%22%22%20' +
        'after%3A2026%2F07%2F11%20before%3A2026%2F07%2F13',
    );
  });

  it('falls back to a narrow search when no Gmail resource id is available', () => {
    const url = GmailOpenLinkService.buildOpenLink({
      mailboxEmail: 'owner@example.com',
      senderEmail: 'sender@example.com',
      internalDate: new Date('2026-01-02T12:00:00.000Z'),
    });
    expect(url).toContain('authuser=owner%40example.com#search/');
    expect(url).toContain('from%3A%22sender%40example.com%22');
  });

  it('uses the actual feature flag and fails closed without fallback fields', () => {
    flag.enabled = true;
    expect(
      GmailOpenLinkService.buildOpenLink({
        mailboxEmail: 'owner@example.com',
        gmailMessageId: 'msg-1',
      }),
    ).toBeNull();
  });

  it('uses search for a stale resource id and #all for a fresh one', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-12T12:00:00.000Z'));
    const common = {
      mailboxEmail: 'owner@example.com',
      gmailMessageId: 'msg-1',
      senderEmail: 'sender@example.com',
      subject: 'Status',
      internalDate: '2026-07-10T12:00:00.000Z',
    };

    expect(
      GmailOpenLinkService.buildOpenLink({
        ...common,
        syncedAt: '2026-07-10T12:00:00.000Z',
      }),
    ).toContain('#search/');
    expect(
      GmailOpenLinkService.buildOpenLink({
        ...common,
        syncedAt: '2026-07-12T11:00:00.000Z',
      }),
    ).toContain('#all/msg-1');
  });

  it('quotes sender data so it cannot inject Gmail search operators', () => {
    const url = GmailOpenLinkService.buildOpenLink({
      mailboxEmail: 'owner@example.com',
      senderEmail: 'news@example.com OR is:starred',
      internalDate: '2026-07-12T12:00:00.000Z',
      forceSearchFallback: true,
    });
    expect(url).toContain('from%3A%22news%40example.com%20OR%20is%3Astarred%22%20after%3A');
  });

  it('builds mailbox-bound sender searches and compose drafts', () => {
    expect(
      GmailOpenLinkService.buildSearchLink({
        mailboxEmail: 'owner@example.com',
        query: 'from:"sender@example.com"',
      }),
    ).toBe(
      'https://mail.google.com/mail/?authuser=owner%40example.com#search/from%3A%22sender%40example.com%22',
    );
    expect(
      GmailOpenLinkService.buildComposeLink({
        mailboxEmail: 'owner@example.com',
        to: 'unsubscribe+list@example.com',
        subject: 'Remove me',
      }),
    ).toBe(
      'https://mail.google.com/mail/?authuser=owner%40example.com&view=cm&fs=1&to=unsubscribe%2Blist%40example.com&su=Remove+me',
    );
  });

  it('fails closed when account or destination data is missing', () => {
    expect(
      GmailOpenLinkService.buildOpenLink({ mailboxEmail: '', gmailMessageId: 'msg-1' }),
    ).toBeNull();
    expect(GmailOpenLinkService.buildOpenLink({ mailboxEmail: 'owner@example.com' })).toBeNull();
    expect(
      GmailOpenLinkService.buildSearchLink({ mailboxEmail: 'owner@example.com', query: ' ' }),
    ).toBeNull();
    expect(
      GmailOpenLinkService.buildComposeLink({ mailboxEmail: 'owner@example.com', to: '' }),
    ).toBeNull();
  });
});
