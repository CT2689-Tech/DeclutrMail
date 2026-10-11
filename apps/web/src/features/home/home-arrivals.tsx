'use client';

import { Button } from '@declutrmail/shared';
import type { HomeVisitSummary } from '@declutrmail/shared/contracts/home-visit';
import { useHomeVisit } from './api/use-home-visit';
import styles from './home-view.module.css';

export function HomeArrivals() {
  const visit = useHomeVisit();
  return (
    <HomeArrivalsView data={visit.data} error={visit.isError} retry={() => void visit.refetch()} />
  );
}

export function HomeArrivalsView({
  data,
  error,
  retry,
}: {
  data?: HomeVisitSummary | undefined;
  error: boolean;
  retry: () => void;
}) {
  if (error)
    return (
      <p>
        Couldn’t load changes since your visit.{' '}
        <Button tone="ghost" onClick={retry}>
          Try again
        </Button>
      </p>
    );
  if (!data?.since || data.indexedEmails === null || data.indexedSenders === null) return null;
  return (
    <section className={styles.beginning} aria-label="Since your previous visit">
      <span className={styles.eyebrow}>Since your previous visit</span>
      <h2>
        {data.indexedEmails.toLocaleString('en-US')} {data.indexedEmails === 1 ? 'email' : 'emails'}{' '}
        newly indexed
      </h2>
      <p>
        {data.indexedSenders.toLocaleString('en-US')}{' '}
        {data.indexedSenders === 1 ? 'sender' : 'senders'} added to this inbox’s index.
      </p>
      <p className={styles.footnote}>
        From your previous visit until this visit began. Counts cover the retained index. Existing
        review tasks appear below.
      </p>
    </section>
  );
}
