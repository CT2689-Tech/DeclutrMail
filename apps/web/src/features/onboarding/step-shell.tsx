'use client';

import type { ReactNode } from 'react';
import { Eyebrow, tokens } from '@declutrmail/shared';

const { color, font } = tokens;

/**
 * Shared chrome for the onboarding steps that are NOT the sync gate
 * (D106). Mirrors the sync gate's centered single-column shell so the
 * five steps read as one flow. The gate keeps its own internal shell
 * (untouched — D109).
 */
export function StepShell({
  eyebrow,
  title,
  sub,
  maxWidth = 520,
  corner,
  children,
}: {
  eyebrow: string;
  title: string;
  sub?: string;
  maxWidth?: number;
  /** D106 — the top-right skip affordance slot. */
  corner?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '40px 24px',
        background: color.bg,
        fontFamily: font.sans,
        position: 'relative',
      }}
    >
      {corner && <div style={{ position: 'absolute', top: 20, right: 24 }}>{corner}</div>}
      <div
        style={{
          width: '100%',
          maxWidth,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1
          style={{
            fontFamily: font.display,
            fontSize: 30,
            fontWeight: 600,
            letterSpacing: '-0.02em',
            margin: '6px 0 4px',
          }}
        >
          {title}
        </h1>
        {sub && (
          <p style={{ color: color.fgMuted, fontSize: 14, margin: '0 0 24px', maxWidth: 460 }}>
            {sub}
          </p>
        )}
        {children}
      </div>
    </main>
  );
}
