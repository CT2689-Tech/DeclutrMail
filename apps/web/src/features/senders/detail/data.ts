/**
 * Sender Detail — pure formatting helpers shared by the detail
 * components (stats strip, recent messages, decision history).
 *
 * The synthetic fixture builder (`buildSenderDetail` + its heuristics)
 * moved to `src/mocks/sender-detail-builder.ts` (2026-07-16 wire
 * unification) — this module is prod-consumed only.
 */

/**
 * Compact size label — 1024 → "1KB", 8742 → "9KB", 2_500_000 → "2.4MB".
 *
 * `null` (pre-ADR-0021 row or Gmail-omitted `sizeEstimate`) renders an
 * em-dash so the absence reads honestly instead of as "0B". `0`
 * collapses to the same em-dash for the same reason — a real
 * zero-byte message would be Gmail's mistake, not ours, and the
 * em-dash still says "no useful size" without lying about the value.
 */
export function fmtSize(bytes: number | null | undefined): string {
  if (bytes == null || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/** Relative-time formatter — same shape as the parent module's. */
export function relTime(days: number): string {
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.round(days / 7)}w ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}

/** Relative time for an ISO-8601 string. */
export function relTimeFromIso(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  const days = Math.max(0, Math.floor((now.getTime() - then) / (1000 * 60 * 60 * 24)));
  return relTime(days);
}

/**
 * Exact received-at for a message row's tooltip.
 *
 * "5mo ago" is fine for scanning and useless for checking. When someone
 * is verifying a claim against Gmail — which is exactly what a privacy
 * product asks them to be able to do — a relative label gives them
 * nothing to match on (founder, 2026-08-18: "this would fill the trust
 * gap if user is trying to verify something. I was doing exactly same").
 * The instant is already on the wire as `RecentMessage.receivedAt`; it
 * was simply never rendered.
 *
 * Locale is pinned per the D200 hydration rule (`eslint.config.mjs`
 * `no-restricted-syntax` bans an unpinned `toLocaleString`). The zone
 * stays the browser's — callers gate this behind `useNow()` so it is
 * computed after mount and never reaches server HTML; tests pass an
 * explicit zone for exact-string determinism. Same contract as
 * `absoluteTime` in the Activity feed, which is the pattern this copies.
 */
export function absoluteFromIso(iso: string, timeZone?: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone });
}
