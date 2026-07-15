'use client';

import type { ReactNode } from 'react';
import { color, font, radius } from '../tokens/tokens';
import { useLocalState } from '../hooks/use-local-state';

/**
 * A dismissible "what is this screen" explainer. Once dismissed it
 * collapses to a small mono chip that re-opens it. Persisted per id.
 */
export function ScreenIntro({
  id,
  title,
  body,
  tip,
  learnMoreHref,
}: {
  id: string;
  title: string;
  body: ReactNode;
  tip?: ReactNode;
  learnMoreHref?: string;
}) {
  const [dismissed, setDismissed] = useLocalState<boolean>(`intro.${id}.dismissed`, false);

  if (dismissed) {
    return (
      <button
        onClick={() => setDismissed(false)}
        aria-label={`Show "${title}" intro`}
        style={{
          alignSelf: 'flex-start',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          padding: '3px 9px',
          background: 'transparent',
          color: color.fgMuted,
          border: `1px dashed ${color.border}`,
          borderRadius: radius.pill,
          fontFamily: font.mono,
          fontSize: 9.5,
          fontWeight: 500,
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          cursor: 'pointer',
        }}
      >
        <InfoDot />
        About: {title}
      </button>
    );
  }

  return (
    <div
      role="region"
      aria-label={`About ${title}`}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        padding: '12px 14px',
        background: color.primaryWash,
        border: `1px solid ${color.primaryBorder}`,
        borderRadius: radius.md,
        fontFamily: font.sans,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 28,
          height: 28,
          borderRadius: radius.pill,
          background: color.primary,
          color: color.fgInverse,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <InfoDot light />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: color.fg,
            marginBottom: 2,
          }}
        >
          {title}
        </div>
        <div style={{ fontSize: 12.5, color: color.fg, lineHeight: 1.5 }}>{body}</div>
        {tip != null && (
          <div
            style={{
              fontSize: 11.5,
              color: color.fgMuted,
              marginTop: 6,
              lineHeight: 1.5,
            }}
          >
            <strong style={{ color: color.fg, fontWeight: 600 }}>Tip:</strong> {tip}
          </div>
        )}
        {learnMoreHref != null && (
          <a
            href={learnMoreHref}
            style={{
              display: 'inline-block',
              marginTop: 6,
              fontSize: 11.5,
              color: color.primary,
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            Learn more →
          </a>
        )}
      </div>
      <button
        onClick={() => setDismissed(true)}
        aria-label={`Dismiss ${title} intro`}
        style={{
          background: 'transparent',
          border: 'none',
          color: color.fgMuted,
          cursor: 'pointer',
          padding: '0 4px',
          fontSize: 16,
          lineHeight: 1,
          flexShrink: 0,
        }}
      >
        ×
      </button>
    </div>
  );
}

function InfoDot({ light = false }: { light?: boolean }) {
  return (
    <svg
      width={light ? 14 : 9}
      height={light ? 14 : 9}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}
