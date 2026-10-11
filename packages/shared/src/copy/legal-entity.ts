/** Legal entity for Terms, footer, and contact. WS3 owns this file after the stub. */

export const LEGAL_ENTITY_NAME = 'FILL_ME'; // DECISION: Chintan
export const LEGAL_ENTITY_ADDRESS = 'FILL_ME'; // DECISION: Chintan

/** False while either constant is still the unset placeholder. Render nothing in that case. */
export function hasLegalEntity(): boolean {
  return LEGAL_ENTITY_NAME !== 'FILL_ME' && LEGAL_ENTITY_ADDRESS !== 'FILL_ME';
}
