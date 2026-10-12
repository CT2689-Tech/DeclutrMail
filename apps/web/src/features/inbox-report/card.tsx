'use client';

import type { JSX, ReactNode } from 'react';

import { WS5_COPY } from '@declutrmail/shared/copy/launch';

import styles from './card.module.css';

/** Home re-entry for the signed-in Inbox Report. */
export function InboxReportCard(props: {
  surface: 'home';
  mailboxId: string;
  /** Report lead. Sits at the top of the card shell, outside the action link. */
  lead?: ReactNode;
}): JSX.Element | null {
  if (props.surface !== 'home') return null;
  return (
    <div className={styles.card} data-surface="home" data-mailbox={props.mailboxId}>
      {props.lead != null && <div className={styles.lead}>{props.lead}</div>}
      <h2 className={`${styles.title} dm-home-report-title`}>{WS5_COPY['report.home.title']}</h2>
      <span className={`${styles.body} dm-home-report-body`}>{WS5_COPY['report.home.body']}</span>
      <a
        className={`${styles.cta} dm-home-report-cta dm-button-link`}
        data-dm-button=""
        href="/senders"
      >
        {WS5_COPY['report.home.cta']}
      </a>
    </div>
  );
}
