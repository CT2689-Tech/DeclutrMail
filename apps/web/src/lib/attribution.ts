/**
 * First-touch acquisition attribution.
 *
 * Answers one question the product could not answer before: which
 * channel produced a signup. The existing funnel events
 * (`landing_cta_clicked` → `checkout_started`) already exist; they were
 * simply unsplittable by channel because nothing in the codebase read
 * `utm_*`.
 *
 * Three deliberate constraints:
 *
 *   - **Consent-gated (D147).** Attribution is optional analytics, not
 *     an essential cookie, so it obeys the same single gate as PostHog:
 *     nothing is parsed, stored, or emitted without an explicit "Accept
 *     all". Decline is the default, and a visitor who never chooses is
 *     never attributed.
 *   - **First touch wins.** The first channel that produced the visit is
 *     the one that earned the signup; a later direct return must not
 *     overwrite it. Writes are therefore create-only.
 *   - **Strict slugs, never free text.** Every value is visitor-supplied
 *     via the URL, so each is lowercased and matched against
 *     `SLUG_PATTERN` — anything else is dropped, not truncated. This is
 *     what lets the value reach `waitlist.source`, whose contract states
 *     the column holds an attribution slug and never visitor free text.
 *
 * The store is a first-party cookie (not localStorage) on purpose: the
 * OAuth signup callback is served by the API on a sibling subdomain
 * under `COOKIE_DOMAIN=.declutrmail.com`, so a later change can read
 * first-touch attribution server-side at the moment a workspace is
 * created without shipping it through the browser.
 */

import { hasAnalyticsConsent } from './cookie-consent';

/** 90 days — long enough to cover a slow SEO/content consideration cycle. */
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 90;

const COOKIE_NAME = 'dm_attribution';

/**
 * Lowercase slug: starts alphanumeric, then alphanumerics plus `_`, `.`
 * and `-`, capped at 64. Permits real-world values (`reddit`,
 * `product-hunt`, `news.ycombinator.com`) while excluding the separator
 * (`:`) used to compose surface + channel, whitespace, and anything that
 * could be mistaken for markup or an injection payload.
 */
const SLUG_PATTERN = /^[a-z0-9][a-z0-9_.-]{0,63}$/;

/** The `utm_*` keys captured, minus the `utm_` prefix. */
const UTM_KEYS = ['source', 'medium', 'campaign', 'content', 'term'] as const;

type UtmKey = (typeof UTM_KEYS)[number];

/** A first-touch record. `source` is required; the rest are optional. */
export type Attribution = { source: string } & Partial<Record<Exclude<UtmKey, 'source'>, string>>;

/**
 * Normalize one visitor-supplied value to a slug, or `null` when it does
 * not qualify. Rejects rather than repairs: a value that needed
 * repairing was not a campaign tag we set.
 */
function toSlug(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const slug = raw.trim().toLowerCase();
  return SLUG_PATTERN.test(slug) ? slug : null;
}

/**
 * Derive a source slug from a referrer URL — the fallback when a visit
 * carries no `utm_source` (an organic link from Reddit or HN, say).
 * Same-site referrers yield `null`: an internal navigation is not an
 * acquisition channel.
 */
function sourceFromReferrer(referrer: string, currentHost: string): string | null {
  if (!referrer) return null;
  let host: string;
  try {
    host = new URL(referrer).hostname.toLowerCase();
  } catch {
    return null;
  }
  const bare = host.replace(/^www\./, '');
  if (bare === currentHost.toLowerCase().replace(/^www\./, '')) return null;
  return toSlug(bare);
}

/**
 * Parse a location into a first-touch record. `utm_source` wins; a
 * bare `?ref=` (the convention most directories and newsletters use)
 * is honoured next; the referrer host is the last resort.
 *
 * Returns `null` when the visit carries no channel signal at all — a
 * direct visit is recorded as nothing rather than as `"direct"`, so the
 * absence of a cookie stays unambiguous.
 */
export function parseAttribution(
  search: string,
  referrer: string,
  currentHost: string,
): Attribution | null {
  const params = new URLSearchParams(search);
  const source =
    toSlug(params.get('utm_source')) ??
    toSlug(params.get('ref')) ??
    sourceFromReferrer(referrer, currentHost);
  if (source === null) return null;

  const record: Attribution = { source };
  for (const key of UTM_KEYS) {
    if (key === 'source') continue;
    const value = toSlug(params.get(`utm_${key}`));
    if (value !== null) record[key] = value;
  }
  return record;
}

/** The stored first-touch record, or `null` when there is none. */
export function readAttribution(): Attribution | null {
  if (typeof document === 'undefined') return null;
  const pair = document.cookie.split('; ').find((c) => c.startsWith(`${COOKIE_NAME}=`));
  const raw = pair?.slice(COOKIE_NAME.length + 1);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(raw));
    if (typeof parsed !== 'object' || parsed === null) return null;
    // Re-validate on read: the cookie is client-writable, so a value
    // that never passed `toSlug` must not reach the API or PostHog
    // just because it was persisted.
    const candidate = parsed as Record<string, unknown>;
    const source = toSlug(typeof candidate.source === 'string' ? candidate.source : null);
    if (source === null) return null;
    const record: Attribution = { source };
    for (const key of UTM_KEYS) {
      if (key === 'source') continue;
      const value = toSlug(typeof candidate[key] === 'string' ? (candidate[key] as string) : null);
      if (value !== null) record[key] = value;
    }
    return record;
  } catch {
    return null;
  }
}

/**
 * Capture first-touch attribution for the current page, if any.
 *
 * No-ops without analytics consent, when a record already exists (first
 * touch wins), and when the visit carries no channel signal. Returns
 * the record in force after the call so callers can register it
 * immediately without a second cookie read.
 */
export function captureAttribution(): Attribution | null {
  if (typeof window === 'undefined') return null;
  if (!hasAnalyticsConsent()) return null;

  const existing = readAttribution();
  if (existing !== null) return existing;

  const record = parseAttribution(
    window.location.search,
    document.referrer,
    window.location.hostname,
  );
  if (record === null) return null;

  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(
    JSON.stringify(record),
  )}; Max-Age=${COOKIE_MAX_AGE_SECONDS}; Path=/; SameSite=Lax`;
  return record;
}

/**
 * Compose the `source` value for a marketing form submission: the
 * surface that owns the form, plus the channel that produced the visit
 * when one is known (`pricing` → `pricing:reddit`).
 *
 * Both halves are already slugs, so the result satisfies the waitlist
 * contract's slug pattern by construction.
 */
export function attributionSource(surface: string): string {
  const attribution = readAttribution();
  return attribution === null ? surface : `${surface}:${attribution.source}`;
}
