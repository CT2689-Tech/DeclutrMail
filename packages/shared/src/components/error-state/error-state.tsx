'use client';

import type { ReactNode } from 'react';

import { Button } from '../button';
import { color, font, radius } from '../../tokens/tokens';

/**
 * Shared retryable read-failure surface.
 *
 * This is deliberately separate from `EmptyState`: an empty response is
 * successful and calm, while a failed fetch means the visible data is
 * unknown. The solid amber treatment and alert semantics keep those two
 * states distinguishable without making a transient read failure look
 * destructive.
 *
 * The component is presentational and never accepts a raw error object. A
 * caller must provide privacy-safe copy instead of accidentally rendering an
 * API message that can contain transport or implementation details.
 */
export interface ErrorStateProps {
  title: ReactNode;
  description: ReactNode;
  onRetry: () => void;
  retryLabel?: string;
}

export function ErrorState({
  title,
  description,
  onRetry,
  retryLabel = 'Try again',
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      style={{
        padding: '32px 24px',
        background: color.amberBg,
        border: `1px solid ${color.amber}`,
        borderRadius: radius.lg,
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
        fontFamily: font.sans,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          color: color.amber,
          fontFamily: font.mono,
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}
      >
        Needs attention
      </span>
      <div>
        <h3
          style={{
            color: color.fg,
            fontSize: 15,
            fontWeight: 600,
            margin: 0,
            letterSpacing: '-0.01em',
          }}
        >
          {title}
        </h3>
        <p
          style={{
            color: color.fgSoft,
            fontSize: 13,
            lineHeight: 1.5,
            margin: '6px 0 0',
            maxWidth: 400,
          }}
        >
          {description}
        </p>
      </div>
      <Button tone="primary" onClick={onRetry}>
        {retryLabel}
      </Button>
    </div>
  );
}
