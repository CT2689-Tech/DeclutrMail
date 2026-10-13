/**
 * Sandbox-only check of the catalog India prices, then IN vs US transactions.
 *
 * Does not create prices. Host is fixed to https://sandbox-api.paddle.com.
 * A live key is refused before any request. Sandbox UPI is off, so a
 * listed payment-method set must include card and is not required to
 * include UPI. The CLI is scripts/paddle-sandbox-india-checkout.ts.
 */
import { appendFileSync } from 'node:fs';

export const HOST = 'https://sandbox-api.paddle.com';
const KEY_RE = /^pdl_sdbx_apikey_[a-z\d]{26}_[a-zA-Z\d]{22}_[a-zA-Z\d]{3}$/;
const PRICE_RE = /^pri_[a-z\d]{26}$/;
const PRODUCT_RE = /^pro_[a-z\d]{26}$/;
const TXN_RE = /^txn_[a-z\d]{26}$/;
const DISCOUNT_RE = /^dsc_[a-z\d]{26}$/;
const TIMEOUT_MS = 15_000;

const CHECKOUTS = [
  { label: 'IN plus', trustedCountry: 'IN', code: 'plus_annual', currency: 'INR' },
  { label: 'US plus', trustedCountry: 'US', code: 'plus_annual', currency: 'USD' },
  { label: 'IN pass', trustedCountry: 'IN', code: 'pass_onetime', currency: 'INR' },
  { label: 'US pass', trustedCountry: 'US', code: 'pass_onetime', currency: 'USD' },
];

const SPOOFS = [
  { label: 'unsigned', trustedCountry: null, code: 'plus_annual' },
  { label: 'lowercase', trustedCountry: 'in', code: 'plus_annual' },
  { label: 'name', trustedCountry: 'INDIA', code: 'plus_annual' },
  { label: 'other', trustedCountry: 'IN', code: 'other' },
];

export class SandboxCheckoutError extends Error {
  constructor(code, detail = '') {
    super(detail ? `${code} ${detail}` : code);
    this.name = 'SandboxCheckoutError';
    this.code = code;
  }
}

export function assertSandboxCredentials(env) {
  if (env?.PADDLE_ENV !== 'sandbox' || !KEY_RE.test(env.PADDLE_API_KEY ?? '')) {
    throw new SandboxCheckoutError('sandbox_credentials_required');
  }
}

function cycleEqual(actual, expected) {
  if (expected === null) return actual == null;
  return actual?.interval === expected.interval && actual?.frequency === expected.frequency;
}

function indiaOverride(price) {
  const overrides = price?.unit_price_overrides;
  if (!Array.isArray(overrides)) return false;
  return overrides.some(
    (row) => Array.isArray(row?.country_codes) && row.country_codes.includes('IN'),
  );
}

export function priceMismatch(price, spec) {
  if (!PRICE_RE.test(spec.id) || !PRODUCT_RE.test(spec.productId)) return 'catalog_id';
  if (price?.id !== spec.id || price.status !== 'active') return 'status';
  if (price.product_id !== spec.productId) return 'product';
  if (price.unit_price?.amount !== spec.amount) return 'amount';
  if (price.unit_price?.currency_code !== spec.currency) return 'currency';
  if (!cycleEqual(price.billing_cycle, spec.cycle)) return 'cycle';
  if (spec.taxMode && price.tax_mode !== spec.taxMode) return 'tax';
  if (spec.usdOnly && indiaOverride(price)) return 'inr_override';
  return null;
}

async function paddle(fetchImpl, key, path, method = 'GET', body) {
  const url = new URL(path, HOST);
  if (url.origin !== HOST) throw new SandboxCheckoutError('sandbox_host_required');
  let response;
  try {
    response = await fetchImpl(url.href, {
      method,
      redirect: 'error',
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Paddle-Version': '1',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof SandboxCheckoutError) throw error;
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new SandboxCheckoutError('timeout');
    }
    throw new SandboxCheckoutError('transport_error');
  }
  const text = await response.text();
  if (text.length > 2_000_000) throw new SandboxCheckoutError('response_too_large');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SandboxCheckoutError('malformed_response');
  }
  if (!response.ok) {
    const code = parsed?.error?.code;
    const suffix = typeof code === 'string' && /^[a-z0-9_]{1,80}$/.test(code) ? `_${code}` : '';
    const detail = parsed?.error?.detail;
    const safe =
      typeof detail === 'string' && /^[A-Za-z0-9 .,:'()\-]{1,180}$/.test(detail) ? detail : '';
    throw new SandboxCheckoutError(`paddle_${response.status}${suffix}`, safe);
  }
  return parsed;
}

function emit(lines, summaryPath) {
  const text = `${lines.join('\n')}\n`;
  console.log(text.trimEnd());
  if (typeof summaryPath === 'string' && summaryPath.length > 0) {
    appendFileSync(summaryPath, text);
  }
}

function usdPrice(catalog, code) {
  const price = catalog.prices.find((row) => row.code === code && row.currency === 'USD');
  if (!price) throw new SandboxCheckoutError('catalog_required');
  return price;
}

function indiaPrice(catalog, code) {
  const price = catalog.prices.find((row) => row.code === code && row.currency === 'INR');
  if (!price) throw new SandboxCheckoutError('catalog_required');
  return price;
}

function assertSelection(selected, expected) {
  if (selected?.currency !== expected.currency || selected?.priceId !== expected.priceId) {
    throw new SandboxCheckoutError(`selection_${expected.label}`);
  }
}

function paymentMethods(data) {
  const methods = data?.available_payment_methods;
  if (!Array.isArray(methods)) return { listed: false, methods: [] };
  if (methods.some((method) => typeof method !== 'string')) {
    throw new SandboxCheckoutError('malformed_response');
  }
  return { listed: true, methods };
}

async function createTransaction(fetchImpl, key, plan) {
  const discountId = plan.discountId;
  if (discountId && !DISCOUNT_RE.test(discountId)) {
    throw new SandboxCheckoutError('sandbox_discount_id');
  }
  const body = {
    collection_mode: 'automatic',
    currency_code: plan.currency,
    items: [{ price_id: plan.priceId, quantity: 1 }],
    ...(discountId ? { discount_id: discountId } : {}),
  };
  const created = await paddle(fetchImpl, key, '/transactions', 'POST', body);
  const data = created?.data;
  const item = data?.items?.[0];
  const priceId = item?.price?.id ?? item?.price_id;
  if (
    !TXN_RE.test(data?.id ?? '') ||
    data?.currency_code !== plan.currency ||
    priceId !== plan.priceId ||
    item?.quantity !== 1
  ) {
    throw new SandboxCheckoutError(`transaction_mismatch:${plan.label}`);
  }
  const payment = paymentMethods(data);
  if (payment.listed && !payment.methods.includes('card')) {
    throw new SandboxCheckoutError(`payment_method_card_required:${plan.label}`);
  }
  return {
    label: plan.label,
    id: data.id,
    currency: data.currency_code,
    priceId,
    paymentMethods: payment.listed ? payment.methods.join(',') : 'unspecified',
  };
}

/**
 * @param {{
 *   env: NodeJS.ProcessEnv,
 *   catalog: { prices: Array<{ code: string, id: string, productId: string, amount: string, currency: 'USD' | 'INR', cycle: { interval: string, frequency: number } | null, taxMode?: string, usdOnly?: boolean }> },
 *   selectPrice: (input: { usdPriceId: string, code: string, trustedCountry: string | null }) => { priceId: string, currency: string },
 *   discountIdForPrice: (priceId: string) => string | null,
 *   fetchImpl?: typeof fetch,
 * }} options
 */
export async function runIndiaSandboxCheckout(options) {
  const { env, catalog, selectPrice, discountIdForPrice, fetchImpl = globalThis.fetch } = options;
  assertSandboxCredentials(env);
  if (!Array.isArray(catalog?.prices) || catalog.prices.length !== 4) {
    throw new SandboxCheckoutError('catalog_required');
  }
  const key = env.PADDLE_API_KEY;
  const lines = [];
  for (const spec of catalog.prices) {
    const body = await paddle(fetchImpl, key, `/prices/${spec.id}`);
    const reason = priceMismatch(body?.data, spec);
    if (reason)
      throw new SandboxCheckoutError(`price_mismatch:${spec.code}:${spec.currency}:${reason}`);
    lines.push(
      `${spec.code} ${spec.currency} ${spec.id} product=${spec.productId} verified${spec.usdOnly ? ' usd_only' : ''}`,
    );
  }
  emit(lines, env.GITHUB_STEP_SUMMARY);

  const plusUsd = usdPrice(catalog, 'plus_annual');
  for (const spoof of SPOOFS) {
    const usd = spoof.code === 'pass_onetime' ? usdPrice(catalog, spoof.code) : plusUsd;
    const selected = selectPrice({
      usdPriceId: usd.id,
      code: spoof.code,
      trustedCountry: spoof.trustedCountry,
    });
    assertSelection(selected, { label: spoof.label, currency: 'USD', priceId: plusUsd.id });
  }

  const plans = CHECKOUTS.map((checkout) => {
    const usd = usdPrice(catalog, checkout.code);
    const expectedPrice = checkout.currency === 'INR' ? indiaPrice(catalog, checkout.code) : usd;
    const selected = selectPrice({
      usdPriceId: usd.id,
      code: checkout.code,
      trustedCountry: checkout.trustedCountry,
    });
    assertSelection(selected, {
      label: checkout.label,
      currency: checkout.currency,
      priceId: expectedPrice.id,
    });
    return {
      label: checkout.label,
      currency: checkout.currency,
      priceId: selected.priceId,
      discountId: discountIdForPrice(selected.priceId) || null,
    };
  });

  const transactions = [];
  for (const plan of plans) {
    const transaction = await createTransaction(fetchImpl, key, plan);
    transactions.push(transaction);
    emit(
      [
        `checkout ${transaction.label} currency=${transaction.currency} price=${transaction.priceId} txn=${transaction.id} payment_methods=${transaction.paymentMethods}`,
      ],
      env.GITHUB_STEP_SUMMARY,
    );
  }
  return { transactions };
}
