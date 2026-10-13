/**
 * Sandbox-only India price create-or-reuse, then IN vs US transactions.
 *
 * Host is fixed to https://sandbox-api.paddle.com. A live key does not
 * match the sandbox key shape and is refused before any request.
 * The CLI is scripts/paddle-sandbox-india-checkout.ts, which supplies
 * selectPaddleCheckoutPrice and checkoutDiscountId.
 */
import { appendFileSync } from 'node:fs';

export const HOST = 'https://sandbox-api.paddle.com';
const KEY_RE = /^pdl_sdbx_apikey_[a-z\d]{26}_[a-zA-Z\d]{22}_[a-zA-Z\d]{3}$/;
const PRICE_RE = /^pri_[a-z\d]{26}$/;
const PRODUCT_RE = /^pro_[a-z\d]{26}$/;
const TXN_RE = /^txn_[a-z\d]{26}$/;
const DISCOUNT_RE = /^dsc_[a-z\d]{26}$/;
const TIMEOUT_MS = 15_000;
const MAX_PAGES = 5;

/** Tax-inclusive catalog prices use Paddle tax_mode `internal`. */
const SPECS = [
  {
    code: 'plus_annual',
    usdAmount: '5900',
    amount: '199900',
    cycle: { interval: 'year', frequency: 1 },
    sku: 'plus_annual_india',
    description: 'DeclutrMail Plus (annual, India)',
    envName: 'PADDLE_SANDBOX_INDIA_PLUS_ANNUAL_PRICE_ID',
    catalogKey: 'plusUsdPriceId',
  },
  {
    code: 'pass_onetime',
    usdAmount: '1900',
    amount: '79900',
    cycle: null,
    sku: 'pass_onetime_india',
    description: 'DeclutrMail Pass (India)',
    envName: 'PADDLE_SANDBOX_INDIA_PASS_PRICE_ID',
    catalogKey: 'passUsdPriceId',
  },
];

const CHECKOUTS = [
  { label: 'IN plus', trustedCountry: 'IN', code: 'plus_annual' },
  { label: 'US plus', trustedCountry: 'US', code: 'plus_annual' },
  { label: 'IN pass', trustedCountry: 'IN', code: 'pass_onetime' },
  { label: 'US pass', trustedCountry: 'US', code: 'pass_onetime' },
];

const SPOOFS = [
  { label: 'unsigned', trustedCountry: null, code: 'plus_annual' },
  { label: 'lowercase', trustedCountry: 'in', code: 'plus_annual' },
  { label: 'name', trustedCountry: 'INDIA', code: 'plus_annual' },
  { label: 'other', trustedCountry: 'IN', code: 'other' },
];

export class SandboxCheckoutError extends Error {
  constructor(code) {
    super(code);
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

function exactIndia(price, spec, productId) {
  return (
    price?.status === 'active' &&
    price.product_id === productId &&
    price.unit_price?.amount === spec.amount &&
    price.unit_price?.currency_code === 'INR' &&
    price.tax_mode === 'internal' &&
    cycleEqual(price.billing_cycle, spec.cycle) &&
    PRICE_RE.test(price.id ?? '')
  );
}

export function findIndiaPrice(prices, spec, productId) {
  const sameAmount = prices.filter(
    (price) =>
      price?.status === 'active' &&
      price.product_id === productId &&
      price.unit_price?.amount === spec.amount &&
      price.unit_price?.currency_code === 'INR',
  );
  const exact = sameAmount.filter((price) => exactIndia(price, spec, productId));
  if (exact.length === 0) {
    if (sameAmount.length > 0) {
      const ids = sameAmount.map((price) => price.id).join(',');
      throw new SandboxCheckoutError(`india_price_spec_mismatch:${ids}`);
    }
    return null;
  }
  const tagged = exact.find((price) => price.custom_data?.sku === spec.sku);
  return tagged ?? [...exact].sort((a, b) => (a.id < b.id ? -1 : 1))[0];
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
    throw new SandboxCheckoutError(`paddle_${response.status}${suffix}`);
  }
  return parsed;
}

async function listActivePrices(fetchImpl, key) {
  const items = [];
  let after;
  for (let page = 0; page < MAX_PAGES; page++) {
    const path = after
      ? `/prices?per_page=200&status=active&after=${after}`
      : '/prices?per_page=200&status=active';
    const body = await paddle(fetchImpl, key, path);
    const rows = body?.data;
    const pagination = body?.meta?.pagination;
    if (!Array.isArray(rows) || rows.length > 200 || typeof pagination?.has_more !== 'boolean') {
      throw new SandboxCheckoutError('malformed_response');
    }
    items.push(...rows);
    if (!pagination.has_more) return items;
    let cursor;
    try {
      const next = new URL(pagination.next);
      if (next.origin !== HOST || next.pathname !== '/prices') {
        throw new SandboxCheckoutError('invalid_pagination');
      }
      cursor = next.searchParams.get('after');
    } catch (error) {
      if (error instanceof SandboxCheckoutError) throw error;
      throw new SandboxCheckoutError('invalid_pagination');
    }
    if (!PRICE_RE.test(cursor ?? '') || cursor === after || cursor !== rows.at(-1)?.id) {
      throw new SandboxCheckoutError('invalid_pagination');
    }
    after = cursor;
  }
  throw new SandboxCheckoutError('page_limit');
}

async function readUsdPrice(fetchImpl, key, priceId, spec) {
  if (!PRICE_RE.test(priceId)) throw new SandboxCheckoutError('usd_price_id');
  const body = await paddle(fetchImpl, key, `/prices/${priceId}`);
  const price = body?.data;
  if (
    price?.id !== priceId ||
    price.status !== 'active' ||
    !PRODUCT_RE.test(price.product_id ?? '') ||
    price.unit_price?.amount !== spec.usdAmount ||
    price.unit_price?.currency_code !== 'USD' ||
    !cycleEqual(price.billing_cycle, spec.cycle)
  ) {
    throw new SandboxCheckoutError(`usd_price_mismatch:${spec.code}`);
  }
  return price;
}

function createBody(spec, productId) {
  return {
    description: spec.description,
    product_id: productId,
    unit_price: { amount: spec.amount, currency_code: 'INR' },
    tax_mode: 'internal',
    quantity: { minimum: 1, maximum: 1 },
    custom_data: { sku: spec.sku },
    ...(spec.cycle ? { billing_cycle: { interval: spec.cycle.interval, frequency: 1 } } : {}),
  };
}

async function resolveIndiaPrice(fetchImpl, key, spec, productId, existing) {
  const found = findIndiaPrice(existing, spec, productId);
  if (found) return { id: found.id, action: 'reused' };
  const created = await paddle(fetchImpl, key, '/prices', 'POST', createBody(spec, productId));
  const price = created?.data;
  if (!exactIndia(price, spec, productId)) {
    throw new SandboxCheckoutError(`india_price_create_mismatch:${spec.code}`);
  }
  return { id: price.id, action: 'created' };
}

function emit(lines, summaryPath) {
  const text = `${lines.join('\n')}\n`;
  console.log(text.trimEnd());
  if (typeof summaryPath === 'string' && summaryPath.length > 0) {
    appendFileSync(summaryPath, text);
  }
}

function selectionFor(selectPrice, usdPrices, code, trustedCountry) {
  const spec = SPECS.find((row) => row.code === code) ?? SPECS[0];
  return selectPrice({
    usdPriceId: usdPrices[spec.code].id,
    code,
    trustedCountry,
  });
}

function assertSelection(selected, expected) {
  if (selected?.currency !== expected.currency || selected?.priceId !== expected.priceId) {
    throw new SandboxCheckoutError(`selection_${expected.label}`);
  }
}

async function ensureDiscount(fetchImpl, key, discountId, requiredIds) {
  if (!DISCOUNT_RE.test(discountId)) throw new SandboxCheckoutError('sandbox_discount_id');
  const body = await paddle(fetchImpl, key, `/discounts/${discountId}`);
  const discount = body?.data;
  if (discount?.id !== discountId || discount.status !== 'active') {
    throw new SandboxCheckoutError('discount_inactive');
  }
  if (discount.expires_at != null) {
    const expires = Date.parse(discount.expires_at);
    if (!Number.isFinite(expires)) throw new SandboxCheckoutError('malformed_response');
    if (expires <= Date.now()) throw new SandboxCheckoutError('discount_expired');
  }
  const restrict = discount.restrict_to;
  if (restrict === null) return false;
  if (!Array.isArray(restrict) || restrict.some((id) => typeof id !== 'string')) {
    throw new SandboxCheckoutError('malformed_response');
  }
  if (requiredIds.every((id) => restrict.includes(id))) return false;
  const next = [...new Set([...restrict, ...requiredIds])];
  const updated = await paddle(fetchImpl, key, `/discounts/${discountId}`, 'PATCH', {
    restrict_to: next,
  });
  const got = updated?.data?.restrict_to;
  if (!Array.isArray(got) || requiredIds.some((id) => !got.includes(id))) {
    throw new SandboxCheckoutError('discount_restrict_to_incomplete');
  }
  return true;
}

async function createTransaction(fetchImpl, key, plan) {
  const body = {
    collection_mode: 'automatic',
    currency_code: plan.currency,
    items: [{ price_id: plan.priceId, quantity: 1 }],
    ...(plan.discountId ? { discount_id: plan.discountId } : {}),
  };
  const created = await paddle(fetchImpl, key, '/transactions', 'POST', body);
  const data = created?.data;
  const item = data?.items?.[0];
  const priceId = item?.price?.id;
  if (
    !TXN_RE.test(data?.id ?? '') ||
    data?.currency_code !== plan.currency ||
    priceId !== plan.priceId ||
    item?.quantity !== 1
  ) {
    throw new SandboxCheckoutError(`transaction_mismatch:${plan.label}`);
  }
  return { label: plan.label, id: data.id, currency: data.currency_code, priceId };
}

/**
 * @param {{
 *   env: NodeJS.ProcessEnv,
 *   catalog: { plusUsdPriceId: string, passUsdPriceId: string },
 *   selectPrice: (input: { usdPriceId: string, code: string, trustedCountry: string | null }) => { priceId: string, currency: string },
 *   discountIdForPrice: (priceId: string) => string | null,
 *   fetchImpl?: typeof fetch,
 * }} options
 */
export async function runIndiaSandboxCheckout(options) {
  const { env, catalog, selectPrice, discountIdForPrice, fetchImpl = globalThis.fetch } = options;
  assertSandboxCredentials(env);
  if (!catalog?.plusUsdPriceId || !catalog?.passUsdPriceId) {
    throw new SandboxCheckoutError('catalog_required');
  }
  const key = env.PADDLE_API_KEY;
  const usdPrices = {};
  for (const spec of SPECS) {
    usdPrices[spec.code] = await readUsdPrice(fetchImpl, key, catalog[spec.catalogKey], spec);
  }
  const existing = await listActivePrices(fetchImpl, key);
  const india = {};
  const lines = [];
  for (const spec of SPECS) {
    india[spec.code] = await resolveIndiaPrice(
      fetchImpl,
      key,
      spec,
      usdPrices[spec.code].product_id,
      existing,
    );
    lines.push(`${spec.envName}=${india[spec.code].id} ${india[spec.code].action}`);
  }
  emit(lines, env.GITHUB_STEP_SUMMARY);

  env.PADDLE_ENV = 'sandbox';
  env.PADDLE_SANDBOX_INDIA_PLUS_ANNUAL_PRICE_ID = india.plus_annual.id;
  env.PADDLE_SANDBOX_INDIA_PASS_PRICE_ID = india.pass_onetime.id;

  for (const spoof of SPOOFS) {
    const selected = selectionFor(selectPrice, usdPrices, spoof.code, spoof.trustedCountry);
    assertSelection(selected, {
      label: spoof.label,
      currency: 'USD',
      priceId: usdPrices.plus_annual.id,
    });
  }

  const plans = CHECKOUTS.map((checkout) => {
    const selected = selectionFor(selectPrice, usdPrices, checkout.code, checkout.trustedCountry);
    const expected = {
      label: checkout.label,
      currency: checkout.trustedCountry === 'IN' ? 'INR' : 'USD',
      priceId:
        checkout.trustedCountry === 'IN' ? india[checkout.code].id : usdPrices[checkout.code].id,
    };
    assertSelection(selected, expected);
    const discountId = discountIdForPrice(selected.priceId);
    return { ...expected, discountId: discountId || null };
  });

  const requiredIds = [
    usdPrices.plus_annual.id,
    usdPrices.pass_onetime.id,
    india.plus_annual.id,
    india.pass_onetime.id,
  ];
  let discountUpdated = false;
  for (const discountId of new Set(plans.map((plan) => plan.discountId).filter(Boolean))) {
    discountUpdated =
      (await ensureDiscount(fetchImpl, key, discountId, requiredIds)) || discountUpdated;
  }

  const transactions = [];
  for (const plan of plans) {
    const transaction = await createTransaction(fetchImpl, key, plan);
    transactions.push(transaction);
    emit(
      [
        `checkout ${transaction.label} currency=${transaction.currency} price=${transaction.priceId} txn=${transaction.id}`,
      ],
      env.GITHUB_STEP_SUMMARY,
    );
  }
  return { prices: india, transactions, discountUpdated };
}
