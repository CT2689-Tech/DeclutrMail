/** Pure checks for the Backlog Pass sandbox rehearsal. No provider I/O. */

export const SANDBOX_API_ORIGIN = 'https://sandbox-api.paddle.com';

const CENTS = /^\d+$/;

/** Percentage discounts apply to the pre-tax subtotal, in minor units. */
export function discountMatchesPercent(
  subtotal: string,
  discount: string,
  percent: number,
): boolean {
  if (!CENTS.test(subtotal) || !CENTS.test(discount)) return false;
  const base = Number(subtotal);
  if (base <= 0 || !Number.isInteger(percent) || percent <= 0 || percent > 100) return false;
  return Number(discount) === Math.round((base * percent) / 100);
}

/** A non-recurring discount leaves the next bill at the full subtotal. */
export function renewalIsFullPrice(
  renewalSubtotal: string,
  renewalDiscount: string,
  firstSubtotal: string,
): boolean {
  return (
    CENTS.test(firstSubtotal) &&
    renewalDiscount === '0' &&
    renewalSubtotal === firstSubtotal &&
    Number(firstSubtotal) > 0
  );
}

/** Price ids the discount may name. Product ids are ignored. */
export function discountPriceIds(restrictTo: unknown, allowed: readonly string[]): boolean {
  if (!Array.isArray(restrictTo)) return false;
  const prices = restrictTo.filter(
    (id): id is string => typeof id === 'string' && id.startsWith('pri_'),
  );
  return prices.length === allowed.length && allowed.every((id) => prices.includes(id));
}

export function withinWindow(actual: Date, expectedMs: number, toleranceMs: number): boolean {
  return Math.abs(actual.getTime() - expectedMs) <= toleranceMs;
}
