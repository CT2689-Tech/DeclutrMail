import { fillCopy, WS5_COPY } from '@declutrmail/shared/copy/launch';
import { formatReportSize } from '@declutrmail/shared/inbox-report';

/** Deck cell for one list row. Null hides the cell. */
export function senderSizeCell(bytes: number | null | undefined): string | null {
  if (bytes == null || bytes <= 0) return null;
  return fillCopy(WS5_COPY['f2.cell'], { size: formatReportSize(bytes) });
}

/** Deck sentences for sender detail. Null hides the block. */
export function senderSizeDetail(
  name: string,
  bytes: number | null | undefined,
): { detail: string; note: string; estimates: string } | null {
  if (bytes == null || bytes <= 0) return null;
  return {
    detail: fillCopy(WS5_COPY['f2.detail'], { Sender: name, size: formatReportSize(bytes) }),
    note: WS5_COPY['f2.note'],
    estimates: WS5_COPY['f2.estimates'],
  };
}
