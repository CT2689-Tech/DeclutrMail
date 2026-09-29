import type { CSSProperties, ReactNode } from 'react';
import { tokens } from '@declutrmail/shared';
import styles from './page.module.css';

/** Shared app-page rhythm. Presentation only: feature containers keep their reads and actions. */
export const editorialColumnStyle: CSSProperties = {
  padding: '28px clamp(16px, 3vw, 40px) 40px',
  width: '100%',
  minWidth: 0,
  boxSizing: 'border-box',
  maxWidth: 1120,
  margin: '0 auto',
  fontFamily: tokens.font.sans,
};

export const editorialTitleStyle: CSSProperties = {
  margin: 0,
  fontFamily: tokens.font.display,
  fontSize: 'clamp(30px, 3.1vw, 42px)',
  fontWeight: 400,
  lineHeight: 1.12,
  letterSpacing: '-0.035em',
  color: tokens.color.fg,
  overflowWrap: 'anywhere',
};

/** A short orientation label, not a second help system or a claimed account status. */
export function EditorialKicker({ children }: { children: ReactNode }) {
  return <p className={styles.kicker}>{children}</p>;
}

export function EditorialDescription({ children }: { children: ReactNode }) {
  return <p className={styles.description}>{children}</p>;
}

/** In-page orientation for long reading and settings surfaces. */
export function EditorialContents({
  items,
  label = 'On this page',
}: {
  items: readonly { href: string; label: string }[];
  label?: string;
}) {
  return (
    <nav aria-label={label} className={styles.contents}>
      {items.map((item) => (
        <a key={item.href} href={item.href}>
          {item.label}
        </a>
      ))}
    </nav>
  );
}

/** A compact readout of feature-owned facts; callers supply already-scoped values. */
export function EditorialStats({ items }: { items: { label: string; value: number }[] }) {
  return (
    <dl className={styles.stats}>
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value.toLocaleString('en-US')}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Fits the inner onboarding panel, including long pending/goal labels at 320px. */
export const editorialOnboardingActionStyle: CSSProperties = {
  minWidth: 'min(240px, 100%)',
  maxWidth: '100%',
  minHeight: 50,
  height: 'auto',
  padding: '12px 20px',
  whiteSpace: 'normal',
  overflowWrap: 'anywhere',
  lineHeight: 1.4,
};
