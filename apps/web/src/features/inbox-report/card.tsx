'use client';

import type { JSX } from 'react';

import { WS5_COPY } from '@declutrmail/shared/copy/launch';

import styles from './card.module.css';

/** Home re-entry for the signed-in Inbox Report. */
export function InboxReportCard(props: { surface: 'home'; mailboxId: string }): JSX.Element | null {
  if (props.surface !== 'home') return null;
  const titleId = `inbox-report-home-title-${props.mailboxId}`;
  return (
    <a
      className={styles.card}
      href="/senders"
      data-surface="home"
      data-mailbox={props.mailboxId}
      aria-labelledby={titleId}
    >
      <strong id={titleId} className={`${styles.title} dm-home-report-title`}>
        {WS5_COPY['report.home.title']}
      </strong>
      <span className={`${styles.body} dm-home-report-body`}>{WS5_COPY['report.home.body']}</span>
      <span className="dm-home-report-cta">{WS5_COPY['report.home.cta']}</span>
    </a>
  );
}
