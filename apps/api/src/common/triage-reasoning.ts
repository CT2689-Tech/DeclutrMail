import { PLAIN_STALE_CLAIM } from '@declutrmail/shared/ai-consent';

/**
 * A stored LLM sentence can outlive the signal snapshot that produced it.
 * Detect a numeric engagement claim so a caller with no current denominator
 * can replace it instead of turning an unknown rate into a measured one.
 */
export function claimsMeasuredEngagement(reasoning: string): boolean {
  return (
    /\b\d{1,3}(?:\.\d+)?\s*%[^.!?]{0,32}\b(?:marked[ -]?read|read(?:ing)?(?:\s+rate)?|open(?:ed|ing)?(?:\s+rate)?)\b/i.test(
      reasoning,
    ) ||
    /\b(?:marked[ -]?read|read(?:ing)?(?:\s+rate)?|open(?:ed|ing)?(?:\s+rate)?)\b[^.!?]{0,32}\b\d{1,3}(?:\.\d+)?\s*%/i.test(
      reasoning,
    )
  );
}

export function currentTriageReasoning(input: {
  stored: string;
  generatedBy: 'llm_haiku' | 'template';
  readRate: number | null;
}): string {
  if (
    input.generatedBy === 'llm_haiku' &&
    input.readRate === null &&
    claimsMeasuredEngagement(input.stored)
  ) {
    return PLAIN_STALE_CLAIM;
  }
  return input.stored;
}

/** Stored AI prose is shown only with current consent. Otherwise the plain line. */
export function projectReasoning(input: {
  stored: string;
  generatedBy: 'llm_haiku' | 'template';
  readRate: number | null;
  showStoredAi: boolean;
  plain: string;
}): { reasoning: string; generatedBy: 'llm_haiku' | 'template' } {
  if (!input.showStoredAi && input.generatedBy === 'llm_haiku') {
    return { reasoning: input.plain, generatedBy: 'template' };
  }
  return {
    reasoning: currentTriageReasoning({
      stored: input.stored,
      generatedBy: input.generatedBy,
      readRate: input.readRate,
    }),
    generatedBy: input.generatedBy,
  };
}
