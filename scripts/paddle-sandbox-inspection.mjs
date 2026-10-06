/** Manual catalog/destination inspection. No payment, configuration or live API requests. */
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const HOST = 'https://sandbox-api.paddle.com';
const MAX_PAGES = 5;
const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const PRICE_SKUS = [
  'plus_monthly',
  'plus_annual',
  'pro_monthly',
  'pro_annual',
  'pro_annual_founding',
];
// Only events consumed by the existing adapter are exposed; other names become a count.
const EVENTS = [
  'subscription.created',
  'subscription.activated',
  'subscription.updated',
  'subscription.canceled',
  'subscription.paused',
  'subscription.resumed',
  'subscription.past_due',
  'transaction.completed',
  'transaction.payment_failed',
  'adjustment.created',
  'adjustment.updated',
];
const SPECS = {
  products: { path: '/products', prefix: 'pro', active: true },
  prices: { path: '/prices', prefix: 'pri', active: true },
  destinations: { path: '/notification-settings', prefix: 'ntfset', active: false },
};

class InspectionError extends Error {
  constructor(code, httpStatus) {
    super(code);
    this.code = code;
    this.httpStatus = httpStatus;
  }
}
function requireField(condition) {
  if (!condition) throw new InspectionError('malformed_response');
}
function validId(value, prefix) {
  return typeof value === 'string' && new RegExp(`^${prefix}_[a-z\\d]{26}$`).test(value);
}
function project(row, section) {
  const spec = SPECS[section];
  requireField(row && validId(row.id, spec.prefix));
  if (section !== 'destinations') {
    requireField(row.status === 'active');
    const skus = section === 'products' ? ['plus', 'pro'] : PRICE_SKUS;
    const sku = skus.includes(row.custom_data?.sku) ? row.custom_data.sku : null;
    const result = { id: row.id, status: row.status, sku };
    if (section === 'products') return result;
    requireField(validId(row.product_id, 'pro'));
    requireField(
      typeof row.unit_price?.amount === 'string' && /^\d{1,15}$/.test(row.unit_price.amount),
    );
    requireField(
      typeof row.unit_price?.currency_code === 'string' &&
        /^[A-Z]{3}$/.test(row.unit_price.currency_code),
    );
    const cycle = row.billing_cycle;
    requireField(
      cycle === null ||
        (cycle &&
          ['day', 'week', 'month', 'year'].includes(cycle.interval) &&
          Number.isSafeInteger(cycle.frequency) &&
          cycle.frequency > 0),
    );
    return {
      ...result,
      productId: row.product_id,
      amount: row.unit_price.amount,
      currency: row.unit_price.currency_code,
      billingCycle:
        cycle === null ? null : { interval: cycle.interval, frequency: cycle.frequency },
    };
  }
  requireField(
    typeof row.active === 'boolean' && Number.isSafeInteger(row.api_version) && row.api_version > 0,
  );
  requireField(['platform', 'simulation', 'all'].includes(row.traffic_source));
  requireField(
    ['url', 'email'].includes(row.type) &&
      typeof row.destination === 'string' &&
      row.destination.length <= 2048,
  );
  requireField(
    Array.isArray(row.subscribed_events) &&
      row.subscribed_events.length <= 200 &&
      row.subscribed_events.every((e) => e && typeof e.name === 'string'),
  );
  let category = 'email';
  let callbackPathMatches = null;
  let hasQuery = null;
  let hasCredentials = null;
  if (row.type === 'url') {
    let url;
    try {
      url = new URL(row.destination);
    } catch {
      throw new InspectionError('malformed_response');
    }
    requireField(['https:', 'http:'].includes(url.protocol));
    hasCredentials = Boolean(url.username || url.password);
    category =
      url.origin === 'https://api.declutrmail.com' && !hasCredentials
        ? 'production_api'
        : 'other_url';
    callbackPathMatches = url.pathname === '/api/webhooks/billing/paddle';
    hasQuery = Boolean(url.search || url.hash);
  }
  const names = row.subscribed_events.map((e) => e.name);
  return {
    id: row.id,
    active: row.active,
    apiVersion: row.api_version,
    trafficSource: row.traffic_source,
    category,
    callbackPathMatches,
    hasQuery,
    hasCredentials,
    adapterEvents: EVENTS.filter((name) => names.includes(name)),
    otherEventCount: names.filter((name) => !EVENTS.includes(name)).length,
  };
}

async function readPage(url, key, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'error',
      headers: {
        Authorization: `Bearer ${key}`,
        'Paddle-Version': '1',
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new InspectionError('http_error', response.status);
    const reader = response.body?.getReader();
    requireField(reader);
    let bytes = 0;
    const chunks = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_BYTES) throw new InspectionError('response_too_large');
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new InspectionError('malformed_response');
    }
  } catch (error) {
    if (error instanceof InspectionError) throw error;
    throw new InspectionError(controller.signal.aborted ? 'timeout' : 'transport_error');
  } finally {
    clearTimeout(timer);
  }
}

async function collectSection(section, key, fetchImpl) {
  const spec = SPECS[section];
  const items = [];
  const seen = new Set();
  let pages = 0;
  let after;
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = new URL(spec.path, HOST);
      url.searchParams.set('per_page', '200');
      if (spec.active) url.searchParams.set('status', 'active');
      if (after) url.searchParams.set('after', after);
      const body = await readPage(url.href, key, fetchImpl);
      const pagination = body?.meta?.pagination;
      requireField(
        Array.isArray(body?.data) &&
          body.data.length <= 200 &&
          typeof pagination?.has_more === 'boolean',
      );
      // Validate the whole page before retaining any of it.
      const rows = body.data.map((row) => project(row, section));
      const pageIds = new Set(rows.map((row) => row.id));
      requireField(pageIds.size === rows.length && rows.every((row) => !seen.has(row.id)));
      rows.forEach((row) => {
        seen.add(row.id);
        items.push(row);
      });
      pages++;
      if (!pagination.has_more) return { status: 'complete', pages, items };
      requireField(rows.length > 0);
      let next;
      try {
        next = new URL(pagination.next);
      } catch {
        throw new InspectionError('invalid_pagination');
      }
      const cursor = next.searchParams.get('after');
      if (
        next.origin !== HOST ||
        next.pathname !== spec.path ||
        next.username ||
        next.password ||
        next.hash ||
        !validId(cursor, spec.prefix) ||
        cursor !== rows.at(-1).id ||
        cursor === after
      ) {
        throw new InspectionError('invalid_pagination');
      }
      // Never follow the supplied URL or carry its other query parameters forward.
      after = cursor;
    }
    throw new InspectionError('page_limit');
  } catch (error) {
    return {
      status: pages ? 'partial' : 'unavailable',
      pages,
      items,
      error: error instanceof InspectionError ? error.code : 'malformed_response',
      ...(error instanceof InspectionError && error.httpStatus
        ? { httpStatus: error.httpStatus }
        : {}),
    };
  }
}

export async function inspectSandbox({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const report = {
    version: 1,
    environment: 'sandbox',
    observedAt: new Date().toISOString(),
    scope: 'active catalog and all notification destinations; configuration only',
    sections: {},
  };
  // Sandbox environment secrets can fall back to repository secrets: reject live/legacy keys locally.
  if (
    env.PADDLE_ENV !== 'sandbox' ||
    !/^pdl_sdbx_apikey_[a-z\d]{26}_[a-zA-Z\d]{22}_[a-zA-Z\d]{3}$/.test(env.PADDLE_API_KEY ?? '')
  ) {
    report.error = 'sandbox_credentials_required';
    report.complete = false;
    return report;
  }
  for (const section of Object.keys(SPECS)) {
    report.sections[section] = await collectSection(section, env.PADDLE_API_KEY, fetchImpl);
  }
  report.complete = Object.values(report.sections).every(
    (section) => section.status === 'complete',
  );
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) {
    console.error('Report output path required');
    process.exitCode = 1;
  } else {
    const report = await inspectSandbox();
    writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    console.log(
      JSON.stringify({
        complete: report.complete,
        error: report.error,
        sections: Object.fromEntries(
          Object.entries(report.sections).map(([name, section]) => [
            name,
            {
              status: section.status,
              pages: section.pages,
              count: section.items.length,
              error: section.error,
              httpStatus: section.httpStatus,
            },
          ]),
        ),
      }),
    );
    if (!report.complete) process.exitCode = 1;
  }
}
