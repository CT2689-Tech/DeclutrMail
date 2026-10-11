'use client';

import type { CleanupSummaryDto } from '@declutrmail/shared/contracts';
import { QuotaChip } from '@/features/billing/quota-chip';
import { meterChipSentence } from '@/features/home/home-deck-copy';

import styles from './quota-chip-slot.module.css';

/**
 * Mounts WS1's chip. The stub renders null, so the deck sentence shows
 * the same server fields. Once the chip sets `data-testid="quota-chip"`,
 * the sentence hides and the two never double.
 */
export function QuotaChipSlot({
  summary,
  timeZone,
  compact = false,
}: {
  summary: CleanupSummaryDto | null | undefined;
  timeZone: string;
  compact?: boolean;
}) {
  if (!summary) return null;
  const sentence = meterChipSentence(summary, { compact, timeZone });
  return (
    <span className={styles.slot} data-quota-slot="">
      <QuotaChip summary={summary} {...(compact ? { compact: true } : {})} />
      {sentence !== null && (
        <span className={styles.fallback} aria-label={sentence.aria}>
          <span aria-hidden="true">{sentence.text}</span>
        </span>
      )}
    </span>
  );
}
