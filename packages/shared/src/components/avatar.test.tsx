// Avatar (ADR-0024 monogram) tests.
//
// The load-bearing assertions are the two ADR guarantees:
//   1. NO network surface — no `<img>`, no third-party icon-host URL
//      (the pre-ADR-0024 waterfall leaked every sender domain to
//      Clearbit/DDG/Google from the user's browser).
//   2. Deterministic identity — same brand ⇒ same tint, across the
//      bulk-mail subdomain prefixes senders rotate through.
//
// SSR-rendered (`react-dom/server`) like the other shared-package
// tests — no jsdom toolchain is wired into this package.

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Avatar } from './avatar';

/** The inline-style hsl() background is the tint fingerprint. */
function tintOf(markup: string): string {
  const m = markup.match(/background:hsl\([^)]*\)/);
  return m?.[0] ?? '';
}

describe('Avatar (monogram, ADR-0024)', () => {
  it('renders the initial as a monogram with NO <img> and no third-party URL', () => {
    const markup = renderToStaticMarkup(<Avatar name="Groupon" domain="groupon.com" />);
    expect(markup).not.toContain('<img');
    expect(markup).not.toMatch(/clearbit|duckduckgo|google\.com/i);
    expect(markup).toContain('>G</span>');
  });

  it('derives the same tint for the same brand across bulk-mail subdomains', () => {
    const a = renderToStaticMarkup(<Avatar name="Brand" domain="brand.com" />);
    const b = renderToStaticMarkup(<Avatar name="Brand" domain="mail1.brand.com" />);
    const c = renderToStaticMarkup(<Avatar name="Brand" domain="news.brand.com" />);
    expect(tintOf(a)).not.toBe('');
    expect(tintOf(b)).toBe(tintOf(a));
    expect(tintOf(c)).toBe(tintOf(a));
  });

  it('derives different tints for different domains (identity, not decoration)', () => {
    const a = renderToStaticMarkup(<Avatar name="Acme" domain="acme.com" />);
    const b = renderToStaticMarkup(<Avatar name="Acme" domain="acme.io" />);
    expect(tintOf(a)).not.toBe(tintOf(b));
  });

  it('falls back to the name when domain is absent and never renders an empty glyph', () => {
    expect(renderToStaticMarkup(<Avatar name="  sarah chen" />)).toContain('>S</span>');
    expect(renderToStaticMarkup(<Avatar name="" />)).toContain('>?</span>');
  });

  it('stays aria-hidden (decorative — the sender name is always adjacent)', () => {
    expect(renderToStaticMarkup(<Avatar name="Acme" domain="acme.com" />)).toContain(
      'aria-hidden="true"',
    );
  });
});
