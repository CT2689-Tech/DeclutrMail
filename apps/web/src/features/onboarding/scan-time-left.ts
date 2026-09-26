'use client';

import { useEffect, useState } from 'react';
import type { SyncMessageProgress } from '@declutrmail/shared/contracts';

/**
 * Time left on the sync gate's "12,400 of 40,898 emails" line (D109,
 * reversed 2026-09-26 — see the plan's marker) — from progress this tab
 * WATCHED arrive, never a fixed rate.
 *
 * A point is a change of the counts, stamped when it was seen. Counts
 * already on screen at first render are not a point: the worker may have
 * written them a whole batch ago. So a time needs two changes watched
 * live, and is the average rate between the first and the latest.
 *
 * It is dropped again when batches stop arriving at their usual pace: a
 * stalled scan must not keep promising the old number.
 */

/** No batch for this many usual gaps means the rate no longer holds. */
const STALE_GAPS = 3;
/** …but never sooner than this — one slow batch is not a stall. */
const STALE_FLOOR_MS = 60_000;
/** How often a shown time re-checks that it is still backed. */
const TICK_MS = 10_000;

interface Point {
  at: number;
  processed: number;
}

export interface ScanTrack {
  /** The counts last seen — what the next observation is compared to. */
  seen: SyncMessageProgress | null;
  /** First change watched live since the counts last (re)started. */
  first: Point | null;
  /** Latest change watched live. */
  last: Point | null;
  /** Changes watched after `first` — the rate needs at least one. */
  steps: number;
}

export function startScanTrack(seen: SyncMessageProgress | null): ScanTrack {
  return { seen, first: null, last: null, steps: 0 };
}

/**
 * Fold one observation in. Gone counts (the next attempt is listing),
 * a drop (it resumed from what was saved) or a new total (another scan)
 * start over, with this change as the first point — it was seen live.
 */
export function observeScan(
  track: ScanTrack,
  progress: SyncMessageProgress | null,
  at: number,
): ScanTrack {
  const seen = track.seen;
  if (progress === null) {
    return startScanTrack(null);
  }
  if (seen !== null && progress.processed === seen.processed && progress.total === seen.total) {
    return track;
  }
  const point = { at, processed: progress.processed };
  const restarted =
    seen === null || progress.total !== seen.total || progress.processed < seen.processed;
  if (restarted || track.first === null) {
    return { seen: progress, first: point, last: point, steps: 0 };
  }
  return { seen: progress, first: track.first, last: point, steps: track.steps + 1 };
}

/** Milliseconds left at the watched rate, or `null` when nothing backs a time. */
export function scanMsLeft(track: ScanTrack, now: number): number | null {
  const { seen, first, last, steps } = track;
  if (seen === null || first === null || last === null || steps < 1) {
    return null;
  }
  const elapsed = last.at - first.at;
  const read = last.processed - first.processed;
  const remaining = seen.total - last.processed;
  if (elapsed <= 0 || read <= 0 || remaining <= 0) {
    return null;
  }
  if (now - last.at > Math.max(STALE_FLOOR_MS, (STALE_GAPS * elapsed) / steps)) {
    return null;
  }
  return (remaining * elapsed) / read;
}

export function useScanTimeLeft(progress: SyncMessageProgress | null): number | null {
  const [track, setTrack] = useState(() => startScanTrack(progress));
  const [now, setNow] = useState(() => Date.now());

  const processed = progress?.processed ?? null;
  const total = progress?.total ?? null;
  useEffect(() => {
    const at = Date.now();
    setTrack((t) =>
      observeScan(t, processed === null || total === null ? null : { processed, total }, at),
    );
    setNow(at);
  }, [processed, total]);

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
