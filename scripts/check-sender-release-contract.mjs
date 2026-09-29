#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

/** Fail closed when the authenticated API cannot supply the UI's current counts. */
export function validateSenderContract(body) {
  for (const field of ['inboxCount', 'archivedCount']) {
    if (!Number.isSafeInteger(body?.data?.[field]) || body.data[field] < 0) {
      throw new Error(`Sender contract missing valid ${field}`);
    }
  }
}

export async function checkSenderRelease({ origin, senderId, cookie, fetchImpl = fetch }) {
  const url = new URL(origin);
  if (
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))
  )
    throw new Error('API_ORIGIN must be an HTTPS origin (HTTP allowed only on loopback)');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(senderId ?? '')) {
    throw new Error('SENDER_ID must be a UUID belonging to the authenticated mailbox');
  }
  if (!cookie?.trim() || /[\r\n]/.test(cookie))
    throw new Error('A single-line session cookie is required');
  const started = performance.now();
  const response = await fetchImpl(new URL(`/api/senders/${senderId}`, url), {
    headers: { Cookie: cookie, Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status !== 200) throw new Error(`Sender contract HTTP ${response.status}`);
  validateSenderContract(await response.json());
  return {
    contract: 'sender-current-counts',
    verified: true,
    durationMs: Math.round(performance.now() - started),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (!process.env.SESSION_COOKIE_FILE) throw new Error('SESSION_COOKIE_FILE is required');
    const cookie = (await readFile(process.env.SESSION_COOKIE_FILE, 'utf8')).trim();
    console.log(
      JSON.stringify(
        await checkSenderRelease({
          origin: process.env.API_ORIGIN,
          senderId: process.env.SENDER_ID,
          cookie,
        }),
      ),
    );
  } catch {
    // Neither response bodies nor fetch error messages are safe to print: they can contain URLs/PII.
    console.error(
      'UNVERIFIED: sender release contract failed. Check origin, session, sender ownership and numeric current counts.',
    );
    process.exitCode = 1;
  }
}
