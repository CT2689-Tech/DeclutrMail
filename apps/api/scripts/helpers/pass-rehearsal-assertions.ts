/** Pure checks for the Backlog Pass sandbox rehearsal. No provider I/O. */

export const SANDBOX_API_ORIGIN = 'https://sandbox-api.paddle.com';

const CENTS = /^\d+$/;

/** A null provider expiry is unlimited; missing/invalid or elapsed expiry fails closed. */
export function discountIsUnexpired(expiresAt: unknown, nowMs = Date.now()): boolean {
  if (!Number.isFinite(nowMs)) return false;
  if (expiresAt === null) return true;
  return typeof expiresAt === 'string' && nowMs < Date.parse(expiresAt);
}

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
const PROVIDER_CODE = /^[a-z0-9_]{1,64}$/;

/**
 * Paddle's `error.code` only. Detail, URLs, and tokens stay out of the log.
 * Run 38206813935 returned `transaction_checkout_url_domain_is_not_approved`.
 */
export function paddleProviderCode(body: unknown): string | null {
  const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
  return typeof code === 'string' && PROVIDER_CODE.test(code) ? code : null;
}

/**
 * One-time and annual transactions both use automatic collection.
 * `checkout.url` is omitted. Paddle rejects an unapproved domain there,
 * and each tunnel host is new. The page opens the transaction itself.
 */
export function passTransactionCreateBody(input: {
  priceId: string;
  workspaceId: string;
  customerId: string;
  addressId: string;
  signature: string;
  discountId?: string;
}): Record<string, unknown> {
  return {
    items: [{ price_id: input.priceId, quantity: 1 }],
    customer_id: input.customerId,
    address_id: input.addressId,
    currency_code: 'USD',
    collection_mode: 'automatic',
    custom_data: { workspace_id: input.workspaceId, sig: input.signature },
    ...(input.discountId ? { discount_id: input.discountId } : {}),
  };
}

/** Our page plus the transaction id. This is not Paddle's checkout link. */
export function rehearsalPayUrl(publicUrl: string, transactionId: string): string {
  const url = `${publicUrl}/pay?_ptxn=${transactionId}`;
  if (!rehearsalCheckoutLink(publicUrl, url))
    throw new Error('Checkout page was not the rehearsal host');
  return url;
}

function rehearsalCheckoutLink(publicUrl: string, checkoutUrl: string): boolean {
  if (!REHEARSAL_HOST.test(publicUrl)) return false;
  try {
    const url = new URL(checkoutUrl);
    const txn = url.searchParams.get('_ptxn');
    return url.origin === publicUrl && url.pathname === '/pay' && txn !== null && TXN_ID.test(txn);
  } catch {
    return false;
  }
}

/** Sandbox Paddle.js page. Initialize opens the `_ptxn` on this URL. No `checkout.url`. */
export function renderSandboxPayPage(clientToken: string, transactionId: string): string {
  if (!CLIENT_TOKEN.test(clientToken)) throw new Error('Sandbox client token required');
  if (!TXN_ID.test(transactionId)) throw new Error('Sandbox transaction required');
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
window.__paddleEvents = [];
function remember(event) {
  var name = event && typeof event.name === "string" && /^checkout\\.[a-z.]{1,60}$/.test(event.name) ? event.name : "";
  if (!name || window.__paddleEvents.length >= 20) return;
  var code = event && typeof event.code === "string" && /^[a-z0-9_]{1,64}$/.test(event.code) ? ":" + event.code : "";
  window.__paddleEvents.push(name + code);
}
Paddle.Initialize({
  token: ${JSON.stringify(clientToken)},
  eventCallback: remember,
  checkout: { settings: { displayMode: "overlay", variant: "one-page" } }
});
</script>
</body>
</html>`;
}
