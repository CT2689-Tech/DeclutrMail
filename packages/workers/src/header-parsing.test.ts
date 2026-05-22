import { describe, expect, it } from 'vitest';

import { parseListUnsubscribe, parseRecipients } from './header-parsing.js';

describe('parseRecipients', () => {
  it('returns empty array for null/empty', () => {
    expect(parseRecipients(null)).toEqual([]);
    expect(parseRecipients('')).toEqual([]);
  });

  it('parses a single bare address', () => {
    expect(parseRecipients('alice@example.com')).toEqual(['alice@example.com']);
  });

  it('parses a quoted display name with angle-bracketed address', () => {
    expect(parseRecipients('"Alice Doe" <alice@example.com>')).toEqual(['alice@example.com']);
  });

  it('splits comma-separated recipients (mixed forms)', () => {
    expect(
      parseRecipients('"Alice" <alice@example.com>, bob@example.com, "Carol, Inc" <carol@x.com>'),
    ).toEqual(['alice@example.com', 'bob@example.com', 'carol@x.com']);
  });

  it('does not split on commas inside quotes', () => {
    expect(parseRecipients('"Doe, Jane" <jane@example.com>')).toEqual(['jane@example.com']);
  });

  it('lowercases + trims and dedupes', () => {
    expect(parseRecipients('  Foo@Bar.COM , foo@bar.com')).toEqual(['foo@bar.com']);
  });

  it('skips unparseable entries', () => {
    expect(parseRecipients('Mailer Daemon, alice@example.com')).toEqual(['alice@example.com']);
  });
});

describe('parseListUnsubscribe', () => {
  it('returns nulls for missing header', () => {
    expect(parseListUnsubscribe(null, null)).toEqual({ url: null, oneClick: false });
  });

  it('prefers https URL over mailto', () => {
    expect(parseListUnsubscribe('<https://x.com/unsub>, <mailto:unsub@x.com>', null)).toEqual({
      url: 'https://x.com/unsub',
      oneClick: false,
    });
  });

  it('falls back to mailto when no https present', () => {
    expect(parseListUnsubscribe('<mailto:unsub@x.com>', null)).toEqual({
      url: 'mailto:unsub@x.com',
      oneClick: false,
    });
  });

  it('reports one-click when https URL + One-Click post header present (RFC 8058)', () => {
    expect(
      parseListUnsubscribe(
        '<https://x.com/unsub>, <mailto:unsub@x.com>',
        'List-Unsubscribe=One-Click',
      ),
    ).toEqual({ url: 'https://x.com/unsub', oneClick: true });
  });

  it('does NOT report one-click without an https URL', () => {
    // Mailto-only — one-click is not applicable per RFC 8058.
    expect(parseListUnsubscribe('<mailto:unsub@x.com>', 'List-Unsubscribe=One-Click')).toEqual({
      url: 'mailto:unsub@x.com',
      oneClick: false,
    });
  });

  it('case-insensitive on the one-click flag', () => {
    expect(parseListUnsubscribe('<https://x.com>', 'list-unsubscribe=one-click')).toEqual({
      url: 'https://x.com',
      oneClick: true,
    });
  });
});
