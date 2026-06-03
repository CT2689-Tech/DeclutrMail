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
 *
 * Discriminated-union tier state — replaces the prior `number` so an
 * accidental `setTier(17)` cannot fall through to a missing branch.
 */
export type AvatarTier = 'clearbit' | 'ddg' | 's2' | 'fallback';

const TIER_ORDER: readonly AvatarTier[] = ['clearbit', 'ddg', 's2', 'fallback'] as const;

function nextTier(t: AvatarTier): AvatarTier {
  const i = TIER_ORDER.indexOf(t);
  return TIER_ORDER[i + 1] ?? 'fallback';
}

/**
 * Module-scope memo of the highest known-good tier per root domain.
 * Avoids paying 3 sequential 404 round-trips on every render for a
 * domain that has already proven its favicon source. Lives at module
 * scope (not React state) so the cache survives unmount/remount cycles
 * during scroll — the dominant cost path. Bounded only by the number
 * of distinct sender domains in a session; never evicted (memory
 * footprint is one short string per domain).
 */
const knownBestTier = new Map<string, AvatarTier>();

export function Avatar({
  name,
  domain,
  size = 28,
}: {
  name: string;
  domain?: string;
  size?: number;
}) {
  const idx = (name.charCodeAt(0) || 0) % avatarColors.length;
  const fill = avatarColors[idx] ?? '#666666';
  const initial = (name.trim()[0] ?? '?').toUpperCase();
  const root = (domain ?? '')
    .replace(/^.*@/, '')
    // strip common bulk-mail prefixes so the brand-level domain resolves
    // (e.g. mail1.brand.com → brand.com — Clearbit only knows the brand).
    .replace(/^(mail\d*|e\d*|em|email|news|notify|notification|alerts?|updates?|mailer)\./i, '');

  // Lazy init reads from the module-scope memo so a known-good tier
  // skips straight past the failing sources on the next mount. Avatars
  // in this app live inside per-sender rows/cards keyed by sender.id,
  // so re-mounting happens naturally when `domain` changes — no
  // re-sync effect is needed.
  const [tier, setTier] = useState<AvatarTier>(() => knownBestTier.get(root) ?? 'clearbit');

  // Tier === 'fallback' = give up, render the initial bubble.
  if (root.length === 0 || tier === 'fallback') {
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
  const src = tierUrl(tier, root, fetchPx);

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
        onLoad={() => {
          // Memoise the first tier that successfully rendered for this
          // root domain so the next mount skips straight to it.
          knownBestTier.set(root, tier);
        }}
        onError={() => setTier((t) => nextTier(t))}
        style={{ display: 'block', objectFit: 'contain', width: '100%', height: '100%' }}
      />
    </span>
  );
}

/**
 * URL composer for the favicon-bearing tiers. Excludes `'fallback'` at
 * the type level — the caller's early-return guarantees we never reach
 * this with `'fallback'`, and excluding it lets the switch be truly
 * exhaustive (any future tier added to the union must be handled here
 * to keep TS green).
 */
function tierUrl(tier: Exclude<AvatarTier, 'fallback'>, root: string, fetchPx: number): string {
  switch (tier) {
    case 'clearbit':
      return `https://logo.clearbit.com/${root}?size=${fetchPx}`;
    case 'ddg':
      return `https://icons.duckduckgo.com/ip3/${root}.ico`;
    case 's2':
      return `https://www.google.com/s2/favicons?domain=${root}&sz=${fetchPx}`;
    default: {
      const _exhaustive: never = tier;
      return _exhaustive;
    }
  }
}
