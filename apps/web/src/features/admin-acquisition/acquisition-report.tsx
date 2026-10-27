'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, EmptyState, ErrorState } from '@declutrmail/shared';
import {
  SIGNUP_HEARD_FROM_CHOICES,
  type SignupAttributionReport,
} from '@declutrmail/shared/contracts';
import { useAuth } from '@/features/auth/auth-provider';
import { ApiError } from '@/lib/api/client';
import { readSignupAttributionReport } from '@/lib/api/signup-attribution-report';
import styles from './acquisition-report.module.css';

export function AdminAcquisitionReport() {
  const { me } = useAuth();
  const query = useQuery({
    queryKey: ['admin', 'signup-attribution', me.user.id],
    queryFn: ({ signal }) => readSignupAttributionReport(signal),
    staleTime: 60_000,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const refresh = () => void query.refetch();
  if (query.error instanceof ApiError && [401, 403, 404].includes(query.error.status)) {
    return <AcquisitionReportView state={{ kind: 'not-found' }} />;
  }
  if (query.data) {
    return (
      <AcquisitionReportView
        state={{
          kind: 'ready',
          report: query.data,
          refreshing: query.isFetching,
          refreshFailed: query.isError,
          onRefresh: refresh,
        }}
      />
    );
  }
  if (query.isError) return <AcquisitionReportView state={{ kind: 'error', onRetry: refresh }} />;
  return <AcquisitionReportView state={{ kind: 'loading' }} />;
}

export type AcquisitionReportState =
  | { kind: 'loading' }
  | { kind: 'not-found' }
  | { kind: 'error'; onRetry: () => void }
  | {
      kind: 'ready';
      report: SignupAttributionReport;
      refreshing: boolean;
      refreshFailed: boolean;
      onRefresh: () => void;
    };

/** Operator-only aggregate; the API guard is the access boundary. */
export function AcquisitionReportView({ state }: { state: AcquisitionReportState }) {
  const [showUnused, setShowUnused] = useState(false);
  if (state.kind === 'not-found')
    return (
      <div className={styles.page}>
        <EmptyState
          title="Not found"
          description="This page does not exist or is not available for your account."
        />
      </div>
    );
  if (state.kind === 'loading')
    return (
      <div className={styles.page}>
        <p role="status">Loading…</p>
      </div>
    );
  if (state.kind === 'error')
    return (
      <div className={styles.page}>
        <ErrorState
          title="Couldn’t load the report"
          description="Try again in a moment."
          onRetry={state.onRetry}
        />
      </div>
    );

  const { report } = state;
  const labels = new Map<string, string>(
    SIGNUP_HEARD_FROM_CHOICES.map((choice) => [choice.value, choice.label]),
  );
  labels.set('other', 'Other');
  const rows = report.channels
    .filter((row) => showUnused || row.count > 0)
    .sort(
      (a, b) =>
        b.count - a.count ||
        (labels.get(a.channel) ?? a.channel).localeCompare(labels.get(b.channel) ?? b.channel),
    );
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Source answers</h1>
          <p>How people say they first heard about DeclutrMail.</p>
        </div>
        <Button tone="default" size="lg" disabled={state.refreshing} onClick={state.onRefresh}>
          {state.refreshing ? 'Refreshing…' : 'Refresh'}
        </Button>
      </header>
      <p className={styles.context}>
        All accounts · All time · Updated{' '}
        <time dateTime={report.observedAt}>
          {new Date(report.observedAt).toLocaleString('en-US', {
            timeZone: 'America/Los_Angeles',
            timeZoneName: 'short',
          })}
        </time>
      </p>
      {state.refreshFailed && (
        <p role="status" className={styles.warning}>
          Couldn’t refresh. Showing the last successful snapshot.
        </p>
      )}
      <dl className={styles.totals}>
        {(
          [
            ['Accounts', report.totalAccounts],
            ['Answered', report.answered],
            ['Skipped', report.skipped],
            ['Unanswered', report.unanswered],
          ] as const
        ).map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value.toLocaleString('en-US')}</dd>
          </div>
        ))}
      </dl>
      <section className={styles.panel} aria-labelledby="source-answers-heading">
        <div className={styles.tableHeading}>
          <h2 id="source-answers-heading">Saved answers</h2>
          <Button
            tone="ghost"
            size="lg"
            ariaPressed={showUnused}
            onClick={() => setShowUnused(!showUnused)}
          >
            {showUnused ? 'Hide unused channels' : 'Show unused channels'}
          </Button>
        </div>
        {rows.length || report.unrecognized ? (
          <table>
            <caption className={styles.srOnly}>Self-reported source answers by channel</caption>
            <thead>
              <tr>
                <th scope="col">Channel</th>
                <th scope="col">Answers</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.channel}>
                  <th scope="row">{labels.get(row.channel) ?? row.channel}</th>
                  <td>{row.count.toLocaleString('en-US')}</td>
                </tr>
              ))}
              {report.unrecognized > 0 && (
                <tr>
                  <th scope="row">Unrecognized answer</th>
                  <td>{report.unrecognized.toLocaleString('en-US')}</td>
                </tr>
              )}
            </tbody>
          </table>
        ) : (
          <p>No answers have been saved yet.</p>
        )}
      </section>
      <aside className={styles.notes} aria-label="About these counts">
        <p>
          These totals include internal and test accounts. They are saved answers, not verified
          acquisition sources.
        </p>
        <p>
          Answer dates aren’t recorded, so this is an all-time snapshot. Skips and unanswered
          accounts are shown separately; this is not a response rate.
        </p>
        <p>
          Tracked referral links are a separate signal. “Other” details and account identities
          aren’t included in this report.
        </p>
      </aside>
      <nav className={styles.links} aria-label="Admin reports">
        <Link href="/admin/security">Security events</Link>
      </nav>
    </div>
  );
}
