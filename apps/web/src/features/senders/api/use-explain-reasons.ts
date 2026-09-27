'use client';

/**
 * `useExplainReasons` — ask for the LLM sentence behind reasons that are
 * still the deterministic template, and pick the sentence up when it lands
 * (D24; founder decision 2026-09-25: explain only what the user is about to
 * see).
 *
 * The score worker no longer buys a sentence for every sender when a mailbox
 * becomes ready — only for the first Triage queue and the loudest senders. So
 * each surface that shows reasons asks for the rest itself: Triage for its
 * queue, Sender Detail for the sender it opened, the Screener for the row it
 * expanded.
 *
 * Two jobs, kept apart:
 *
 *   - **Ask** for every read passed in, once per row version per app
 *     session. Keyed by sender and `scoredAt`, in a map owned by the
 *     QueryClient, so a re-render, a remount, or a second surface showing
 *     the same sender is one ask — and a re-scored row, a new version, gets
 *     its own. The server dedupes too: its job id is the row version.
 *   - **Look again** only for the reads whose reason is on screen
 *     (`showing`), on a short schedule timed from when each was ASKED. A row
 *     asked about a while ago and opened now is looked at immediately; its
 *     sentence has most likely landed. The schedule restarts only when the
 *     set on screen changes, so it ends; a sentence that never comes leaves
 *     the template, which is a correct explanation. Triage asks for its
 *     whole queue but shows one reason at a time, so its queue never polls.
 *
 * Only rows that need it. A read with no provenance (an API predating the
 * field, a fixture) makes no claim, so it asks nothing. A STALE read is the
 * caller's call, because only the caller knows whether it is re-scoring it
 * right now (`useRefreshStaleRead` — the re-score buys its own sentence, so
 * explaining too would pay twice): pass a stale read only where no re-score
 * is running, like the action sheet.
 *
 * Failures are silent, like the stale refresh — the template is already on
 * screen, and already true — but not final: a failed ask is forgotten, so
 * the next change to the rows asks again.
 */

import { useEffect, useRef } from 'react';
import { useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { EXPLAIN_BATCH_MAX } from '@declutrmail/shared/contracts';
import { requestExplanations } from '@/lib/api/senders';

/**
 * When to look again, measured from the ask. The last look sits past the
 * worker's LLM timeout (12s in production) plus queue pickup, so a slow
 * but successful sentence still lands on an open page.
 */
export const EXPLAIN_SETTLE_MS: readonly number[] = [4_000, 12_000, 25_000];

/** A reason, as the surfaces already carry it. */
export interface ExplainableRead {
  senderId: string;
  generatedBy?: 'llm_haiku' | 'template' | undefined;
  scoredAt?: string | undefined;
}

/** When each row version was asked about, per app session (one QueryClient). */
const askedByClient = new WeakMap<QueryClient, Map<string, number>>();

function askedFor(client: QueryClient): Map<string, number> {
  let asked = askedByClient.get(client);
  if (!asked) {
    asked = new Map();
    askedByClient.set(client, asked);
  }
  return asked;
}

/**
 * The reads still on the template, as one sorted string of row versions —
 * so an effect follows which rows need a sentence, not the array identity
 * of every render.
 */
function templateVersions(reads: readonly ExplainableRead[]): string {
  return reads
    .filter((r) => r.senderId.length > 0 && r.generatedBy === 'template')
    .map((r) => `${r.senderId} ${r.scoredAt ?? ''}`)
    .sort()
    .join('\n');
}

function split(versions: string): string[] {
  return versions === '' ? [] : versions.split('\n');
}

export function useExplainReasons(
  reads: readonly ExplainableRead[],
  options: {
    enabled?: boolean;
    invalidate: QueryKey;
    /**
     * Re-read only the query at exactly `invalidate`, not the ones under
     * it — when the reason lives in a parent whose children (messages,
     * history, charts) an explanation cannot change.
     */
    exact?: boolean;
    /**
     * The reads whose reason is on screen now. Defaults to `reads`: a
     * surface showing one reason is showing everything it asked about.
     */
    showing?: readonly ExplainableRead[];
    settleMs?: readonly number[];
  },
): void {
  const queryClient = useQueryClient();
  const { enabled = true, exact = false, settleMs = EXPLAIN_SETTLE_MS } = options;
  // Held in a ref, not a dep — a caller building the key inline hands us a
  // fresh array every render. Read at settle time, so the latest is right.
  const invalidateRef = useRef(options.invalidate);
  invalidateRef.current = options.invalidate;
  const askKey = enabled ? templateVersions(reads) : '';
  const showKey = enabled ? templateVersions(options.showing ?? reads) : '';
  const schedule = settleMs.join(',');

  // Ask. Declared first, so the ask time exists before the look reads it.
  useEffect(() => {
    const asked = askedFor(queryClient);
    const fresh = [...new Set([...split(askKey), ...split(showKey)])].filter(
      (version) => !asked.has(version),
    );
    if (fresh.length === 0) return;
    const now = Date.now();
    for (const version of fresh) asked.set(version, now);
    const ids = [...new Set(fresh.map((version) => version.slice(0, version.indexOf(' '))))];
    for (let i = 0; i < ids.length; i += EXPLAIN_BATCH_MAX) {
      const batch = new Set(ids.slice(i, i + EXPLAIN_BATCH_MAX));
      void requestExplanations([...batch]).catch(() => {
        // Nothing shown — the template on screen is already true. But
        // forgotten, so the next change to the rows asks again.
        for (const version of fresh) {
          if (batch.has(version.slice(0, version.indexOf(' ')))) asked.delete(version);
        }
      });
    }
  }, [askKey, showKey, queryClient]);

  // Look again, for what is on screen — timed from each ask.
  useEffect(() => {
    if (showKey === '' || schedule === '') return;
    const asked = askedFor(queryClient);
    const now = Date.now();
    const due = new Set<number>();
    for (const version of split(showKey)) {
      const askedAt = asked.get(version) ?? now;
      for (const ms of schedule.split(',')) due.add(Math.max(0, askedAt + Number(ms) - now));
    }
    const timers = [...due].map((ms) =>
      setTimeout(
        () =>
          void queryClient.invalidateQueries({
            queryKey: invalidateRef.current,
            ...(exact ? { exact: true } : {}),
          }),
        ms,
      ),
    );
    return () => timers.forEach(clearTimeout);
  }, [showKey, schedule, exact, queryClient]);
}
