import { WS2_COPY } from '@declutrmail/shared/copy/launch';

/**
 * First /senders header after onboarding. Both numbers have to be exact
 * server counts. Either one missing omits the sentence.
 */
export function firstBacklogHeader(
  senderCount: number | null,
  inboxPercent: number | null,
): string | null {
  if (senderCount === null || inboxPercent === null) return null;
  if (!Number.isInteger(senderCount) || senderCount < 1) return null;
  if (!Number.isInteger(inboxPercent) || inboxPercent < 0 || inboxPercent > 100) return null;
  return WS2_COPY.banners.firstBacklog.header
    .replaceAll('{k}', String(senderCount))
    .replaceAll('{pct}', String(inboxPercent));
}
