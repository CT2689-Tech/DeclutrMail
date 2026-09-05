import {
  createCipheriv,
  createPublicKey,
  constants,
  publicEncrypt,
  randomBytes,
} from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const ORIGIN = 'https://sentry.io';
const AAD = 'declutrmail:sentry-triage:v1';
const identifier = (value) =>
  typeof value === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(value) ? value : undefined;
const count = (value) =>
  value !== null &&
  value !== undefined &&
  value !== '' &&
  Number.isSafeInteger(Number(value)) &&
  Number(value) >= 0
    ? Number(value)
    : null;
const timestamp = (value) =>
  typeof value === 'string' && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : null;
const list = (value) => (Array.isArray(value) ? value : []);
function sourceFile(value) {
  if (typeof value !== 'string') return null;
  const clean = value
    .split(/[?#]/)[0]
    .replace(/^https?:\/\/[^/]+/, '')
    .replace(/^webpack-internal:\/\//, '');
  return /^[A-Za-z0-9_./()[\]@ -]{1,300}$/.test(clean) && /\.(?:[cm]?[jt]sx?)$/.test(clean)
    ? clean
    : null;
}
function title(value) {
  // Error titles can contain user content. Keep the exception class, not its message.
  const type =
    typeof value === 'string'
      ? value.match(/^([A-Za-z][A-Za-z0-9_.]*(?:Error|Exception))(?::|\s|$)/)?.[1]
      : null;
  return type ? `${type}: [message omitted]` : '[Issue title withheld]';
}
export function projectSummary(project) {
  return { id: identifier(String(project?.id ?? '')), slug: identifier(project?.slug) };
}
export function issueSummary(issue) {
  return {
    id: identifier(String(issue?.id ?? '')),
    shortId: identifier(issue?.shortId),
    title: title(issue?.title),
    issueLifetimeCount: count(issue?.count),
    issueLifetimeUserCount: count(issue?.userCount),
    lastSeen: timestamp(issue?.lastSeen),
    project: projectSummary(issue?.project),
  };
}
export function eventSummary(event) {
  const exceptions = list(event?.entries)
    .filter((entry) => entry?.type === 'exception')
    .flatMap((entry) => list(entry?.data?.values))
    .slice(0, 5)
    .map((exception) => ({
      type: identifier(exception?.type) ?? 'UnknownException',
      frames: list(exception?.stacktrace?.frames)
        .filter((frame) => frame?.inApp === true || frame?.in_app === true)
        .slice(-20)
        .map((frame) => ({
          filename: sourceFile(frame.filename),
          function:
            typeof frame.function === 'string' &&
            /^[A-Za-z0-9_.$<>()[\] /-]{1,160}$/.test(frame.function)
              ? frame.function
              : null,
          line: count(frame.lineNo ?? frame.lineno),
          column: count(frame.colNo ?? frame.colno),
        })),
    }));
  const tags = {};
  for (const { key, value } of list(event?.tags)) {
    if ((key === 'environment' || key === 'release') && identifier(value)) tags[key] = value;
    if (
      key === 'worker' &&
      typeof value === 'string' &&
      /^[A-Za-z][A-Za-z0-9]{1,70}Worker$/.test(value)
    )
      tags.worker = value;
    if (key === 'error_code' && identifier(value)) tags.error_code = value;
    if (key === 'status' && /^(?:[1-5][0-9]{2}|failed|succeeded|error|ok)$/.test(value))
      tags.status = value;
    if (key === 'route' && typeof value === 'string' && /^\/(?:api\/)?[a-z/-]{1,100}$/.test(value))
      tags.route = value;
  }
  return {
    eventId: identifier(event?.eventID ?? event?.id),
    release: identifier(event?.release?.version ?? event?.release) ?? tags.release ?? null,
    environment: identifier(event?.environment) ?? tags.environment ?? null,
    timestamp: timestamp(event?.dateCreated ?? event?.datetime ?? event?.timestamp),
    exceptions,
    tags,
  };
}

export function validatePublicKey(pem) {
  if (
    typeof pem !== 'string' ||
    pem.length > 8192 ||
    !pem.trim().startsWith('-----BEGIN PUBLIC KEY-----')
  )
    throw new Error('Public key PEM required');
  const key = createPublicKey(pem);
  if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails.modulusLength < 2048)
    throw new Error('RSA key with at least 2048 bits required');
  return key;
}
export function encryptReport(report, pem) {
  const publicKey = validatePublicKey(pem),
    key = randomBytes(32),
    iv = randomBytes(12);
  try {
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(AAD));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(report), 'utf8'),
      cipher.final(),
    ]);
    const wrappedKey = publicEncrypt(
      { key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
      key,
    );
    return {
      version: 1,
      algorithm: 'AES-256-GCM+RSA-OAEP-SHA256',
      aad: AAD,
      wrappedKey: wrappedKey.toString('base64'),
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
  } finally {
    key.fill(0);
  }
}

export async function collectSentry({ token, org, fetchImpl = fetch }) {
  if (!token || typeof org !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(org))
    throw new Error('Invalid configuration');
  const get = async (path) => {
    const url = new URL(path, ORIGIN);
    if (url.origin !== ORIGIN || !url.pathname.startsWith(`/api/0/organizations/${org}/`))
      throw new Error('Invalid API path');
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      const error = new Error('Sentry HTTP error');
      error.httpStatus = response.status;
      throw error;
    }
    // Bound report extraction even if a server ignores per_page or returns malformed data.
    if (!response.body) throw new Error('Missing API body');
    const chunks = [];
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > 5 * 1024 * 1024) throw new Error('API response size limit exceeded');
      chunks.push(Buffer.from(chunk));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  };
  const projects = await get(`/api/0/organizations/${org}/projects/?per_page=100`);
  const issues = await get(
    `/api/0/organizations/${org}/issues/?query=is%3Aunresolved&statsPeriod=7d&sort=date&per_page=25`,
  );
  if (!Array.isArray(projects) || !Array.isArray(issues)) throw new Error('Invalid API result');
  const report = {
    collectedAt: new Date().toISOString(),
    window: '7d',
    countMeaning:
      'Issue aggregate totals; do not interpret as event or user volume within the 7-day search window.',
    limits: { issues: 25, events: 10, projects: 100 },
    projects: projects.slice(0, 100).map(projectSummary),
    issues: issues.slice(0, 25).map(issueSummary),
  };
  for (const issue of report.issues.slice(0, 10)) {
    if (!issue.id || !/^\d+$/.test(issue.id)) continue;
    try {
      issue.latestEvent = eventSummary(
        await get(`/api/0/organizations/${org}/issues/${issue.id}/events/latest/`),
      );
    } catch (error) {
      issue.latestEventUnavailable = true;
      if (Number.isInteger(error.httpStatus)) issue.latestEventHttpStatus = error.httpStatus;
    }
  }
  return report;
}

export async function main() {
  try {
    // Reject unusable keys BEFORE reading Sentry. No plaintext report is ever written.
    const pem = process.env.SENTRY_TRIAGE_PUBLIC_KEY;
    validatePublicKey(pem);
    const report = await collectSentry({
      token: process.env.SENTRY_AUTH_TOKEN,
      org: process.env.SENTRY_ORG,
    });
    const encrypted = encryptReport(report, pem);
    if (!process.env.SENTRY_TRIAGE_OUTPUT) throw new Error('Missing output path');
    await writeFile(process.env.SENTRY_TRIAGE_OUTPUT, JSON.stringify(encrypted), {
      mode: 0o600,
      flag: 'wx',
    });
    console.log('Encrypted Sentry triage report created. No plaintext issue data logged.');
  } catch (error) {
    console.error(
      Number.isInteger(error.httpStatus)
        ? `Sentry triage failed: HTTP ${error.httpStatus}`
        : 'Sentry triage failed: configuration, network, encryption or output error',
    );
    process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
