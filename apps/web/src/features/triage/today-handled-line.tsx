'use client';

import { useEffect } from 'react';
import { tokens } from '@declutrmail/shared';
import { captureFeatureException } from '@/lib/sentry';
import { useTodaySummary } from './api/use-triage-queue';

const { color, text } = tokens;

/**
 * D214 — the one "today" fact kept from the retired Today strip: what
 * DeclutrMail did without being asked, stated once, on the completion
 * screen. The number is the BE's real aggregate (never a client
 * estimate), read off the bootstrap entry the queue already fetched.
 *
 * States: loading → nothing; zero → nothing (a hollow "handled 0" is
 * noise); error → nothing rendered, but the failure is OBSERVED — never
 * an invisible swallow.
 */
export function TodayHandledLine() {
  const summary = useTodaySummary();

  useEffect(() => {
    if (!summary.isError) return;
    captureFeatureException(summary.error, { surface: 'triage', reason: 'today_summary' });
  }, [summary.isError, summary.error]);

  const handled = summary.data?.handledAutomatically;
  if (typeof handled !== 'number' || handled <= 0) return null;
  return <TodayHandledLineView handled={handled} />;
}

/** Presentational half — split so stories and tests render it without a network. */
export function TodayHandledLineView({ handled }: { handled: number }) {
  return (
    <p style={{ margin: 0, fontSize: text.sm, color: color.fgMuted }}>
      DeclutrMail handled {handled.toLocaleString('en-US')} automatically today.
    </p>
  );
}
