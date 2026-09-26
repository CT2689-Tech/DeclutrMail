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
 * average rate since the track started, counted down between batches.
 *
 * The track starts over when the counts go away, drop or change total,
 * and when a batch lands after a stall — a pause (or a hidden tab) is not
 * averaged into the pace that follows it. The time is dropped when
 * batches stop arriving at their usual pace, and when it runs out.
 */

/** No batch for this many usual gaps means the rate no longer holds. */
const STALE_GAPS = 3;
/** …but never sooner than this — one slow batch is not a stall. */
const STALE_FLOOR_MS = 60_000;
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
  /** Batches after `first` — the rate needs at least one. */
  steps: number;
}

export function startScanTrack(seen: SyncMessageProgress | null): ScanTrack {
  return { seen, first: null, last: null, steps: 0 };
}

function staleAfter(track: ScanTrack): number {
  const { first, last, steps } = track;
  const usualGap = first && last && steps > 0 ? (last.at - first.at) / steps : 0;
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
  const { seen, last } = track;
  // The same batch again: already placed, and its first placement stands.
  if (last && seen && seen.total === progress.total && last.processed === progress.processed) {
    return { ...track, seen: progress };
  }
  const point = { at: receivedAt - progress.age_ms, processed: progress.processed };
  const restarted =
    last === null ||
    seen === null ||
    progress.total !== seen.total ||
    progress.processed < last.processed ||
    point.at - last.at > staleAfter(track);
  if (restarted) {
    return { seen: progress, first: point, last: point, steps: 0 };
  }
  return { seen: progress, first: track.first, last: point, steps: track.steps + 1 };
}

/** Milliseconds left as of `now`, or `null` when nothing backs a time. */
export function scanMsLeft(track: ScanTrack, now: number): number | null {
  const { seen, first, last, steps } = track;
  if (seen === null || first === null || last === null || steps < 1) {
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

export function useScanTimeLeft(progress: SyncMessageProgress | null): number | null {
  const [track, setTrack] = useState(() => startScanTrack(progress));
  const [now, setNow] = useState(() => Date.now());

  // Fold a new observation in while rendering — React re-renders before it
  // commits. An effect would commit the new count beside the previous
  // count's time for a frame (seen live in the 2026-09-26 smoke).
  if (!sameObservation(track.seen, progress)) {
    const receivedAt = Date.now();
    setTrack(observeScan(track, progress, receivedAt));
    setNow(receivedAt);
  }

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
