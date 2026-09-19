/**
 * Every external origin the API or a worker names must be one the
 * public privacy policy already discloses.
 *
 * QA-activity-20260918-01: the Brandfetch logo resolver shipped to
 * production sending sender domains to `api.brandfetch.io` while the
 * policy's subprocessor table, the `/security` page and the Gmail-data
 * registry all omitted it. Nothing could notice: the registry's
 * processor union is prose about intent, and no check joined it to the
 * code that actually makes the request.
 *
 * Scope, stated plainly: this matches origin LITERALS. A vendor reached
 * only through its SDK (Anthropic, Resend, Sentry) has no literal here
 * and is not covered — those are pinned by `legal-pages.test.tsx`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '../../../..');
const SCANNED_ROOTS = ['apps/api/src', 'packages/workers/src'];
const PRIVACY_PAGE = 'apps/web/src/app/(marketing)/privacy/page.tsx';

/** Origin → the subprocessor cell that discloses it on `/privacy`. */
const DISCLOSED_AS: Record<string, string> = {
  'api.brandfetch.io': 'Brandfetch',
  'api.paddle.com': 'Paddle',
  'sandbox-api.paddle.com': 'Paddle',
  'api.razorpay.com': 'Razorpay',
  'razorpay.com': 'Razorpay',
  'rzp.io': 'Razorpay',
  // Google is the mailbox provider and the host (Google Cloud row).
  'www.googleapis.com': 'Google Cloud',
  'gmail.googleapis.com': 'Google Cloud',
  'oauth2.googleapis.com': 'Google Cloud',
  'accounts.google.com': 'Google Cloud',
};

/** Not a third party receiving data: our own hosts, docs links, test placeholders. */
const NOT_A_PROCESSOR = new Set([
  'declutrmail.com',
  'app.declutrmail.com',
  'api.declutrmail.com',
  'api.declutrmail.example',
  'declutrmail.invalid',
  'developers.google.com',
  'platform.claude.com',
  'brand.example',
  'app.foo.com',
  'a.com',
  'b.com',
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.ts$/.test(name) && !/\.(spec|test)\.ts$/.test(name) ? [path] : [];
  });
}

function originsInSource(): Map<string, string> {
  const found = new Map<string, string>();
  for (const root of SCANNED_ROOTS) {
    for (const file of sourceFiles(join(REPO_ROOT, root))) {
      for (const match of readFileSync(file, 'utf8').matchAll(
        /https:\/\/([a-zA-Z0-9.-]+\.[a-z]{2,})/g,
      )) {
        found.set(match[1]!.toLowerCase(), file.slice(REPO_ROOT.length + 1));
      }
    }
  }
  return found;
}

describe('external origins are disclosed', () => {
  const origins = originsInSource();
  const privacyPage = readFileSync(join(REPO_ROOT, PRIVACY_PAGE), 'utf8');

  // Blind case first: an unreadable tree or a broken matcher yields an
  // empty map, and every assertion below would then pass having checked
  // nothing.
  it('actually found the origins it is supposed to be checking', () => {
    expect(origins.size).toBeGreaterThanOrEqual(10);
    expect(origins.has('api.brandfetch.io')).toBe(true);
    expect(origins.has('gmail.googleapis.com')).toBe(true);
  });

  it('classifies every origin — an unknown host fails by name', () => {
    const unclassified = [...origins.entries()]
      .filter(([host]) => !(host in DISCLOSED_AS) && !NOT_A_PROCESSOR.has(host))
      .map(([host, file]) => `${host} (${file})`);
    expect(unclassified).toEqual([]);
  });

  it('finds a /privacy subprocessor row for every third-party origin', () => {
    const undisclosed = [...origins.keys()]
      .filter((host) => host in DISCLOSED_AS)
      .filter((host) => !privacyPage.includes(`<td>${DISCLOSED_AS[host]}</td>`))
      .map((host) => `${host} → expected a "${DISCLOSED_AS[host]}" row`);
    expect(undisclosed).toEqual([]);
  });
});
