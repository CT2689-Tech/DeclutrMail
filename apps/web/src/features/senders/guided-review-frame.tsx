'use client';

import type { ReactNode } from 'react';
import { Avatar, Button, tokens } from '@declutrmail/shared';
import styles from './sender-workspace.module.css';

const { color, text } = tokens;

/** Presentation only. Navigation never dispatches an email action or resolves a review. */
export function GuidedReviewFrame({
  senders,
  index,
  label,
  onNavigate,
  onExit,
  navigationDisabled = false,
  children,
}: {
  senders: readonly { id: string; name: string; domain: string; brandMark: boolean }[];
  index: number;
  label: string;
  onNavigate: (index: number) => void;
  onExit: () => void;
  navigationDisabled?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={styles.guidedReview} aria-label="Guided review">
      <header className={styles.guidedHeader}>
        <div>
          <Button tone="ghost" onClick={onExit} disabled={navigationDisabled}>
            Back to Senders
          </Button>
          <h1 style={{ margin: '8px 0', fontFamily: tokens.font.display, fontWeight: 400 }}>
            Guided Review
          </h1>
          <p style={{ margin: 0, color: color.fgMuted, fontSize: text.sm }}>{label}</p>
        </div>
        <div className={styles.guidedNavigation} aria-label="Review navigation">
          <span role="status" style={{ fontSize: text.sm, fontVariantNumeric: 'tabular-nums' }}>
            {senders.length ? `${index + 1} of ${senders.length}` : 'No senders to review'}
          </span>
          <Button onClick={() => onNavigate(index - 1)} disabled={navigationDisabled || index <= 0}>
            Previous
          </Button>
          <Button
            onClick={() => (index >= senders.length - 1 ? onExit() : onNavigate(index + 1))}
            disabled={navigationDisabled || senders.length === 0}
          >
            {index >= senders.length - 1 ? 'Finish review' : 'Next sender'}
          </Button>
        </div>
      </header>
      <div className={styles.guidedColumns}>
        {senders.length > 0 && (
          <nav className={styles.guidedQueue} aria-label="Senders in this review">
            {senders.map((sender, position) => (
              <button
                type="button"
                key={sender.id}
                className={styles.guidedQueueItem}
                aria-current={position === index ? 'step' : undefined}
                disabled={navigationDisabled}
                onClick={() => onNavigate(position)}
              >
                <Avatar
                  name={sender.name}
                  domain={sender.domain}
                  hasMark={sender.brandMark}
                  size={32}
                />
                <span>{sender.name}</span>
              </button>
            ))}
          </nav>
        )}
        <div style={{ minWidth: 0 }}>{children}</div>
      </div>
    </section>
  );
}
