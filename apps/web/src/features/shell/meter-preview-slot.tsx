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
 * Mounts WS1's preview line for a counted cleanup. Unsubscribe with no
 * mail move uses the free deck sentence, because that line does not.
 * A zero email count never becomes "clears 0".
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
  const showLine =
    !freeUnsubscribe && summary?.metered === true && requested != null && requested > 0;
  if (showLine && requested != null && summary != null) {
    return <MeterPreviewLine requested={requested} summary={summary} />;
  }
  const sentence = meterPreviewCopy(requested, summary, freeUnsubscribe);
  if (sentence === null) return null;
  return <span className={styles.fallback}>{sentence}</span>;
}
