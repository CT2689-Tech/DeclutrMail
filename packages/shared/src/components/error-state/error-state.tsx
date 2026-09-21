'use client';

import type { ReactNode } from 'react';

import { Button } from '../button';
import { color, font, radius, text } from '../../tokens/tokens';

/**
 * Shared retryable read-failure surface.
 *
 * This is deliberately separate from `EmptyState`: an empty response is
 * successful and calm, while a failed fetch means the visible data is
 * unknown. The amber disc and alert semantics keep those two states
 * distinguishable without making a transient read failure look
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
        padding: '56px 24px',
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 20,
        fontFamily: font.sans,
      }}
    >
      <span
        aria-hidden="true"
        data-dm-error-mark=""
        style={{
          width: 56,
          height: 56,
          borderRadius: radius.pill,
          background: color.amberBg,
          color: color.amber,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: text['2xl'],
          fontWeight: 650,
          lineHeight: 1,
        }}
      >
        !
      </span>
      <div>
        <h3
          style={{
            color: color.fg,
            fontSize: text.xl,
            fontWeight: 650,
            margin: 0,
            letterSpacing: '-0.02em',
          }}
        >
          {title}
        </h3>
        <p
          style={{
            color: color.fgMuted,
            fontSize: text.md,
            lineHeight: 1.5,
            margin: '8px auto 0',
            maxWidth: 400,
          }}
        >
          {description}
        </p>
      </div>
      <Button tone="primary" size="lg" onClick={onRetry} style={{ minHeight: 44 }}>
        {retryLabel}
      </Button>
    </div>
  );
}
