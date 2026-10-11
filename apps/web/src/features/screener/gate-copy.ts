import { WS2_COPY } from '@declutrmail/shared/copy/launch';

/** Free Screener pitch. The count is omitted when the aggregate is unknown. */
export function screenerGateCount(count: number | null): string | null {
  if (count == null || !Number.isFinite(count) || count < 0) return null;
  if (count === 1) return WS2_COPY.locked.screener.count.one;
  return WS2_COPY.locked.screener.count.other.replace('{n}', String(count));
}
