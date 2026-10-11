/**
 * Legal entity for the footer and /contact.
 *
 * Founder decision 2026-10-11, 12:26 PM PT: ship without a legal company
 * name or business address. Set both constants to the founder's text
 * later — one assignment each. While either is blank, the footer,
 * /contact, and the other legal pages omit the line. No flag and no
 * env var. Do not invent the text.
 *
 * The postal address block is separate (`BUSINESS_POSTAL_ADDRESS`).
 * It stays omitted until that array is filled.
 */

export const LEGAL_ENTITY_NAME = '';
export const LEGAL_ENTITY_ADDRESS = '';

/** True only when both lines are non-blank. Callers render nothing otherwise. */
export function hasLegalEntity(): boolean {
  return LEGAL_ENTITY_NAME.trim() !== '' && LEGAL_ENTITY_ADDRESS.trim() !== '';
}
