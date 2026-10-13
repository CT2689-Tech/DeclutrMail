'use client';

import { useLayoutEffect, useState } from 'react';
import { Button } from '@declutrmail/shared';
import type { HomeVisitSummary } from '@declutrmail/shared/contracts/home-visit';
import { pluralCopy, WS2_COPY } from '@declutrmail/shared/copy/launch';
import { useHomeVisit } from './api/use-home-visit';
import { formatCount } from './home-deck-copy';
import styles from './home-view.module.css';

const sinceLast = WS2_COPY.liveFix.home.sinceLast;

function sinceLastCount(forms: { readonly one: string; readonly other: string }, count: number) {
  return pluralCopy(forms, count, { n: formatCount(count) });
}

export function HomeArrivals() {
  const visit = useHomeVisit();
  // Same first paint on the server and in the browser. The visit id lives
  // in localStorage, so a sync read would render a different tree (#418).
  const [painted, setPainted] = useState(false);
  useLayoutEffect(() => {
    setPainted(true);
  }, []);
  if (!painted) return null;
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
  const title =
    data.indexedEmails === 0 ? sinceLast.none : sinceLastCount(sinceLast.title, data.indexedEmails);
  const senders =
    data.indexedSenders === 0 ? null : sinceLastCount(sinceLast.senders, data.indexedSenders);
  return (
    <section className={`${styles.beginning} ${styles.arrivals}`} aria-label={sinceLast.eyebrow}>
      <span className={styles.eyebrow}>{sinceLast.eyebrow}</span>
      <h2>{title}</h2>
      {senders !== null && <p>{senders}</p>}
    </section>
  );
}
