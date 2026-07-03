/**
 * Sender avatar — deterministic MONOGRAM (ADR-0024).
 *
 * One silhouette everywhere: rounded square, hairline border, a single
 * initial on a muted per-domain tint. No third-party fetches.
 *
 * This replaces the previous 3-tier favicon waterfall
 * (Clearbit → DuckDuckGo → Google S2 → colored initial). Two reasons,
 * both in ADR-0024:
 *
 *   1. PRIVACY. Every rendered sender fired that sender's domain to up
 *      to three third parties from the user's browser (with the user's
 *      IP attached) — broadcasting the correspondent list of a product
 *      whose wedge is "we don't read your mail". A logo tier may
 *      return later ONLY behind a first-party `/api/icons/:domain`
 *      proxy + quality gate (deferred — see ADR-0024).
 *   2. CONSISTENCY. Mixed sources meant high-res brand PNGs next to
 *      upscaled 16px favicons next to saturated letter bubbles — page-
 *      level variance that read as cheap. Uniform monograms trade
 *      per-item fidelity for page-level coherence.
 *
 * Tint derivation: djb2 hash of the brand-level root domain (falls
 * back to the display name) → hue; fixed low saturation + high
 * lightness so every tint sits inside the cool/editorial palette (D2)
 * instead of the retired `avatarColors` saturated set. Same domain ⇒
 * same tint on every surface, session after session.
 *
 * Decorative by contract: every call site renders the sender name
 * adjacent, so the monogram stays `aria-hidden` (unchanged from the
 * previous fallback bubble).
 */

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
 * Brand-level root for tint stability — strips the mailbox-provider
 * prefixes bulk senders use (mail1.brand.com → brand.com) so every
 * subdomain of a brand shares one tint. Same regex the favicon tiers
 * used for the same reason.
 */
function brandRoot(domain: string | undefined, name: string): string {
  const root = (domain ?? '')
    .replace(/^.*@/, '')
    .replace(/^(mail\d*|e\d*|em|email|news|notify|notification|alerts?|updates?|mailer)\./i, '');
  return root.length > 0 ? root : name;
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
  const hue = hashString(brandRoot(domain, name)) % 360;

  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: Math.max(6, Math.round(size * 0.28)),
        background: `hsl(${hue} 30% 94%)`,
        border: `1px solid ${color.border}`,
        color: `hsl(${hue} 26% 34%)`,
        fontFamily: font.mono,
        fontSize: size * 0.4,
        fontWeight: 500,
        letterSpacing: '0.01em',
        lineHeight: 1,
        flexShrink: 0,
        userSelect: 'none',
      }}
    >
      {initial}
    </span>
  );
}
