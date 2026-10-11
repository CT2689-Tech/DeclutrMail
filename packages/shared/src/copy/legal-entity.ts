/**
 * Legal entity for the footer and /contact. FOUNDER INPUT.
 *
 * Neither a legal name nor a street address is stated in
 * apps/web/src/app/(marketing)/privacy/page.tsx,
 * apps/web/src/app/(marketing)/terms/page.tsx (India/Mumbai governing
 * law only), apps/web/src/app/(marketing)/contact/page.tsx, or
 * packages/shared/src/copy/postal-address.ts (`BUSINESS_POSTAL_ADDRESS`
 * is empty). Leave both as `FILL_ME`. The shared test
 * `fails until the founder sets the legal name and address` stays red
 * until both are replaced with the founder's text. Do not invent them.
 */

export const LEGAL_ENTITY_NAME = 'FILL_ME'; // FOUNDER INPUT
export const LEGAL_ENTITY_ADDRESS = 'FILL_ME'; // FOUNDER INPUT

/** False while either constant is still the unset placeholder. Render nothing in that case. */
export function hasLegalEntity(): boolean {
  return LEGAL_ENTITY_NAME !== 'FILL_ME' && LEGAL_ENTITY_ADDRESS !== 'FILL_ME';
}
