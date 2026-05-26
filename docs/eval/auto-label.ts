/* eslint-disable no-console */
/**
 * Path B auto-labeler — Tier A weak-supervision rules for the sender
 * classification eval set.
 *
 * Reads docs/eval/sender-classification-eval-set.csv, computes the
 * `auto_action` column for each sender using deterministic rules over
 * gmail_category + read rate + volume + recency, and writes the CSV
 * back in place with the new column filled.
 *
 * Why this exists: manual labeling 165 senders doesn't scale. Gmail's
 * existing CATEGORY_* labels + behavior signals we already track
 * (msg count, read rate, replies, last-seen) carry enough signal to
 * pre-bucket ~90% of senders with high confidence. Manual labeling
 * shrinks to the ~10% genuinely-ambiguous middle.
 *
 * D222 compliance: this reads Gmail's existing classifications; we do
 * NOT predict categories. ADR-0012 implementation note confirms this
 * is allowed; cascade Phase A rule 3 already uses gmailCategory.
 *
 * Run from repo root:
 *
 *   pnpm tsx docs/eval/auto-label.ts
 *
 * Idempotent — re-runnable. Overwrites any previous `auto_action`
 * values; preserves `desired_action` (manual override column).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

type Bucket = 'people' | 'cleanup' | 'engaged' | 'watching' | '';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = resolve(__dirname, 'sender-classification-eval-set.csv');

interface Row {
  raw: Record<string, string>;
  signals: {
    gmail_category: string;
    msg: number;
    read_pct_all: number;
    read_pct_90d: number;
    replies: number;
    starred_year: number;
    important_count: number;
    has_unsub: boolean;
    last_seen_days: number;
    first_seen_days: number;
  };
}

function parseCsv(text: string): { header: string[]; rows: Record<string, string>[] } {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') {
        row.push(cell);
        cell = '';
      } else if (ch === '\n') {
        row.push(cell);
        out.push(row);
        row = [];
        cell = '';
      } else if (ch === '\r') {
        // ignore
      } else {
        cell += ch;
      }
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    out.push(row);
  }
  const header = out.shift() ?? [];
  const rows = out
    .filter((r) => r.some((c) => c !== ''))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
  return { header, rows };
}

function serializeCsv(header: string[], rows: Record<string, string>[]): string {
  const escape = (s: string): string => {
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };
  const headerLine = header.map(escape).join(',');
  const dataLines = rows.map((r) => header.map((h) => escape(r[h] ?? '')).join(','));
  return [headerLine, ...dataLines].join('\n') + '\n';
}

function rowToSignals(r: Record<string, string>): Row['signals'] {
  return {
    gmail_category: r.gmail_category ?? '',
    msg: Number(r.total_messages) || 0,
    read_pct_all: Number(r.read_rate_all) || 0,
    read_pct_90d: Number(r.read_rate_90d) || 0,
    replies: Number(r.replies_sent) || 0,
    starred_year: Number(r.starred_year) || 0,
    important_count: Number(r.important_count) || 0,
    has_unsub: r.has_unsub === 't' || r.has_unsub === 'true',
    last_seen_days: Number(r.last_seen_days) || 0,
    first_seen_days: Number(r.first_seen_days) || 0,
  };
}

/**
 * Tier A weak-supervision rules. ORDER MATTERS — first match wins.
 *
 * Each rule encodes a high-confidence labeling — rules that are
 * "obvious" without a human in the loop. Ambiguous middle ground
 * intentionally falls through to empty string (= unlabeled).
 *
 * Refine by editing this file + re-running. Each rule is one branch;
 * no aggregation, no scoring — keeps the audit trail trivial.
 */
function autoLabel(s: Row['signals']): { bucket: Bucket; reason: string } {
  // 1. Bidirectional correspondence = strongest People signal.
  if (s.replies > 0) return { bucket: 'people', reason: 'replied' };

  // 2. Gmail Primary + read-rate ≥ 25% = Gmail thinks person AND user reads.
  if (s.gmail_category === 'primary' && s.msg >= 3 && s.read_pct_all >= 0.25) {
    return { bucket: 'people', reason: 'gmail-primary + read>=25%' };
  }

  // 3. Promotions + low read at meaningful volume = classic cleanup.
  if (s.gmail_category === 'promotions' && s.msg >= 10 && s.read_pct_all < 0.15) {
    return { bucket: 'cleanup', reason: 'promo + vol>=10 + read<15%' };
  }

  // 4. Promotions w/ unsubscribe header + mid-low read = unsubable noise.
  if (s.gmail_category === 'promotions' && s.has_unsub && s.msg >= 5 && s.read_pct_all < 0.3) {
    return { bucket: 'cleanup', reason: 'promo + unsub + read<30%' };
  }

  // 5. Social + low engagement at meaningful volume = social noise.
  if (s.gmail_category === 'social' && s.msg >= 5 && s.read_pct_all < 0.1) {
    return { bucket: 'cleanup', reason: 'social + vol>=5 + read<10%' };
  }

  // 6. Updates at high volume + low read = transactional noise (HDFC,
  //    BSE, Zerodha alerts, etc.).
  if (s.gmail_category === 'updates' && s.msg >= 50 && s.read_pct_all < 0.2) {
    return { bucket: 'cleanup', reason: 'updates + vol>=50 + read<20%' };
  }
  if (s.gmail_category === 'updates' && s.msg >= 200 && s.read_pct_all < 0.3) {
    return { bucket: 'cleanup', reason: 'updates + vol>=200 + read<30%' };
  }

  // 7. High overall read-rate at meaningful volume = Engaged.
  if (s.msg >= 5 && s.read_pct_all >= 0.4) {
    return { bucket: 'engaged', reason: 'read>=40% + vol>=5' };
  }

  // 8. Starred recently + decent read = Engaged.
  if (s.starred_year > 0 && s.read_pct_all >= 0.2) {
    return { bucket: 'engaged', reason: 'starred + read>=20%' };
  }

  // 9. Sparse history = Watching (Phase B equivalent — insufficient signal).
  if (s.msg < 3) return { bucket: 'watching', reason: 'msg<3' };

  // 10. Dormant senders → Watching (re-evaluate when they re-engage).
  if (s.last_seen_days > 180) {
    return { bucket: 'watching', reason: 'last_seen>180d' };
  }

  // Ambiguous middle — leave for manual review / cascade / user action.
  return { bucket: '', reason: '' };
}

function main(): void {
  const text = readFileSync(CSV_PATH, 'utf8');
  const { header, rows } = parseCsv(text);

  // Ensure auto_action + auto_reason columns exist; add if missing.
  let headerChanged = false;
  if (!header.includes('auto_action')) {
    header.push('auto_action');
    headerChanged = true;
  }
  if (!header.includes('auto_reason')) {
    header.push('auto_reason');
    headerChanged = true;
  }

  const counts: Record<Bucket, number> = {
    people: 0,
    cleanup: 0,
    engaged: 0,
    watching: 0,
    '': 0,
  };

  for (const row of rows) {
    const signals = rowToSignals(row);
    const { bucket, reason } = autoLabel(signals);
    row.auto_action = bucket;
    row.auto_reason = reason;
    counts[bucket]++;
  }

  const out = serializeCsv(header, rows);
  writeFileSync(CSV_PATH, out, 'utf8');

  console.log('');
  console.log('═══════════════ Tier A auto-labeler ═══════════════');
  console.log(`CSV:           ${CSV_PATH}`);
  console.log(`Rows scored:   ${rows.length}`);
  if (headerChanged) {
    console.log(`Columns added: auto_action, auto_reason`);
  }
  console.log('');
  console.log('Coverage by bucket:');
  for (const b of ['people', 'cleanup', 'engaged', 'watching', ''] as Bucket[]) {
    const label = b === '' ? '(unlabeled / ambiguous)' : b;
    const n = counts[b];
    const pct = rows.length === 0 ? 0 : Math.round((n / rows.length) * 1000) / 10;
    console.log(`  ${label.padEnd(28)} ${String(n).padStart(4)}  ${pct}%`);
  }
  const labeled = rows.length - counts[''];
  const coverage = rows.length === 0 ? 0 : Math.round((labeled / rows.length) * 1000) / 10;
  console.log('');
  console.log(`Total auto-coverage: ${labeled} / ${rows.length} = ${coverage}%`);
  console.log('');
  console.log('Next: open the CSV, scan the (unlabeled) rows. Fill desired_action');
  console.log('only when you disagree with auto_action OR when auto_action is empty.');
  console.log('Then run: pnpm tsx docs/eval/score-eval.ts');
}

main();
