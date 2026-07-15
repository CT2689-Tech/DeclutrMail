import { describe, expect, it } from 'vitest';

import {
  gmailAllFromSenderDeepLink,
  gmailComposeUrlFromMailto,
  gmailSearchDeepLink,
  gmailThreadDeepLink,
} from './gmail-links';

const MAILBOX = 'owner+work@example.com';

describe('Gmail deep-link compatibility wrappers', () => {
  it('opens a thread through the mailbox-bound all-mail route', () => {
    const url = gmailThreadDeepLink(MAILBOX, 'thread/123');

    expect(url).toBe(
      'https://mail.google.com/mail/?authuser=owner%2Bwork%40example.com#all/thread%2F123',
    );
    expect(url).not.toContain('/u/0');
    expect(url).not.toContain('#inbox/');
  });

  it('builds a mailbox-bound sender search without /u/0', () => {
    const url = gmailAllFromSenderDeepLink(MAILBOX, ' sender+tag@example.com ');

    expect(url).toBe(
      'https://mail.google.com/mail/?authuser=owner%2Bwork%40example.com#search/from%3A%22sender%2Btag%40example.com%22',
    );
    expect(url).not.toContain('/u/0');
  });

  it('builds a mailbox-bound generic search without /u/0', () => {
    const url = gmailSearchDeepLink(MAILBOX, 'is:unread label:receipts');

    expect(url).toBe(
      'https://mail.google.com/mail/?authuser=owner%2Bwork%40example.com#search/is%3Aunread%20label%3Areceipts',
    );
    expect(url).not.toContain('/u/0');
  });

  it('fails closed when mailbox or destination data is empty', () => {
    expect(gmailThreadDeepLink('', 'thread-1')).toBeNull();
    expect(gmailThreadDeepLink(MAILBOX, ' ')).toBeNull();
    expect(gmailAllFromSenderDeepLink('', 'sender@example.com')).toBeNull();
    expect(gmailAllFromSenderDeepLink(MAILBOX, ' ')).toBeNull();
    expect(gmailSearchDeepLink('', 'is:unread')).toBeNull();
    expect(gmailSearchDeepLink(MAILBOX, ' ')).toBeNull();
  });
});

/**
 * `gmailComposeUrlFromMailto` (D230 manual unsubscribe path) — the
 * compose deep link must round-trip addresses + subject/body params
 * with correct URL-encoding, and refuse anything that isn't a usable
 * `mailto:` (a broken affordance is worse than none).
 */
describe('gmailComposeUrlFromMailto', () => {
  it('builds the compose link from a bare address', () => {
    expect(gmailComposeUrlFromMailto(MAILBOX, 'mailto:opt-out@shop.example')).toBe(
      'https://mail.google.com/mail/?authuser=owner%2Bwork%40example.com&view=cm&fs=1&to=opt-out%40shop.example',
    );
  });

  it('carries subject + body through with re-encoding', () => {
    const url = gmailComposeUrlFromMailto(
      MAILBOX,
      'mailto:unsub@lists.example?subject=Unsubscribe%20me&body=please%20remove',
    );
    expect(url).toBe(
      'https://mail.google.com/mail/?authuser=owner%2Bwork%40example.com&view=cm&fs=1&to=unsub%40lists.example&su=Unsubscribe+me&body=please+remove',
    );
    expect(url).not.toContain('/u/0');
  });

  it('matches Subject case-insensitively (common in the wild)', () => {
    const url = gmailComposeUrlFromMailto(MAILBOX, 'mailto:u@x.example?Subject=STOP');
    expect(url).toContain('su=STOP');
  });

  it('percent-decodes an encoded address and re-encodes it safely', () => {
    // `%2B` = '+' — tag addresses must survive the round-trip as a
    // literal plus, not a space.
    const url = gmailComposeUrlFromMailto(MAILBOX, 'mailto:opt%2Bout@shop.example');
    expect(url).toBe(
      'https://mail.google.com/mail/?authuser=owner%2Bwork%40example.com&view=cm&fs=1&to=opt%2Bout%40shop.example',
    );
  });

  it('encodes characters that would break the query string', () => {
    const url = gmailComposeUrlFromMailto(
      MAILBOX,
      'mailto:u@x.example?subject=a%26b%3Dc&body=line1%0Aline2',
    );
    expect(url).toContain('su=a%26b%3Dc');
    expect(url).toContain('body=line1%0Aline2');
  });

  it('handles unicode subjects', () => {
    const url = gmailComposeUrlFromMailto(
      MAILBOX,
      'mailto:u@x.example?subject=abbestellen%20%E2%9C%89',
    );
    expect(url).toContain(`su=abbestellen+${encodeURIComponent('✉')}`);
  });

  it('returns null for a non-mailto URL (never POST targets)', () => {
    expect(gmailComposeUrlFromMailto(MAILBOX, 'https://unsub.shop.example/oneclick')).toBeNull();
  });

  it('returns null for an empty address', () => {
    expect(gmailComposeUrlFromMailto(MAILBOX, 'mailto:?subject=hi')).toBeNull();
  });

  it('returns null for garbage', () => {
    expect(gmailComposeUrlFromMailto(MAILBOX, 'not a url')).toBeNull();
  });

  it('returns null without the mailbox account', () => {
    expect(gmailComposeUrlFromMailto('', 'mailto:opt-out@shop.example')).toBeNull();
  });
});
