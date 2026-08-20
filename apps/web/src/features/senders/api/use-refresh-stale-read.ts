'use client';

/**
 * `useRefreshStaleRead` — when someone opens a sender whose engine read
 * has aged out, ask for a fresh one (D25 `stale_refresh`).
 *
 * Why this exists: three score triggers fire in production and none of
 * them revisits a sender. `sync_complete` scores every sender once, at
 * initial sync; `signal_change` fires only for a first-seen sender;
 * `manual_rescore` is someone pressing a control. The documented weekly
 * `cron_sweep` has no producer. So a read is written once and then ages
 * forever — 8,448 of the founder's 8,531 decisions were past their TTL
 * when this shipped, nearly all produced on the day of the initial sync.
 *
 * Founder decision 2026-08-19: refresh lazily, on attention, rather than
 * sweeping the whole mailbox weekly. The spend follows the reads people
 * actually look at.
 *
 * Deliberate properties:
 *
 *   - **Once per sender per tab-session.** A ref guard covers React
 *     StrictMode's double-mount and re-renders; `sessionStorage` covers
 *     reloads. Without the second, refreshing a stale sender five times
 *     while the worker is still scoring enqueues five LLM calls — the
 *     read only stops being stale once the fresh row lands, so the page
 *     would keep asking in the meantime.
 *   - **Silent on failure.** A fresher opinion is an enhancement; the
 *     page already renders the old read with its age. A failed refresh
 *     must not surface an error over a working page.
 *   - **One delayed refetch.** Scoring is a queued job, so the fresh row
 *     lands a second or two later. We refetch once and stop; if the
 *     worker was slower, the age label simply stays until the next
 *     visit. No polling loop chasing a row that may never change.
 */

import { useEffect, useRef } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { requestSenderRescore } from '@/lib/api/senders';

/** How long to wait before looking for the fresh row. */
export const RESCORE_SETTLE_MS = 4_000;

/**
 * Whether this tab already asked for this sender. `sessionStorage` and
 * not a module Set, because a reload is exactly the case the ref guard
 * cannot see. Storage failures (private mode, quota) fall through to
 * "not asked" — a duplicate re-score is a far smaller problem than a
 * page that throws.
 */
function alreadyAsked(senderId: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const key = `dm.rescore.${senderId}`;
    if (window.sessionStorage.getItem(key)) return true;
    window.sessionStorage.setItem(key, '1');
    return false;
  } catch {
    return false;
  }
}

export function useRefreshStaleRead(
  senderId: string,
  read: { stale?: boolean } | null | undefined,
  options: { enabled?: boolean; settleMs?: number; invalidate: QueryKey },
) {
  const queryClient = useQueryClient();
  const askedFor = useRef<string | null>(null);
  const { enabled = true, settleMs = RESCORE_SETTLE_MS, invalidate } = options;
  // Held in a ref, not a dep. A query key is an array, so a caller
  // building one inline (`sendersKeys.detail(id)`) hands us a fresh
  // reference every render — as a dep that re-runs the effect on every
  // parent render, and the only thing standing between that and a
  // rescore-per-render is the guard below. The key is read at settle
  // time, so the latest one is the right one.
  const invalidateRef = useRef(invalidate);
  invalidateRef.current = invalidate;
  // `null` read = never scored; `stale` = scored, past its TTL. Both are
  // worth a look; a fresh read is not.
  const wants = read === null || read?.stale === true;

  useEffect(() => {
    if (!enabled || !wants || senderId.length === 0) return;
    if (askedFor.current === senderId) return;
    askedFor.current = senderId;
    if (alreadyAsked(senderId)) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    void requestSenderRescore(senderId, 'stale')
      .then(() => {
        timer = setTimeout(() => {
          void queryClient.invalidateQueries({ queryKey: invalidateRef.current });
        }, settleMs);
      })
      .catch(() => {
        // Swallowed on purpose — see the "silent on failure" note above.
      });

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [enabled, wants, senderId, queryClient, settleMs]);
}
