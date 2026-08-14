/**
 * Sender avatar — MONOGRAM base, optional brand logo over it
 * (ADR-0024 + ADR-0034).
 *
 * One silhouette everywhere: rounded square, hairline border, a single
 * initial on a muted per-domain tint. ADR-0024 established that
 * silhouette after a 3-tier third-party favicon waterfall (Clearbit →
 * DuckDuckGo → Google S2) was removed for two reasons that still hold:
 *
 *   1. PRIVACY. Every rendered sender fired that sender's domain to up
 *      to three third parties from the user's browser (with the user's
 *      IP attached) — broadcasting the correspondent list of a product
 *      whose wedge is "we don't read your mail".
 *   2. CONSISTENCY. Mixed sources meant high-res brand PNGs next to
 *      upscaled 16px favicons next to saturated letter bubbles —
 *      page-level variance that read as cheap.
 *
 * ADR-0034 brings logos back WITHOUT reopening either. The image comes
 * from our own `GET /api/icons/:domain` (a global, domain-keyed server
 * cache — the browser never talks to an icon source), and every mark
 * is composited into this same rounded square so a page that is 30%
 * logos still reads as one system rather than half-broken.
 *
 * THE MONOGRAM IS THE FLOOR, NOT A FALLBACK. It renders as the base
 * layer unconditionally and the logo fades in on top of it. There is
 * no failure path that yields an empty box: a 204 (nothing cached), a
 * 401, a network error, a decode error, or the flag being off all end
 * with exactly what shipped before ADR-0034, and none of them shift
 * layout.
 *
 * Below `LOGO_MIN_SIZE` the logo is skipped entirely. Table rows draw
 * this at 22px, where a downscaled mark is exactly the mixed-fidelity
 * problem ADR-0024 diagnosed, and the identity anchor is already doing
 * its job at that size.
 *
 * Tint derivation: djb2 hash of the brand-level root domain (falls
 * back to the display name) → hue; fixed low saturation + high
 * lightness so every tint sits inside the cool/editorial palette (D2).
 * Same domain ⇒ same tint on every surface, session after session.
 *
 * Decorative by contract: every call site renders the sender name
 * adjacent, so the whole avatar stays `aria-hidden`.
 */

import { useState } from 'react';

import { resolveFlag } from '../flags/resolve';
import { brandRoot } from '../senders/brand-root';
import { color, font } from '../tokens/tokens';

/** djb2 — tiny, stable, good spread for short ASCII strings. */
function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (h * 33) ^ s.charCodeAt(i);
  }
  return h >>> 0;
}

/**
 * Smallest avatar that may carry a logo. Below this a brand mark is
 * illegible and only reintroduces fidelity variance.
 */
export const LOGO_MIN_SIZE = 24;

/**
 * Both env reads are LITERAL on purpose: Next inlines
 * `process.env.NEXT_PUBLIC_*` into the client bundle only for keys
 * written literally (`@declutrmail/shared` is in `transpilePackages`,
 * so this file is inlined the same as app code). A computed key would
 * silently resolve to `undefined` in the browser, which here fails
 * safe — flag off, monogram — but would be invisible.
 *
 * Resolved at module scope: both values are build-time constants, so
 * there is nothing to recompute per render and no request-varying
 * state to leak across SSR requests.
 */
const LOGOS_ENABLED = resolveFlag('brandLogos', process.env.NEXT_PUBLIC_DM_FLAG_BRAND_LOGOS);
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

/**
 * The icon URL for a domain, or null when no logo should be attempted.
 * Exported for tests — the "renders zero network surface" guarantee is
 * worth asserting directly rather than only through the DOM.
 */
export function brandIconUrl(domain: string | undefined, size: number): string | null {
  if (!LOGOS_ENABLED) return null;
  if (size < LOGO_MIN_SIZE) return null;
  const root = brandRoot(domain);
  if (root.length === 0) return null;
  return `${API_BASE}/api/icons/${encodeURIComponent(root)}`;
}

export function Avatar({
  name,
  domain,
  size = 28,
}: {
  name: string;
  domain?: string;
  size?: number;
}) {
  const initial = (name.trim()[0] ?? '?').toUpperCase();
  const root = brandRoot(domain);
  const hue = hashString(root.length > 0 ? root : name) % 360;
  const iconUrl = brandIconUrl(domain, size);

  // `loaded` gates the fade only. It never gates the monogram, so a
  // logo that never arrives is indistinguishable from a sender that
  // has none.
  const [loaded, setLoaded] = useState(false);
  const radius = Math.max(6, Math.round(size * 0.28));

  return (
    <span
      aria-hidden="true"
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: radius,
        // Hue stays per-domain; LIGHTNESS is theme-owned
        // (styles/tokens.css --dm-avatar-*-l) so monograms keep their
        // muted tint on dark surfaces instead of glowing paper-white.
        background: `hsl(${hue} 30% var(--dm-avatar-bg-l, 94%))`,
        border: `1px solid ${color.border}`,
        color: `hsl(${hue} 26% var(--dm-avatar-fg-l, 34%))`,
        fontFamily: font.mono,
        fontSize: size * 0.4,
        fontWeight: 500,
        letterSpacing: '0.01em',
        lineHeight: 1,
        flexShrink: 0,
        userSelect: 'none',
        overflow: 'hidden',
      }}
    >
      {initial}
      {iconUrl !== null && (
        <img
          src={iconUrl}
          alt=""
          width={size}
          height={size}
          // A 204 yields no image and fires `error`; so does a 401, a
          // dropped connection, or malformed bytes. All of them simply
          // leave `loaded` false, which leaves the monogram visible.
          onLoad={() => setLoaded(true)}
          onError={() => setLoaded(false)}
          // Avatars appear far down long virtualized lists; there is no
          // reason to fetch one before it is near the viewport.
          loading="lazy"
          decoding="async"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            // `contain` never crops: brand marks are not all square,
            // and a cropped logo is worse than a small one.
            objectFit: 'contain',
            // The uniform inset is what makes a logo and a monogram
            // read as the same object rather than two kinds of thing.
            padding: Math.max(2, Math.round(size * 0.14)),
            boxSizing: 'border-box',
            background: `hsl(${hue} 30% var(--dm-avatar-bg-l, 94%))`,
            borderRadius: radius,
            opacity: loaded ? 1 : 0,
            transition: 'opacity 120ms ease-out',
          }}
        />
      )}
    </span>
  );
}
