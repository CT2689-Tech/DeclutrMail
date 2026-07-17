/**
 * Brand rollup (D51 — eTLD+1 grouping). Pure utilities: no React, no IO.
 *
 * Groups senders that share a REGISTRABLE domain (`mail.google.com` and
 * `news.google.com` both roll up under `google.com`) so a brand that
 * mails from many subdomains/addresses reads as ONE row in the list.
 *
 * eTLD+1 derivation is PRAGMATIC, not exhaustive: a full Public Suffix
 * List is a dependency + ~200KB we don't want for a grouping heuristic.
 * Instead a short allowlist of common multi-part public suffixes
 * (co.uk, com.au, co.in, …) covers the mailboxes we actually see.
 *
 * KNOWN LIMITATION: domains under a multi-part public suffix NOT in the
 * list (e.g. `example.pvt.k12.ma.us`, niche ccTLD second-levels) fall
 * back to the last two labels and may group at the suffix instead of
 * the brand. Worst case = an over-eager group row; per-sender actions
 * are unaffected (grouping is presentation-only). Extend
 * `MULTI_PART_SUFFIXES` when a real mailbox surfaces a miss.
 */

import type { Sender } from './data';

/**
 * Common multi-part public suffixes. Checked as the LAST TWO labels of
 * the domain — when matched, the registrable domain keeps three labels.
 */
const MULTI_PART_SUFFIXES: ReadonlySet<string> = new Set([
  // UK
  'co.uk',
  'org.uk',
  'gov.uk',
  'ac.uk',
  'net.uk',
  // Australia
  'com.au',
  'net.au',
  'org.au',
  'gov.au',
  'edu.au',
  // India
  'co.in',
  'net.in',
  'org.in',
  'gov.in',
  'ac.in',
  // New Zealand / Japan
  'co.nz',
  'org.nz',
  'net.nz',
  'co.jp',
  'or.jp',
  'ne.jp',
  'ac.jp',
  // Brazil / Mexico / Argentina
  'com.br',
  'org.br',
  'com.mx',
  'com.ar',
  // Asia
  'com.sg',
  'com.hk',
  'com.my',
  'co.th',
  'com.tw',
  'com.cn',
  'co.kr',
  // Africa / Middle East / Europe ccSLDs
  'co.za',
  'org.za',
  'com.tr',
  'com.eg',
  'co.il',
]);

/**
 * Derive the registrable domain (eTLD+1) for a sender domain.
 *
 * - `mail.google.com`   → `google.com`
 * - `news.bbc.co.uk`    → `bbc.co.uk`
 * - `github.com`        → `github.com`
 * - single-label / empty inputs are returned as-is (lowercased) — there
 *   is nothing to strip and nothing sensible to group them under.
 */
export function registrableDomain(domain: string): string {
  const clean = domain.trim().toLowerCase().replace(/\.+$/, '');
  const labels = clean.split('.').filter((l) => l.length > 0);
  if (labels.length <= 2) return labels.join('.');
  const lastTwo = labels.slice(-2).join('.');
  const keep = MULTI_PART_SUFFIXES.has(lastTwo) ? 3 : 2;
  return labels.slice(-keep).join('.');
}

/** One entry in the rolled-up list — a plain sender or a brand group. */
export type RollupEntry =
  | { kind: 'sender'; sender: Sender }
  | {
      kind: 'group';
      /** Registrable domain the members share (eTLD+1). */
      domain: string;
      /** Members in incoming (BE sort) order. */
      senders: Sender[];
      /** Aggregate: member count. */
      senderCount: number;
      /** Aggregate: sum of members' last-30d volume. */
      volume30d: number;
      /** Aggregate: sum of members' lifetime totals (known members only). */
      totalReceived: number;
    };

/**
 * Roll the loaded sender list up by registrable domain. Domains with
 * ≥ `minGroupSize` senders collapse into ONE group entry placed at the
 * first member's position (preserving the BE sort order for the rest);
 * smaller domains pass through as plain sender entries.
 *
 * CLIENT-SIDE over the loaded pages by design: the list endpoint's
 * cursor pagination is per-sender (ADR-0014) and the loaded pages ARE
 * the visible set (#145 — search/filters narrow server-side). A group
 * can grow as more pages load; per-sender actions/selection are
 * unaffected (grouping is presentation-only, D226 preview semantics
 * stay per-sender).
 */
/**
 * Consumer mail providers whose domain is NOT a brand — 13 unrelated
 * humans at gmail.com are not "gmail.com" the sender (2026-07-16
 * founder smoke). Rollup exists for bulk senders sharing a brand;
 * these providers never qualify.
 */
const CONSUMER_MAIL_PROVIDERS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'ymail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'proton.me',
  'protonmail.com',
  'aol.com',
]);

export function rollupByDomain(senders: readonly Sender[], minGroupSize = 3): RollupEntry[] {
  const byDomain = new Map<string, Sender[]>();
  for (const s of senders) {
    const key = registrableDomain(s.domain);
    // Two exclusions keep a group meaning "one brand's bulk senders":
    // consumer providers (the domain isn't a brand), and senders the
    // user has replied to (a relationship is never rollup inventory,
    // whatever domain it mails from).
    if (CONSUMER_MAIL_PROVIDERS.has(key) || s.repliedCount > 0) continue;
    const arr = byDomain.get(key);
    if (arr) arr.push(s);
    else byDomain.set(key, [s]);
  }

  // Membership is per-sender, not per-domain: a replied-to sender at a
  // grouped domain must still emit as its own row, never be swallowed.
  const groupedSenderIds = new Set<string>();
  for (const [domain, members] of byDomain) {
    if (domain.length > 0 && members.length >= minGroupSize) {
      for (const m of members) groupedSenderIds.add(m.id);
    }
  }

  const entries: RollupEntry[] = [];
  const emitted = new Set<string>();
  for (const s of senders) {
    const key = registrableDomain(s.domain);
    if (!groupedSenderIds.has(s.id)) {
      entries.push({ kind: 'sender', sender: s });
      continue;
    }
    if (emitted.has(key)) continue; // swallowed into the earlier group row
    emitted.add(key);
    const members = byDomain.get(key)!;
    entries.push({
      kind: 'group',
      domain: key,
      senders: members,
      senderCount: members.length,
      volume30d: members.reduce((sum, m) => sum + (m.monthlyVolume ?? 0), 0),
      totalReceived: members.reduce((sum, m) => sum + m.totalReceived, 0),
    });
  }
  return entries;
}
