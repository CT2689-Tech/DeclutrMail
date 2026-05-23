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
    expect(parseListUnsubscribe(null, null)).toEqual({
      httpsUrl: null,
      mailtoUrl: null,
      oneClick: false,
    });
  });

  it('returns both channels when both URL forms are present', () => {
    expect(parseListUnsubscribe('<https://x.com/unsub>, <mailto:unsub@x.com>', null)).toEqual({
      httpsUrl: 'https://x.com/unsub',
      mailtoUrl: 'mailto:unsub@x.com',
      oneClick: false,
    });
  });

  it('returns only mailto when no https is present', () => {
    expect(parseListUnsubscribe('<mailto:unsub@x.com>', null)).toEqual({
      httpsUrl: null,
      mailtoUrl: 'mailto:unsub@x.com',
      oneClick: false,
    });
  });

  it('returns only https when no mailto is present', () => {
    expect(parseListUnsubscribe('<https://x.com/unsub>', null)).toEqual({
      httpsUrl: 'https://x.com/unsub',
      mailtoUrl: null,
      oneClick: false,
    });
  });

  it('reports one-click when https URL + One-Click post header present (RFC 8058)', () => {
    expect(
      parseListUnsubscribe(
        '<https://x.com/unsub>, <mailto:unsub@x.com>',
        'List-Unsubscribe=One-Click',
      ),
    ).toEqual({
      httpsUrl: 'https://x.com/unsub',
      mailtoUrl: 'mailto:unsub@x.com',
      oneClick: true,
    });
  });

  it('does NOT report one-click without an https URL', () => {
    // Mailto-only — one-click is not applicable per RFC 8058.
    expect(parseListUnsubscribe('<mailto:unsub@x.com>', 'List-Unsubscribe=One-Click')).toEqual({
      httpsUrl: null,
      mailtoUrl: 'mailto:unsub@x.com',
      oneClick: false,
    });
  });

  it('case-insensitive on the one-click flag', () => {
    expect(parseListUnsubscribe('<https://x.com>', 'list-unsubscribe=one-click')).toEqual({
      httpsUrl: 'https://x.com',
      mailtoUrl: null,
      oneClick: true,
    });
  });

  it('rejects insecure http: URLs as one-click candidates (RFC 8058 security)', () => {
    // Cleartext `http:` is downgrade-vulnerable — never honored as
    // one-click even with the post-flag. Codex iter 4 finding.
    expect(parseListUnsubscribe('<http://x.com/unsub>', 'List-Unsubscribe=One-Click')).toEqual({
      httpsUrl: null,
      mailtoUrl: null,
      oneClick: false,
    });
  });

  it('returns only mailto when http: + mailto present (http dropped, no one-click)', () => {
    expect(
      parseListUnsubscribe(
        '<http://x.com/unsub>, <mailto:unsub@x.com>',
        'List-Unsubscribe=One-Click',
      ),
    ).toEqual({
      httpsUrl: null,
      mailtoUrl: 'mailto:unsub@x.com',
      oneClick: false,
    });
  });

  it('plain https (no post header) returns https without one-click — caller decides aggregation', () => {
    // The Codex iter 5 bug: this case previously surfaced as
    // {url: 'https://...', oneClick: false} and was mapped to
    // method='mailto' downstream — a method/URL mismatch. The parser
    // now returns the channels separately so the aggregator can
    // distinguish "plain HTTPS link" from "actionable mailto".
    expect(parseListUnsubscribe('<https://x.com/unsub>', null)).toEqual({
      httpsUrl: 'https://x.com/unsub',
      mailtoUrl: null,
      oneClick: false,
    });
  });
});
