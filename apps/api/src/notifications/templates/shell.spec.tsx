import { describe, expect, it } from 'vitest';

import { EMAIL_FROM, formatCount, renderShell, Shell } from './shell.js';

describe('shell', () => {
  it('keeps the locked From header', () => {
    expect(EMAIL_FROM).toBe('DeclutrMail <hello@send.declutrmail.com>');
  });

  it('formats counts with en-US grouping and singular/plural', () => {
    expect(formatCount(1, 'message', 'messages')).toBe('1 message');
    expect(formatCount(24310, 'message', 'messages')).toBe('24,310 messages');
    expect(formatCount(0, 'message', 'messages')).toBe('0 messages');
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
});
