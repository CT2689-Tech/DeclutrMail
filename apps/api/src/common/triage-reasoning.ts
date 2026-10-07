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
    return 'No mail arrived from this sender in the last 90 days, so marked-read activity is not measurable yet.';
  }
  return input.stored;
}
