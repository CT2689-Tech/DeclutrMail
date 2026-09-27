'use client';

import { useEffect, useState } from 'react';
import type { SyncMessageProgress } from '@declutrmail/shared/contracts';

/**
 * Time left on the sync gate's "12,400 of 40,898 emails" line (D109,
 * reversed 2026-09-26 — see the plan's marker) — from the worker's own
 * batches, never a fixed rate.
 *
 * A point is a batch: its count, placed at the moment the worker wrote it
 * (seen at `receivedAt`, written `age_ms` before) — so how late a poll saw
 * it cannot shrink or stretch the rate. Counts already on screen at first
 * render are not a point: when they were seen is unknown. The time is the
 * average rate since the track started, counted down between batches. It
 * first shows once two gaps agree — within half again of each other, per
 * email — since one gap alone can hold a pause; until they do, the pace is
 * measured again from the later gap.
 *
 * The track starts over when the counts go away, drop or change total,
 * and when a batch lands after a stall against the pace already seen. A
 * batch far faster than the pace so far means an earlier gap held a pause:
 * the pace is measured again from that batch's gap. Gaps are judged per
 * email, never per step — a failed read can hide batches inside one step.
 * A hidden tab measures the pace again on return. So a pause is not averaged into the pace
 * around it, while a slow scan's minutes-long gaps still count as its pace.
 * The time is dropped when batches stop arriving at their usual pace, and
 * when it runs out.
 */

/** No batch for this many usual gaps means the rate no longer holds. */
const STALE_GAPS = 3;
/** …but never sooner than this — one slow batch is not a stall. */
const STALE_FLOOR_MS = 60_000;
/** Gaps a time needs: one alone can hold a pause, and nothing would say so. */
const MIN_STEPS = 2;
/** How far apart, per email, the first two gaps may be and still agree. */
const AGREE = 1.5;
/** How often a shown time re-checks that it is still backed. */
const TICK_MS = 10_000;

interface Point {
  /** When the worker wrote this count, on this tab's clock. */
  at: number;
  processed: number;
}

export interface ScanTrack {
  /** The last observation — what the next one is compared to. */
  seen: SyncMessageProgress | null;
  /** First batch since the track (re)started. */
  first: Point | null;
  /** Latest batch. */
  last: Point | null;
  /** Batches seen after `first` — the time needs `MIN_STEPS`. */
  steps: number;
  /** Fewest emails between two batches seen: one batch. */
  batch: number | null;
}

export function startScanTrack(seen: SyncMessageProgress | null): ScanTrack {
  return { seen, first: null, last: null, steps: 0, batch: null };
}

/** Milliseconds per email since the track started. */
function msPerEmail({ first, last }: ScanTrack): number {
  return first && last && last.processed > first.processed
    ? (last.at - first.at) / (last.processed - first.processed)
    : 0;
}

function staleAfter(track: ScanTrack): number {
  const usualGap = (track.batch ?? 0) * msPerEmail(track);
  return Math.max(STALE_FLOOR_MS, STALE_GAPS * usualGap);
}

/** Fold in one observation, seen at `receivedAt` (this tab's clock). */
export function observeScan(
  track: ScanTrack,
  progress: SyncMessageProgress | null,
  receivedAt: number,
): ScanTrack {
  if (progress === null) {
    return startScanTrack(null);
  }
  const { seen, first, last, steps } = track;
  // The same batch again: already placed, and its first placement stands.
  if (last && seen && seen.total === progress.total && last.processed === progress.processed) {
    return { ...track, seen: progress };
  }
  const point = { at: receivedAt - progress.age_ms, processed: progress.processed };
  const restarted =
    first === null ||
    last === null ||
    seen === null ||
    progress.total !== seen.total ||
    progress.processed < last.processed ||
    // A long gap is a stall only against a pace already seen: each batch
    // is timed by its write, and a slow scan's gaps are minutes long.
    (steps > 0 && point.at - last.at > staleAfter(track));
  if (restarted) {
    return { seen: progress, first: point, last: point, steps: 0, batch: null };
  }
  const read = point.processed - last.processed;
  const batch = Math.min(track.batch ?? read, read);
  // Far faster per email than the pace so far: an earlier gap held a pause
  // (a slow first read, a retry's backoff, a tab that came back mid-pause).
  // Measure again from this gap alone.
  const pace = (point.at - last.at) / read;
  if (steps > 0 && pace * STALE_GAPS < msPerEmail(track)) {
    return { seen: progress, first: last, last: point, steps: 1, batch };
  }
  // The first time shown needs its two gaps to agree; otherwise measure
  // again from the later one. Positive form, so a NaN measures again.
  if (steps === 1) {
    const before = msPerEmail(track);
    if (!(Math.max(pace, before) <= AGREE * Math.min(pace, before))) {
      return { seen: progress, first: last, last: point, steps: 1, batch };
    }
  }
  return { seen: progress, first, last: point, steps: steps + 1, batch };
}

/** Milliseconds left as of `now`, or `null` when nothing backs a time. */
export function scanMsLeft(track: ScanTrack, now: number): number | null {
  const { seen, first, last, steps } = track;
  if (seen === null || first === null || last === null || steps < MIN_STEPS) {
    return null;
  }
  const elapsed = last.at - first.at;
  const read = last.processed - first.processed;
  const remaining = seen.total - last.processed;
  const sinceLast = now - last.at;
  // Positive form, so a NaN anywhere fails closed.
  if (!(elapsed > 0 && read > 0 && remaining > 0 && sinceLast <= staleAfter(track))) {
    return null;
  }
  const left = (remaining * elapsed) / read - sinceLast;
  return left > 0 ? left : null;
}

function sameObservation(a: SyncMessageProgress | null, b: SyncMessageProgress | null): boolean {
  return (
    a === b ||
    (a !== null &&
      b !== null &&
      a.processed === b.processed &&
      a.total === b.total &&
      a.age_ms === b.age_ms)
  );
}

/**
 * `progress`: the counts this poll read, `null` when there are none, and
 * `undefined` when the read failed — like a missed poll, that changes
 * nothing, so the pace survives one failed read.
 */
export function useScanTimeLeft(progress: SyncMessageProgress | null | undefined): number | null {
  const [track, setTrack] = useState(() => startScanTrack(progress ?? null));
  const [now, setNow] = useState(() => Date.now());

  // Fold a new observation in while rendering — React re-renders before it
  // commits. An effect would commit the new count beside the previous
  // count's time for a frame (seen live in the 2026-09-26 smoke).
  if (progress !== undefined && !sameObservation(track.seen, progress)) {
    const receivedAt = Date.now();
    setTrack(observeScan(track, progress, receivedAt));
    setNow(receivedAt);
  }

  // Hidden, the tab stops polling while the worker keeps writing: the next
  // batch it sees can span many. Measure the pace again from what it can
  // watch, so a stall after return is judged against that pace.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        setTrack((t) => startScanTrack(t.seen));
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const msLeft = scanMsLeft(track, now);
  const shown = msLeft !== null;
  useEffect(() => {
    if (!shown) {
      return;
    }
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [shown]);

  return msLeft;
}
