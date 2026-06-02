'use client';

import { useState } from 'react';
import { avatarColors, color, font } from '../tokens/tokens';

/**
 * Sender avatar — multi-source logo with graceful fallback.
 *
 * Source order (each falls through on 404 / load error):
 *   1. Clearbit Logo API (logo.clearbit.com/{domain}) — the gold
 *      standard. Returns the company's actual high-res brand mark
 *      (PNG, transparent). Hits for ~90% of well-known senders.
 *   2. DuckDuckGo favicon (icons.duckduckgo.com/ip3/{domain}.ico) —
 *      cleaner than Google S2 for non-mainstream domains. Returns a
 *      bigger / less blurry icon than S2's default crop.
 *   3. Google S2 (google.com/s2/favicons?…&sz=N) — broadest coverage,
 *      lowest quality. The last logo attempt before falling to the
 *      coloured initial.
 *   4. Coloured initial bubble — when every favicon source 404s.
 *
 * Each tier renders the same outer chrome (rounded square card) so
 * the silhouette stays consistent regardless of which source resolves.
 */
export function Avatar({
  name,
  domain,
  size = 28,
}: {
  name: string;
  domain?: string;
  size?: number;
}) {
  const [tier, setTier] = useState(0);

  const idx = (name.charCodeAt(0) || 0) % avatarColors.length;
  const fill = avatarColors[idx] ?? '#666666';
  const initial = (name.trim()[0] ?? '?').toUpperCase();
  const root = (domain ?? '')
    .replace(/^.*@/, '')
    // strip common bulk-mail prefixes so the brand-level domain resolves
    // (e.g. mail1.brand.com → brand.com — Clearbit only knows the brand).
    .replace(/^(mail\d*|e\d*|em|email|news|notify|notification|alerts?|updates?|mailer)\./i, '');

  // Tier 3 = give up, render the initial bubble.
  if (root.length === 0 || tier >= 3) {
    return (
      <span
        aria-hidden="true"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: size,
          height: size,
          borderRadius: 8,
          background: fill,
          color: '#FFFFFF',
          fontFamily: font.sans,
          fontSize: size * 0.42,
          fontWeight: 700,
          letterSpacing: '-0.01em',
          flexShrink: 0,
        }}
      >
        {initial}
      </span>
    );
  }

  const fetchPx = Math.min(256, Math.max(64, Math.round(size * 2.5)));
  // Compose the URL for the current tier.
  const src =
    tier === 0
      ? `https://logo.clearbit.com/${root}?size=${fetchPx}`
      : tier === 1
        ? `https://icons.duckduckgo.com/ip3/${root}.ico`
        : `https://www.google.com/s2/favicons?domain=${root}&sz=${fetchPx}`;

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: 8,
        background: '#FFFFFF',
        border: `1px solid ${color.border}`,
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        onError={() => setTier((t) => t + 1)}
        style={{ display: 'block', objectFit: 'contain', width: '100%', height: '100%' }}
      />
    </span>
  );
}
