// Avatar tests (ADR-0024 monogram + ADR-0034 brand logos).
//
// The load-bearing assertions are the ADR guarantees:
//   1. NO THIRD-PARTY network surface. ADR-0024 removed a waterfall
//      that leaked every sender domain to Clearbit/DDG/Google from the
//      user's browser; ADR-0034 brought logos back without reopening
//      it, so the only host that may ever appear is our own.
//   2. The monogram is the FLOOR — it renders whatever the image does,
//      so no failure path yields an empty box.
//   3. Deterministic identity — same brand ⇒ same tint, across the
//      bulk-mail subdomain prefixes senders rotate through.
//
// Flag state is always set explicitly: `brandLogos` has defaulted both
// ways, so a test that rides the default asserts nothing stable.
//
// SSR-rendered (`react-dom/server`) like the other shared-package
// tests — no jsdom toolchain is wired into this package.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Avatar } from './avatar';

/**
 * Re-import the module with `brandLogos` on. The flag and API base are
 * resolved at module scope (they are build-time constants in the
 * browser bundle), so flipping them means resetting the registry.
 */
async function withLogosEnabled(apiBase = 'https://api.declutrmail.test') {
  vi.stubEnv('NEXT_PUBLIC_DM_FLAG_BRAND_LOGOS', 'true');
  vi.stubEnv('NEXT_PUBLIC_API_URL', apiBase);
  vi.resetModules();
  return import('./avatar');
}

/**
 * The kill-switch state. Asserted explicitly rather than by relying on
 * the manifest default, which has now been both values — a test that
 * silently tracks the default tests nothing.
 */
async function withLogosDisabled() {
  vi.stubEnv('NEXT_PUBLIC_DM_FLAG_BRAND_LOGOS', 'false');
  vi.resetModules();
  return import('./avatar');
}

/** The inline-style hsl() background is the tint fingerprint. */
function tintOf(markup: string): string {
  const m = markup.match(/background:hsl\([^)]*\)/);
  return m?.[0] ?? '';
}

describe('Avatar (monogram, ADR-0024)', () => {
  it('renders the initial as a monogram and never a third-party URL', () => {
    // The ADR-0024 privacy guarantee, which holds in BOTH flag states:
    // the browser talks to nobody but us.
    const markup = renderToStaticMarkup(<Avatar name="Groupon" domain="groupon.com" />);
    expect(markup).not.toMatch(/clearbit|duckduckgo|google\.com/i);
    // `>G<` rather than `>G</span>`: with logos on, the glyph's sibling
    // is the <img> layered over it. The monogram is still rendered,
    // which is the guarantee that matters.
    expect(markup).toContain('>G<');
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

describe('Avatar with `brandLogos` off', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('requests nothing at all', async () => {
    // The kill-switch must be byte-identical to pre-ADR-0034: not a
    // request that 204s, but no request and no <img> element.
    const { Avatar: NoLogos, brandIconUrl: url } = await withLogosDisabled();

    expect(url('groupon.com', 40)).toBeNull();
    expect(
      renderToStaticMarkup(<NoLogos name="Groupon" domain="groupon.com" size={40} />),
    ).not.toContain('<img');
  });
});

describe('Avatar brand logos (ADR-0034)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('points the <img> at our OWN endpoint, never a third party', async () => {
    const { Avatar: Logos } = await withLogosEnabled();
    const markup = renderToStaticMarkup(<Logos name="Chase" domain="chase.com" size={40} />);

    expect(markup).toContain('src="https://api.declutrmail.test/api/icons/chase.com"');
    // The ADR-0024 privacy guarantee survives ADR-0034: the browser
    // still talks to nobody but us.
    expect(markup).not.toMatch(/clearbit|duckduckgo|google\.com|brandfetch|logo\.dev/i);
  });

  it('keeps the monogram as the base layer under the logo', async () => {
    const { Avatar: Logos } = await withLogosEnabled();
    const markup = renderToStaticMarkup(<Logos name="Chase" domain="chase.com" size={40} />);

    // No failure path can produce an empty box, because the glyph is
    // never conditional on the image.
    expect(markup).toContain('C');
    expect(markup).toContain('<img');
  });

  it('collapses bulk-mail subdomains onto one cache key', async () => {
    const { brandIconUrl: url } = await withLogosEnabled();

    // Same brand ⇒ same URL ⇒ one server-side row and one fetch.
    expect(url('mail1.chase.com', 40)).toBe(url('chase.com', 40));
    expect(url('notify.chase.com', 40)).toBe(url('CHASE.com', 40));
  });

  it('stays monogram-only below the legibility floor', async () => {
    const { Avatar: Logos, brandIconUrl: url, LOGO_MIN_SIZE } = await withLogosEnabled();

    // Table rows draw at 22px — where a downscaled mark is exactly the
    // mixed-fidelity problem ADR-0024 diagnosed.
    expect(url('chase.com', LOGO_MIN_SIZE - 1)).toBeNull();
    expect(url('chase.com', LOGO_MIN_SIZE)).not.toBeNull();
    expect(renderToStaticMarkup(<Logos name="Chase" domain="chase.com" size={22} />)).not.toContain(
      '<img',
    );
  });

  it('attempts no logo when there is no domain to key on', async () => {
    const { Avatar: Logos, brandIconUrl: url } = await withLogosEnabled();

    expect(url(undefined, 40)).toBeNull();
    expect(renderToStaticMarkup(<Logos name="Sarah Chen" size={40} />)).not.toContain('<img');
  });

  it('escapes the domain it puts in the path', async () => {
    const { brandIconUrl: url } = await withLogosEnabled();

    // Domains reach this from mail we did not author.
    expect(url('evil.com/../../admin', 40)).toBe(
      'https://api.declutrmail.test/api/icons/evil.com%2F..%2F..%2Fadmin',
    );
  });

  it('renders the image decoratively (the name is still the label)', async () => {
    const { Avatar: Logos } = await withLogosEnabled();
    const markup = renderToStaticMarkup(<Logos name="Chase" domain="chase.com" size={40} />);

    expect(markup).toContain('alt=""');
    expect(markup).toContain('aria-hidden="true"');
  });
});
