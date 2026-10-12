'use client';

import { Button } from '@declutrmail/shared';
import type { HomeVisitSummary } from '@declutrmail/shared/contracts/home-visit';
import { pluralCopy, WS2_COPY } from '@declutrmail/shared/copy/launch';
import { useHomeVisit } from './api/use-home-visit';
import styles from './home-view.module.css';

const sinceLast = WS2_COPY.liveFix.home.sinceLast;

function counted(copy: { readonly one: string; readonly other: string }, n: number): string {
  return pluralCopy(copy, n, { n: n.toLocaleString('en-US') });
}

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
    <section className={styles.beginning} aria-label={sinceLast.eyebrow}>
      <span className={styles.eyebrow}>{sinceLast.eyebrow}</span>
      <h2>
        {data.indexedEmails === 0 ? sinceLast.none : counted(sinceLast.title, data.indexedEmails)}
      </h2>
      {data.indexedSenders > 0 ? <p>{counted(sinceLast.senders, data.indexedSenders)}</p> : null}
    </section>
  );
}
