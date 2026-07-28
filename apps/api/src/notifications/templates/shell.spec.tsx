import { describe, expect, it } from 'vitest';

import { PRIVACY_BADGE_HEADLINE } from '@declutrmail/shared/copy';

import { DISPLAY, EMAIL_FROM, formatCount, formatNumber, renderShell, Shell } from './shell.js';

describe('shell', () => {
  it('keeps the locked From header', () => {
    expect(EMAIL_FROM).toBe('DeclutrMail <hello@send.declutrmail.com>');
  });

  it('formats counts with en-US grouping and singular/plural', () => {
    expect(formatCount(1, 'message', 'messages')).toBe('1 message');
    expect(formatCount(24310, 'message', 'messages')).toBe('24,310 messages');
    expect(formatCount(0, 'message', 'messages')).toBe('0 messages');
  });

  it('groups the numeral without a unit label', () => {
    expect(formatNumber(97253)).toBe('97,253');
  });

  it('renders children and footer into html', async () => {
    const html = await renderShell(
      <Shell preview="Preview line" footer="Footer line">
        <p>Body line</p>
      </Shell>,
    );
    expect(html).toContain('Body line');
    expect(html).toContain('Footer line');
    expect(html).toContain('Preview line');
  });

  it('closes every email on the D228 trust line', async () => {
    const html = await renderShell(
      <Shell preview="p" footer="f">
        <p>b</p>
      </Shell>,
    );
    expect(html).toContain(PRIVACY_BADGE_HEADLINE);
  });

  it('carries the masthead wordmark and rule', async () => {
    const html = await renderShell(
      <Shell preview="p" footer="f">
        <p>b</p>
      </Shell>,
    );
    expect(html).toContain('DeclutrMail');
    expect(html).toContain('Gmail cleanup, by sender');
    // The newspaper rule is a bordered block, never a remote image:
    // Gmail hides images until the reader opts in, and brand chrome
    // that only appears after "display images" mostly does not appear.
    expect(html).not.toMatch(/<img/i);
  });

  it('never falls back to Georgia for display numerals', () => {
    // Georgia's DEFAULT figures are old-style, so a hero count renders
    // with digits dropping below the baseline — it reads as a rendering
    // bug. Times New Roman defaults to lining figures.
    expect(DISPLAY).not.toMatch(/georgia/i);
    expect(DISPLAY).toMatch(/Times New Roman/);
  });
});
