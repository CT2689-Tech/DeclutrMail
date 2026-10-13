import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Live India prices Ops created. Not secrets. Absent at runtime stays on USD. */
export const LIVE_INDIA_BILLING_ENV = {
  PADDLE_LIVE_INDIA_PLUS_ANNUAL_PRICE_ID: 'pri_01m4ss0bccahnyghv26rgs36xk',
  PADDLE_LIVE_INDIA_PASS_PRICE_ID: 'pri_01m4ss18n1c9r5s9p973tef9v2',
};

export const VERCEL_PROJECT_ID = 'prj_hWYbyer4xJEWfCiSb9M3krrdh5D7';
const GEO_SECRET_ENV = 'BILLING_GEO_HMAC_SECRET';
const UNSAFE_API_ENV = /[,\s=$`"\\'();&|]/;

/**
 * Append the live India price ids, then the geo secret when it can sit in
 * the comma-delimited Cloud Run env list. Empty secret is omitted.
 */
export function apiEnvWithLiveIndia(base, geoSecret = '') {
  if (!base || base.endsWith(',')) throw new Error('API env base is incomplete');
  const prices = Object.entries(LIVE_INDIA_BILLING_ENV)
    .map(([key, value]) => `${key}=${value}`)
    .join(',');
  const env = `${base},${prices}`;
  if (typeof geoSecret !== 'string' || geoSecret.trim() === '') {
    return { env, geoBound: false };
  }
  if (UNSAFE_API_ENV.test(geoSecret)) {
    throw new Error('BILLING_GEO_HMAC_SECRET cannot be placed in the comma-delimited API env list');
  }
  return { env: `${env},${GEO_SECRET_ENV}=${geoSecret}`, geoBound: true };
}

/**
 * Production web env. Price ids are plain. The geo secret is sensitive and
 * skipped when unset, which leaves checkout on USD.
 */
export async function upsertVercelProductionBillingEnv({
  token,
  teamId,
  geoSecret = '',
  fetcher = fetch,
}) {
  if (!token || !/^team_[A-Za-z0-9]+$/.test(teamId ?? '')) {
    throw new Error('Vercel credentials are unavailable');
  }
  const variables = [
    {
      key: 'PADDLE_LIVE_INDIA_PLUS_ANNUAL_PRICE_ID',
      value: LIVE_INDIA_BILLING_ENV.PADDLE_LIVE_INDIA_PLUS_ANNUAL_PRICE_ID,
      type: 'plain',
      target: ['production'],
      comment: 'Live India Plus annual price id. Not a secret.',
    },
    {
      key: 'PADDLE_LIVE_INDIA_PASS_PRICE_ID',
      value: LIVE_INDIA_BILLING_ENV.PADDLE_LIVE_INDIA_PASS_PRICE_ID,
      type: 'plain',
      target: ['production'],
      comment: 'Live India Pass price id. Not a secret.',
    },
  ];
  if (typeof geoSecret === 'string' && geoSecret.trim() !== '') {
    variables.push({
      key: GEO_SECRET_ENV,
      value: geoSecret,
      type: 'sensitive',
      target: ['production'],
      visibility: 'secret',
      comment: 'Checkout country token. Same value as the API.',
    });
  }
  const response = await fetcher(
    `https://api.vercel.com/v10/projects/${VERCEL_PROJECT_ID}/env?upsert=true&teamId=${encodeURIComponent(teamId)}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(variables),
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) throw new Error(`Vercel billing env upsert failed (${response.status})`);
  const body = await response.json();
  const failed = Array.isArray(body?.failed) ? body.failed : [];
  if (failed.length > 0) {
    const keys = failed.map((row) => row?.key ?? 'unknown').join(', ');
    throw new Error(`Vercel billing env upsert failed for ${keys}`);
  }
  const rows = [
    ...(Array.isArray(body?.created) ? body.created : []),
    ...(Array.isArray(body?.updated) ? body.updated : []),
    ...(Array.isArray(body) ? body : []),
  ];
  const keys = new Set(rows.map((row) => row?.key).filter(Boolean));
  for (const variable of variables) {
    if (!keys.has(variable.key)) {
      throw new Error(`Vercel billing env upsert omitted ${variable.key}`);
    }
  }
  return {
    keys: [...keys],
    geoBound: variables.some((variable) => variable.key === GEO_SECRET_ENV),
  };
}

function printId(name) {
  const value = LIVE_INDIA_BILLING_ENV[name];
  if (!value) throw new Error('Unknown live India billing env name');
  process.stdout.write(value);
}

async function main() {
  const command = process.argv[2];
  if (command === '--api-env') {
    const result = apiEnvWithLiveIndia(
      process.env.API_ENV_BASE ?? '',
      process.env.BILLING_GEO_HMAC_SECRET ?? '',
    );
    process.stdout.write(result.env);
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT, `geo_hmac_bound=${result.geoBound}\n`);
    }
    if (!result.geoBound) {
      process.stderr.write('BILLING_GEO_HMAC_SECRET is unset; checkout stays on USD.\n');
    }
    return;
  }
  if (command === '--print-id') {
    printId(process.argv[3]);
    return;
  }
  if (command === '--vercel') {
    const result = await upsertVercelProductionBillingEnv({
      token: process.env.VERCEL_TOKEN,
      teamId: process.env.VERCEL_TEAM_ID,
      geoSecret: process.env.BILLING_GEO_HMAC_SECRET ?? '',
    });
    process.stdout.write(
      `Vercel production billing env upserted (${result.keys.length} keys, geo ${result.geoBound ? 'bound' : 'unset'}).\n`,
    );
    return;
  }
  throw new Error('Expected --api-env, --print-id, or --vercel');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'Live India billing env failed'}\n`,
    );
    process.exitCode = 1;
  });
}
