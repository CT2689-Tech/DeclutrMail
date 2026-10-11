'use client';

import type { CleanupSummaryDto } from '@declutrmail/shared/contracts';
import { MeterPreviewLine } from '@/features/billing/meter-preview-line';
import { HOME_DECK, meterPreviewSentence } from '@/features/home/home-deck-copy';

import styles from './quota-chip-slot.module.css';

/**
 * Deck sentence for a preview. Null until the workspace is on the
 * emails-cleared meter, and null for a zero email count.
 */
export function meterPreviewCopy(
  requested: number | null,
  summary: CleanupSummaryDto | null | undefined,
  freeUnsubscribe = false,
): string | null {
  if (!summary?.metered) return null;
  if (freeUnsubscribe) return HOME_DECK.previewFree;
  if (requested == null) return null;
  return meterPreviewSentence(requested, summary.remaining);
}

/** The sender-unit sentence stays only while the email meter is absent. */
export function hideLegacyQuotaLine(
  line: string | null,
  summary: CleanupSummaryDto | null | undefined,
): string | null {
  if (summary?.metered) return null;
  return line;
}

/**
 * Mounts WS1's preview line. The stub renders null, so the deck sentence
 * shows the email count from the same server summary. Once the line sets
 * `data-testid="meter-preview-line"`, the sentence hides.
 *
 * Unsubscribe with no mail move uses the free sentence. A zero email
 * count never becomes "clears 0".
 */
export function MeterPreviewSlot({
  requested,
  summary,
  freeUnsubscribe = false,
}: {
  requested: number | null;
  summary?: CleanupSummaryDto | null;
  freeUnsubscribe?: boolean;
}) {
  const sentence = meterPreviewCopy(requested, summary, freeUnsubscribe);
  const showLine =
    !freeUnsubscribe && summary?.metered === true && requested != null && requested > 0;
  if (sentence === null && !showLine) return null;
  return (
    <span className={styles.slot} data-meter-slot="">
      {showLine && requested != null ? (
        <MeterPreviewLine requested={requested} summary={summary} />
      ) : null}
      {sentence !== null && <span className={styles.fallback}>{sentence}</span>}
    </span>
  );
}
