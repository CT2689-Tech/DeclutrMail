'use client';

import type { ReactNode } from 'react';
import { color, font, radius } from '../tokens/tokens';

/** Centred empty-state panel — icon, title, body copy, optional action. */
export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      style={{
        padding: '48px 24px',
        background: color.card,
        border: `1px dashed ${color.border}`,
        borderRadius: radius.lg,
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
        fontFamily: font.sans,
      }}
    >
      {icon != null && (
        <span
          style={{
            width: 44,
            height: 44,
            borderRadius: radius.pill,
            background: color.primarySoft,
            color: color.primary,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {icon}
        </span>
      )}
      <div>
        <h3
          style={{
            fontSize: 15,
            fontWeight: 600,
            margin: 0,
            letterSpacing: '-0.01em',
          }}
        >
          {title}
        </h3>
        {body != null && (
          <p
            style={{
              fontSize: 13,
              color: color.fgMuted,
              margin: '6px 0 0',
              lineHeight: 1.5,
              maxWidth: 360,
            }}
          >
            {body}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}
