'use client';

import styles from './quiet-watch.module.css';

/** A compact status, driven only by confirmed rule state. */
export function QuietWatch({
  watching,
  automatic,
  paused,
}: {
  watching: number;
  automatic: number;
  paused: boolean;
}) {
  const running = watching + automatic;
  return (
    <section className={styles.status} aria-label="Autopilot status">
      <div>
        <strong>
          {running === 0
            ? paused
              ? 'Rules paused'
              : 'No rules watching yet'
            : `${watching} watching${automatic > 0 ? ` · ${automatic} automatic` : ''}`}
        </strong>
        <span>
          {running === 0
            ? 'Choose a rule to get started.'
            : automatic > 0
              ? 'Automatic rules run on future matches. Other rules ask first.'
              : 'Watching rules wait for your approval.'}
        </span>
      </div>
    </section>
  );
}
