import { describe, expect, it } from 'vitest';

import { gmailComposeUrlFromMailto } from './gmail-links';

/**
 * `gmailComposeUrlFromMailto` (D230 manual unsubscribe path) — the
 * compose deep link must round-trip addresses + subject/body params
 * with correct URL-encoding, and refuse anything that isn't a usable
 * `mailto:` (a broken affordance is worse than none).
 */
describe('gmailComposeUrlFromMailto', () => {
  it('builds the compose link from a bare address', () => {
    expect(gmailComposeUrlFromMailto('mailto:opt-out@shop.example')).toBe(
      'https://mail.google.com/mail/?view=cm&fs=1&to=opt-out%40shop.example',
    );
  });

  it('carries subject + body through with re-encoding', () => {
    const url = gmailComposeUrlFromMailto(
      'mailto:unsub@lists.example?subject=Unsubscribe%20me&body=please%20remove',
    );
    expect(url).toBe(
      'https://mail.google.com/mail/?view=cm&fs=1&to=unsub%40lists.example&su=Unsubscribe+me&body=please+remove',
    );
  });

  it('matches Subject case-insensitively (common in the wild)', () => {
    const url = gmailComposeUrlFromMailto('mailto:u@x.example?Subject=STOP');
    expect(url).toContain('su=STOP');
  });

  it('percent-decodes an encoded address and re-encodes it safely', () => {
    // `%2B` = '+' — tag addresses must survive the round-trip as a
    // literal plus, not a space.
    const url = gmailComposeUrlFromMailto('mailto:opt%2Bout@shop.example');
    expect(url).toBe('https://mail.google.com/mail/?view=cm&fs=1&to=opt%2Bout%40shop.example');
  });

  it('encodes characters that would break the query string', () => {
    const url = gmailComposeUrlFromMailto(
      'mailto:u@x.example?subject=a%26b%3Dc&body=line1%0Aline2',
    );
    expect(url).toContain('su=a%26b%3Dc');
    expect(url).toContain('body=line1%0Aline2');
  });

  it('handles unicode subjects', () => {
    const url = gmailComposeUrlFromMailto('mailto:u@x.example?subject=abbestellen%20%E2%9C%89');
    expect(url).toContain(`su=abbestellen+${encodeURIComponent('✉')}`);
  });

  it('returns null for a non-mailto URL (never POST targets)', () => {
    expect(gmailComposeUrlFromMailto('https://unsub.shop.example/oneclick')).toBeNull();
  });

  it('returns null for an empty address', () => {
    expect(gmailComposeUrlFromMailto('mailto:?subject=hi')).toBeNull();
  });

  it('returns null for garbage', () => {
    expect(gmailComposeUrlFromMailto('not a url')).toBeNull();
  });
});
