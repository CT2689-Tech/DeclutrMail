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
 * layer unconditionally and the logo composites on top of it. There is
 * no failure path that yields an empty box: a 204 (nothing cached), a
 * 401, a network error, a decode error, or the flag being off all end
 * with exactly what shipped before ADR-0034, and none of them shift
 * layout.
 *
 * THE LOGO LAYER IS A CSS BACKGROUND, NOT AN `<img>` — and that is the
 * whole guarantee, not a styling preference. The first cut used an
 * `<img>` on the claim that "a 204 or a 401 paints nothing at all with
 * `alt=""`". That claim is false. Chromium paints a BROKEN-IMAGE
 * placeholder for a failed image that has been given dimensions, and
 * the layer also carried an opaque `background` that painted over the
 * monogram whether or not any bytes arrived. Since `/api/icons/:domain`
 * answers 204 on a cold cache — the state EVERY domain is in until a
 * worker fills it — the effect in production was that every avatar on
 * the page became a broken-image glyph on a blank tile. A failed CSS
 * background image has no such placeholder in any engine: it paints
 * nothing, and the monogram beneath is simply what you see.
 *
 * Two consequences worth stating plainly:
 *
 *   - The layer must stay TRANSPARENT apart from the image itself. Any
 *     background-color here re-creates the bug in its second form.
 *     Covering the initial is therefore the mark's own job — BIMI SVG
 *     Tiny PS forbids transparency, so a verified mark is an opaque
 *     tile. A spec-violating mark would show the initial faintly
 *     behind it; that is a cosmetic edge, not a broken box.
 *   - `loading="lazy"` has no background-image equivalent. Senders
 *     loads 50 rows at a time and the requests are conditional (strong
 *     ETag → 304), so this is a real but small cost, paid to make the
 *     failure path safe.
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
 *
 * NO STATE, DELIBERATELY. An earlier draft tracked load success in
 * `useState` to hide a failed logo, which made this a Client Component
 * — and `packages/shared`'s barrel is imported by server components
 * (`app/not-found.tsx`), so the web build failed outright. The state is
 * not needed once the layer is a CSS background: failure paints
 * nothing on its own, with no event to handle. That keeps this a
 * zero-JS server component — which matters for something rendered a
 * few hundred times on one Senders page.
 */

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
        <span
          style={{
            position: 'absolute',
            // The uniform inset is what makes a logo and a monogram
            // read as the same object rather than two kinds of thing.
            inset: Math.max(2, Math.round(size * 0.14)),
            // `iconUrl` is safe to interpolate into a CSS url() token:
            // the only variable segment is `encodeURIComponent`'d, and
            // that escapes every character that could close the quoted
            // string (`"` → %22, `\` → %5C, newlines → %0A).
            backgroundImage: `url("${iconUrl}")`,
            // `contain` never crops: brand marks are not all square,
            // and a cropped logo is worse than a small one.
            backgroundSize: 'contain',
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'center',
            // NO background-color, ever — see the header. A color here
            // paints over the monogram on every cache miss.
            borderRadius: Math.max(4, radius - 2),
          }}
        />
      )}
    </span>
  );
}
