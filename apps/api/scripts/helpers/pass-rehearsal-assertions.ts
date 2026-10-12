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

const REHEARSAL_HOST = /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/;
const CLIENT_TOKEN = /^test_[A-Za-z0-9_]{8,200}$/;
const TXN_ID = /^txn_[a-z\d]{26}$/;

/**
 * One-time and annual transactions both use automatic collection.
 * `checkout.url` must be our page. Paddle's default payment link does not
 * load Paddle.js, so a browser that opens it never reaches a card form.
 */
export function passTransactionCreateBody(input: {
  priceId: string;
  workspaceId: string;
  customerId: string;
  addressId: string;
  checkoutUrl: string;
  signature: string;
  discountId?: string;
}): Record<string, unknown> {
  let origin: string;
  try {
    origin = new URL(input.checkoutUrl).origin;
  } catch {
    origin = '';
  }
  if (!REHEARSAL_HOST.test(origin) || !input.checkoutUrl.endsWith('/pay'))
    throw new Error('Checkout page was not the rehearsal host');
  return {
    items: [{ price_id: input.priceId, quantity: 1 }],
    customer_id: input.customerId,
    address_id: input.addressId,
    currency_code: 'USD',
    collection_mode: 'automatic',
    checkout: { url: input.checkoutUrl },
    custom_data: { workspace_id: input.workspaceId, sig: input.signature },
    ...(input.discountId ? { discount_id: input.discountId } : {}),
  };
}

/** The returned link is our page plus Paddle's `_ptxn`, never the default payment link. */
export function rehearsalCheckoutLink(publicUrl: string, checkoutUrl: string): boolean {
  if (!REHEARSAL_HOST.test(publicUrl)) return false;
  try {
    const url = new URL(checkoutUrl);
    const txn = url.searchParams.get('_ptxn');
    return url.origin === publicUrl && url.pathname === '/pay' && txn !== null && TXN_ID.test(txn);
  } catch {
    return false;
  }
}

/** Sandbox Paddle.js page. Initialize reads `_ptxn` from the location and opens checkout. */
export function renderSandboxPayPage(clientToken: string): string {
  if (!CLIENT_TOKEN.test(clientToken)) throw new Error('Sandbox client token required');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Sandbox checkout</title>
<script src="https://cdn.paddle.com/paddle/v2/paddle.js"></script>
</head>
<body>
<script>
Paddle.Environment.set("sandbox");
Paddle.Initialize({
  token: ${JSON.stringify(clientToken)},
  checkout: { settings: { displayMode: "overlay", variant: "one-page" } }
});
</script>
</body>
</html>`;
}
