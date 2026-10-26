'use client';

import { editorialTitleStyle } from '@/features/editorial/page';

import type { ReactNode } from 'react';
import { OnboardingPhase, type OnboardingPhaseName } from './onboarding-phase';
import { tokens } from '@declutrmail/shared';
import styles from './onboarding-appearance.module.css';

const { color, font } = tokens;

/**
 * Shared chrome for the onboarding steps that are NOT the sync gate
 * (D106). Mirrors the sync gate's centered single-column shell so the
 * five steps read as one flow: a title, at most one sentence, the
 * control. The gate keeps its own state and shell, with the same
 * presentation roles.
 */
export function StepShell({
  title,
  phase,
  sub,
  maxWidth = 520,
  corner,
  children,
}: {
  title: string;
  phase: OnboardingPhaseName;
  /** At most one sentence. */
  sub?: string;
  maxWidth?: number;
  /** D106 — the top-right skip affordance slot. */
  corner?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main
      className={styles.page}
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        background: color.bg,
        fontFamily: font.sans,
        position: 'relative',
      }}
    >
      {corner && <div style={{ position: 'absolute', top: 20, right: 24 }}>{corner}</div>}
      <div
        className={styles.panel}
        style={{
          maxWidth: maxWidth + 48,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <OnboardingPhase phase={phase} />
        <h1 style={{ ...editorialTitleStyle, margin: '0 0 12px' }}>{title}</h1>
        {sub && <p className={styles.description}>{sub}</p>}
        {children}
      </div>
    </main>
  );
}
