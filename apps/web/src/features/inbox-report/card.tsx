'use client';

import type { JSX } from 'react';

import { WS5_COPY } from '@declutrmail/shared/copy/launch';

import styles from './card.module.css';

/** Home re-entry for the signed-in Inbox Report. */
export function InboxReportCard(props: { surface: 'home'; mailboxId: string }): JSX.Element | null {
  if (props.surface !== 'home') return null;
  const titleId = `inbox-report-home-title-${props.mailboxId}`;
  return (
    <section
      className={styles.card}
      data-surface="home"
      data-mailbox={props.mailboxId}
      aria-labelledby={titleId}
    >
      <h2 id={titleId} className={styles.title}>
        {WS5_COPY['report.home.title']}
      </h2>
      <p className={styles.body}>{WS5_COPY['report.home.body']}</p>
      <a href="/senders" data-dm-button="" className="dm-button-link">
        {WS5_COPY['report.home.cta']}
      </a>
    </section>
  );
}
