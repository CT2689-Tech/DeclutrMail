'use client';

import { useState } from 'react';
import { avatarColors, color, font } from '../tokens/tokens';

/**
 * Sender avatar — favicon-first (Google S2 service) with a coloured
 * initial as the fallback when no domain resolves or the favicon 404s.
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
  const [failed, setFailed] = useState(false);

  const idx = (name.charCodeAt(0) || 0) % avatarColors.length;
  const fill = avatarColors[idx] ?? '#666666';
  const initial = (name.trim()[0] ?? '?').toUpperCase();
  const root = (domain ?? '').replace(/^.*@/, '').replace(/^mail\d+\./, '');
  const showLogo = root.length > 0 && !failed;

  if (!showLogo) {
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

  const fetchPx = Math.min(256, Math.max(64, Math.round(size * 2)));
  const inner = Math.round(size * 0.7);
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
        src={`https://www.google.com/s2/favicons?domain=${root}&sz=${fetchPx}`}
        alt=""
        width={inner}
        height={inner}
        loading="lazy"
        onError={() => setFailed(true)}
        style={{ display: 'block' }}
      />
    </span>
  );
}
