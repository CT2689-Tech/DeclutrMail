/* eslint-disable no-console */
/**
 * Sender-classification eval-set scorer.
 *
 * Reads docs/eval/sender-classification-eval-set.csv (your manually-labeled
 * truth set), constructs `SenderSignals` for each row, runs the existing
 * cascade in packages/workers/src/score-cascade.ts, maps cascade verdict +
 * ruleId to a bucket (people / cleanup / engaged / watching), and prints a
 * mismatch report.
 *
 * Run from repo root:
 *
 *   pnpm tsx docs/eval/score-eval.ts
 *
 * Exit code 0 if accuracy ≥ TARGET_ACCURACY_PCT (default 85); non-zero
 * otherwise. Use the script in CI to catch cascade-regression after threshold
 * changes.
 *
 * Why this is a script, not a unit test: the eval set is real-user data the
 * tests can't see (gitignored by default). The script is the human-loop
 * tuning tool; once the cascade is tuned, the unit tests in
 * packages/workers/src/score-cascade.test.ts pin the behavior.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { isGovernmentDomain, runCascade, type SenderSignals } from '@declutrmail/workers';

const TARGET_ACCURACY_PCT = 85;

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = resolve(__dirname, 'sender-classification-eval-set.csv');

type Bucket = 'people' | 'cleanup' | 'engaged' | 'watching';
const BUCKETS: ReadonlySet<Bucket> = new Set(['people', 'cleanup', 'engaged', 'watching']);

interface EvalRow {
  sample_band: string;
  display_name: string;
  domain: string;
  signals: SenderSignals;
  /**
   * Effective label = `desired_action` when present (human override),
   * else `auto_action` from the Tier A rules (see auto-label.ts).
   * Empty means the row is skipped.
   */
  effective_label: string;
  /** Where the effective label came from. */
  label_source: 'manual' | 'auto' | 'none';
  desired_reason: string;
  auto_reason: string;
  notes: string;
}

/* ───────────────────────────── CSV PARSER ───────────────────────────── */
// Minimal CSV parser — handles quoted fields with embedded commas + escaped
// quotes (""). Sufficient for psql's COPY ... WITH CSV output. Avoids pulling
// in a CSV lib just for this dev script.
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
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
        rows.push(row);
        row = [];
        cell = '';
      } else if (ch === '\r') {
        // ignore — handled by the next \n
      } else {
        cell += ch;
      }
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  const header = rows.shift();
  if (!header) return [];
  return rows
    .filter((r) => r.some((c) => c !== ''))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

/* ────────────────────────── SIGNALS BUILDER ─────────────────────────── */
function rowToSignals(row: Record<string, string>): SenderSignals {
  return {
    // No sender_policies seeded in the eval DB — defaults match cold-start.
    isProtected: false,
    isVip: false,
    hasReplied: Number(row.replies_sent) > 0,
    gmailCategory: row.gmail_category as SenderSignals['gmailCategory'],
    starredInLastYear: Number(row.starred_year) > 0,
    readRate90d: Number(row.read_rate_90d),
    firstSeenMonthsAgo: Number(row.first_seen_months),
    firstSeenDaysAgo: Number(row.first_seen_days),
    lastSeenDaysAgo: Number(row.last_seen_days),
    totalMessages: Number(row.total_messages),
    monthlyVolume: Number(row.monthly_volume),
    spikeRatio: Number(row.spike_ratio),
    // The eval CSV predates the channel split — `has_unsub` is a single
    // BOOL_OR over unsubscribe_url/one_click (regenerate-eval-set.sql).
    // Map true → 'one_click': Gmail has required RFC 8058 one-click for
    // bulk senders since 2024, so it is the faithful reading for the
    // marketing mail this set labels. Regenerate the CSV with method
    // granularity to sharpen mailto-only rows.
    unsubscribeChannel: row.has_unsub === 't' || row.has_unsub === 'true' ? 'one_click' : 'none',
    isGovDomain: isGovernmentDomain(row.domain ?? ''),
    // activity_log was empty in the eval DB — defer when log gets data.
    userManuallyArchivedCount: 0,
  };
}

/* ─────────────────────── VERDICT → BUCKET MAP ───────────────────────── */
// The cascade returns K/A/U/L verdicts + a ruleId encoding *why*. The user-
// facing bucket aggregates by intent: replied-or-Gmail-primary → people;
// other Keep paths (high read, starred, long relationship) → engaged;
// destructive verdicts → cleanup; Phase B → watching.
function cascadeToBucket(verdict: string, ruleId: string): Bucket {
  if (verdict === 'archive' || verdict === 'unsubscribe') return 'cleanup';
  if (verdict === 'later') return 'watching';
  // verdict === 'keep' — split by ruleId
  switch (ruleId) {
    case 'replied_at_least_once':
    case 'gmail_primary':
    case 'protect_user_defined':
    case 'protect_vip':
      return 'people';
    case 'high_read_rate':
    case 'starred_recently':
    case 'long_relationship_engaged':
    case 'protect_engagement_based':
      return 'engaged';
    default:
      return 'engaged';
  }
}

/* ─────────────────────────────── MAIN ───────────────────────────────── */
function main(): number {
  const text = readFileSync(CSV_PATH, 'utf8');
  const raw = parseCsv(text);

  const rows: EvalRow[] = raw.map((r) => {
    const desired = (r.desired_action ?? '').trim().toLowerCase();
    const auto = (r.auto_action ?? '').trim().toLowerCase();
    let effective_label = '';
    let label_source: EvalRow['label_source'] = 'none';
    if (BUCKETS.has(desired as Bucket)) {
      effective_label = desired;
      label_source = 'manual';
    } else if (BUCKETS.has(auto as Bucket)) {
      effective_label = auto;
      label_source = 'auto';
    }
    return {
      sample_band: r.sample_band ?? '',
      display_name: r.display_name ?? '',
      domain: r.domain ?? '',
      signals: rowToSignals(r),
      effective_label,
      label_source,
      desired_reason: (r.desired_reason ?? '').trim(),
      auto_reason: (r.auto_reason ?? '').trim(),
      notes: (r.notes ?? '').trim(),
    };
  });

  const labeled = rows.filter((r) => BUCKETS.has(r.effective_label as Bucket));
  if (labeled.length === 0) {
    console.error(
      `No labeled rows found in ${CSV_PATH}.\n` +
        `Run \`pnpm tsx docs/eval/auto-label.ts\` first to auto-label via Tier A rules,\n` +
        `OR fill the desired_action column manually with one of: people / cleanup / engaged / watching.`,
    );
    return 2;
  }

  const manualCount = labeled.filter((r) => r.label_source === 'manual').length;
  const autoCount = labeled.filter((r) => r.label_source === 'auto').length;

  let agree = 0;
  const mismatches: Array<{
    sender: string;
    domain: string;
    desired: string;
    got: Bucket;
    ruleId: string;
    confidence: number;
    signals: SenderSignals;
    reason: string;
  }> = [];

  const byBucketAgreement: Record<Bucket, { hit: number; miss: number }> = {
    people: { hit: 0, miss: 0 },
    cleanup: { hit: 0, miss: 0 },
    engaged: { hit: 0, miss: 0 },
    watching: { hit: 0, miss: 0 },
  };

  for (const row of labeled) {
    const result = runCascade(row.signals);
    const got = cascadeToBucket(result.verdict, result.ruleId);
    const desired = row.effective_label as Bucket;
    if (got === desired) {
      agree++;
      byBucketAgreement[desired].hit++;
    } else {
      byBucketAgreement[desired].miss++;
      mismatches.push({
        sender: row.display_name || '(no name)',
        domain: row.domain,
        desired,
        got,
        ruleId: result.ruleId,
        confidence: result.confidence,
        signals: row.signals,
        reason:
          row.label_source === 'manual'
            ? row.desired_reason
            : `auto: ${row.auto_reason || '(no reason)'}`,
      });
    }
  }

  const accuracyPct = Math.round((agree / labeled.length) * 1000) / 10;

  console.log('');
  console.log('═══════════════ Sender bucket classifier evaluation ═══════════════');
  console.log(
    `Labeled rows:  ${labeled.length} of ${rows.length} (${rows.length - labeled.length} unlabeled, skipped)`,
  );
  console.log(`Label source:  ${manualCount} manual override · ${autoCount} auto (Tier A rules)`);
  console.log(`Agreement:     ${agree} / ${labeled.length} = ${accuracyPct}%`);
  console.log(`Target:        ${TARGET_ACCURACY_PCT}%`);
  console.log('');
  console.log('Per-bucket agreement:');
  for (const b of ['people', 'cleanup', 'engaged', 'watching'] as Bucket[]) {
    const { hit, miss } = byBucketAgreement[b];
    const total = hit + miss;
    const pct = total === 0 ? '—' : `${Math.round((hit / total) * 100)}%`;
    console.log(`  ${b.padEnd(10)} ${String(hit).padStart(3)}/${String(total).padEnd(3)}  ${pct}`);
  }
  console.log('');

  if (mismatches.length > 0) {
    console.log(`─────────────── Mismatches (${mismatches.length}) ───────────────`);
    for (const m of mismatches) {
      const label = `${m.sender} (${m.domain})`;
      console.log('');
      console.log(`  ${label}`);
      console.log(`    you say:    ${m.desired}${m.reason ? `  — ${m.reason}` : ''}`);
      console.log(`    cascade:    ${m.got}  (ruleId=${m.ruleId}, conf=${m.confidence})`);
      console.log(
        `    signals:    msg=${m.signals.totalMessages}  vol/mo=${m.signals.monthlyVolume}  read90d=${(m.signals.readRate90d * 100).toFixed(0)}%  replied=${m.signals.hasReplied}  starred=${m.signals.starredInLastYear}  cat=${m.signals.gmailCategory}  last_seen=${m.signals.lastSeenDaysAgo}d`,
      );
    }
    console.log('');
  }

  console.log('───────────────────────────────────────────────────────────────────');
  if (accuracyPct >= TARGET_ACCURACY_PCT) {
    console.log(
      `✓ PASS — cascade matches labels at ${accuracyPct}% (target ${TARGET_ACCURACY_PCT}%).`,
    );
    return 0;
  }
  console.log(
    `✗ FAIL — cascade matches labels at ${accuracyPct}% (target ${TARGET_ACCURACY_PCT}%).`,
  );
  console.log(`  Inspect mismatches above. Either revise labels (if your label was wrong)`);
  console.log(`  OR edit thresholds in packages/workers/src/score-cascade.ts and re-run.`);
  return 1;
}

process.exit(main());
