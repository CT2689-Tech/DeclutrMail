'use client';

import { Button } from '@declutrmail/shared';
import styles from './quiet-watch.module.css';

/** The selected Quiet watch layout, driven only by confirmed rule state. */
export function QuietWatch({
  watching,
  automatic,
  paused,
  onReview,
}: {
  watching: number;
  automatic: number;
  paused: boolean;
  onReview: () => void;
}) {
  const running = watching + automatic;
  return (
    <section className={styles.hero} aria-labelledby="quiet-watch-heading">
      <div>
        <p className={styles.status}>
          {running === 0
            ? paused
              ? 'Paused'
              : 'Ready when you are'
            : `${watching} watching${automatic > 0 ? ` · ${automatic} automatic` : ''}`}
        </p>
        <h2 id="quiet-watch-heading">
          {running === 0 ? (
            paused ? (
              'Your rules are taking a pause.'
            ) : (
              'A lighter inbox starts here.'
            )
          ) : automatic > 0 ? (
            'A little more on autopilot.'
          ) : (
            <>
              Watching your inbox.
              <br />
              Waiting for your say.
            </>
          )}
        </h2>
        <p className={styles.description}>
          {running === 0
            ? paused
              ? 'Review your saved rules when you’re ready.'
              : 'Choose senders and save your first rule. Preview before anything moves.'
            : automatic > 0
              ? 'Active presets handle their matches. Sender rules always ask first.'
              : 'Your rules find the matches. You decide what happens next.'}
        </p>
        <Button tone="primary" onClick={onReview}>
          Review rules
        </Button>
      </div>
      <ol className={styles.path} aria-label="How watching works">
        <li>
          <span aria-hidden="true">↥</span>
          <div>
            <strong>Your inbox</strong>
            <small>Sender history</small>
          </div>
        </li>
        <li>
          <span aria-hidden="true">◌</span>
          <div>
            <strong>Autopilot watches</strong>
            <small>Matches your enabled rules</small>
          </div>
        </li>
        <li>
          <span aria-hidden="true">✓</span>
          <div>
            <strong>Your say</strong>
            <small>Preview and approve</small>
          </div>
        </li>
      </ol>
    </section>
  );
}
