#!/usr/bin/env tsx
/**
 * generate-impl-log.ts — the DERIVED implementation log (D158, 2026-07-28).
 *
 * History: the previous design had a GitHub Action (`pr-merged.yml`) push
 * status flips straight to `main`. Branch protection rejected that push on
 * every single run — the workflow NEVER once wrote a flip, and its green
 * runs were the ones that exited early with nothing to do. This script
 * replaces maintenance with derivation:
 *
 *   ⬜ / 🔵  are DERIVED — recomputed from the plan (which D-numbers exist)
 *            and from merged PRs' `Closes D###` trailers (which are built).
 *   🟢 🚫 🟡 🔴 ⏸️  are RECORDED — human/scripted events this generator
 *            preserves from the existing file (the "overlay") and audits.
 *
 * Docs-only PRs RECORD a decision, they do not implement it: a merged PR
 * counts as implementing only if it touches at least one non-`.md` file.
 * (That distinction is load-bearing — the PR that *adds* D248 to the plan
 * says `Closes D248`, and flipping D248 to Shipped on it would assert a
 * feature that does not exist. The old workflow tried exactly that flip
 * and only branch protection kept the log honest.)
 *
 * 🟢 audit (D158 call 4): a Verified row must carry evidence. On every
 * run, a 🟢 row with an empty evidence cell, a literal `manual`, or a
 * cited file that no longer exists is demoted to 🔵 with a note. Use
 * `pnpm verify-d` (evidence-gated) to re-earn 🟢.
 *
 * Modes:
 *   pnpm generate-impl-log            regenerate IMPLEMENTATION-LOG.md
 *   pnpm generate-impl-log --check    exit 1 if the committed file differs
 *                                     from the derived one (CI PR gate)
 *
 * Requires `gh` (authenticated locally; GH_TOKEN in CI). If the merged-PR
 * set cannot be read this script FAILS LOUDLY — it never treats an
 * unreadable list as empty, because "no data" rendered as "no PRs" is the
 * exact blindness that let stale state accumulate before (see the
 * infra-snapshot incident, MISTAKES.md 2026-07-26).
 *
 * Exit codes:
 *   0 — log written (or --check passed)
 *   1 — plan not found / no decisions parsed / --check failed
 *   2 — IMPLEMENTATION-LOG.md missing the AUTO markers
 *   3 — merged-PR set unreadable (gh failed)
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dirname ?? __dirname, '..');
const LOG_PATH = join(REPO_ROOT, 'IMPLEMENTATION-LOG.md');
const MIRROR_PATH = join(REPO_ROOT, 'docs/execution/Implementation-Plan.md');
const LOCAL_PATH = join(homedir(), '.claude/plans/i-want-you-to-smooth-kahn.md');

const DECISIONS_START = '<!-- AUTO:DECISIONS:START -->';
const DECISIONS_END = '<!-- AUTO:DECISIONS:END -->';
const SUMMARY_START = '<!-- AUTO:SUMMARY:START -->';
const SUMMARY_END = '<!-- AUTO:SUMMARY:END -->';

const AUDIT_DATE = new Date().toISOString().slice(0, 10);

/** Recorded (non-derivable) states the generator preserves. */
const RECORDED = ['🟢', '🚫', '🟡', '🔴', '⏸️'] as const;
const ALL_STATES = ['⬜', '🔵', ...RECORDED] as const;
type State = (typeof ALL_STATES)[number];

interface Decision {
  num: number;
  title: string;
}

interface OverlayRow {
  status: State;
  pr: string;
  verifiedBy: string;
  notes: string;
}

interface MergedPr {
  number: number;
  body: string;
  files: { path: string }[];
}

function resolvePlanPath(): string | null {
  if (existsSync(MIRROR_PATH)) return MIRROR_PATH;
  if (existsSync(LOCAL_PATH)) return LOCAL_PATH;
  return null;
}

function parseDecisions(plan: string): Decision[] {
  const seen = new Set<number>();
  const decisions: Decision[] = [];
  const lineRegex = /^(?:#{1,6}\s+|\*\*)D(\d{1,3})(?:\*\*)?\s*[—\-.:]\s*(.+?)(?:\s*\*\*)?$/gm;

  let match: RegExpExecArray | null;
  while ((match = lineRegex.exec(plan)) !== null) {
    const num = Number(match[1]);
    const title = match[2].trim().replace(/\s+/g, ' ');
    if (seen.has(num)) continue;
    seen.add(num);
    decisions.push({ num, title });
  }

  decisions.sort((a, b) => a.num - b.num);
  return decisions;
}

/**
 * Parse an existing table row. Titles may contain raw `|` (D12's does) —
 * the historical flip-regex bug class ([FOUNDER-FOLLOWUPS 2026-05-27]).
 * Strategy: cells right of the FIRST status-symbol cell are positional
 * (PR, Verified by, Notes…); everything between the D-number and the
 * status symbol is the title, pipes and all.
 */
function parseOverlay(block: string): Map<number, OverlayRow> {
  const overlay = new Map<number, OverlayRow>();
  for (const line of block.split('\n')) {
    if (!line.startsWith('| D')) continue;
    const cells = line.split('|').map((c) => c.trim());
    // cells[0] is '' (leading pipe); last is '' (trailing pipe)
    const dMatch = /^D(\d{1,3})$/.exec(cells[1] ?? '');
    if (!dMatch) continue;
    const statusIdx = cells.findIndex((c) => (ALL_STATES as readonly string[]).includes(c));
    if (statusIdx < 2) continue;
    const num = Number(dMatch[1]);
    overlay.set(num, {
      status: cells[statusIdx] as State,
      pr: cells[statusIdx + 1] ?? '',
      verifiedBy: cells[statusIdx + 2] ?? '',
      notes: cells
        .slice(statusIdx + 3, cells.length - 1)
        .join(' | ')
        .trim(),
    });
  }
  return overlay;
}

/** Fail-loud merged-PR read. Never returns a silently-empty list. */
function readMergedPrs(): MergedPr[] {
  let raw: string;
  try {
    raw = execFileSync(
      'gh',
      ['pr', 'list', '--state', 'merged', '--limit', '1000', '--json', 'number,body,files'],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
  } catch (err) {
    console.error(
      '✗ Could not read the merged-PR set via `gh pr list`. The derived log',
      'cannot be computed without it, and treating the list as empty would',
      'silently demote every derived row. Authenticate gh (or set GH_TOKEN)',
      'and re-run.',
    );
    console.error(String(err));
    process.exit(3);
  }
  const prs = JSON.parse(raw) as MergedPr[];
  if (!Array.isArray(prs) || prs.length === 0) {
    console.error('✗ `gh pr list` returned zero merged PRs — refusing to derive from that.');
    process.exit(3);
  }
  return prs;
}

const CLOSES_RE = /Closes\s+D(\d{1,3})\b/gi;

/** A PR implements (vs merely records) iff it touches any non-md file. */
function isImplementing(pr: MergedPr): boolean {
  return pr.files.some((f) => !f.path.toLowerCase().endsWith('.md'));
}

function deriveImplementedBy(prs: MergedPr[]): Map<number, number[]> {
  const byD = new Map<number, number[]>();
  for (const pr of prs) {
    if (!isImplementing(pr)) continue;
    const body = pr.body ?? '';
    let m: RegExpExecArray | null;
    CLOSES_RE.lastIndex = 0;
    while ((m = CLOSES_RE.exec(body)) !== null) {
      const num = Number(m[1]);
      const list = byD.get(num) ?? [];
      if (!list.includes(pr.number)) list.push(pr.number);
      byD.set(num, list);
    }
  }
  for (const list of byD.values()) list.sort((a, b) => a - b);
  return byD;
}

/** Does the evidence cell cite a repo file path, and does it exist? */
function evidenceFileStatus(evidence: string): 'no-path' | 'exists' | 'missing' {
  const m = /([\w@./-]+\.(?:ts|tsx|sql|sh|md))/.exec(evidence);
  if (!m) return 'no-path';
  return existsSync(join(REPO_ROOT, m[1])) ? 'exists' : 'missing';
}

interface ComposedRow extends OverlayRow {
  num: number;
  title: string;
}

function composeRow(
  d: Decision,
  overlay: OverlayRow | undefined,
  implPrs: number[],
  demotions: string[],
): ComposedRow {
  const base: ComposedRow = {
    num: d.num,
    title: d.title,
    status: '⬜',
    pr: overlay?.pr ?? '',
    verifiedBy: overlay?.verifiedBy ?? '',
    notes: overlay?.notes ?? '',
  };

  // Merge derived PR refs into the PR cell without losing recorded prose.
  const derivedRefs = implPrs.map((n) => `#${n}`).filter((r) => !base.pr.includes(r));
  if (derivedRefs.length > 0) {
    base.pr = base.pr ? `${base.pr}, ${derivedRefs.join(', ')}` : derivedRefs.join(', ');
  }

  const recorded = overlay?.status;

  // Recorded terminal/manual states win outright.
  if (recorded === '🚫' || recorded === '⏸️' || recorded === '🔴' || recorded === '🟡') {
    base.status = recorded;
    return base;
  }

  if (recorded === '🟢') {
    const evidence = base.verifiedBy.trim();
    const bare = evidence === '' || /^manual$/i.test(evidence);
    const fileStatus = evidenceFileStatus(evidence);
    if (bare || fileStatus === 'missing') {
      const reason = bare
        ? 'no executable or observed evidence was ever recorded'
        : 'the cited evidence file no longer exists';
      base.status = '🔵';
      base.notes = [
        base.notes,
        `Evidence audit ${AUDIT_DATE} (🟢→🔵): ${reason}; re-verify via \`pnpm verify-d\``,
      ]
        .filter(Boolean)
        .join('. ');
      demotions.push(`D${d.num}: ${reason}`);
    } else {
      base.status = '🟢';
    }
    return base;
  }

  if (implPrs.length > 0) {
    base.status = '🔵';
    return base;
  }

  // A recorded 🔵 with a PR reference predates trailer discipline — trust it.
  if (recorded === '🔵' && base.pr.trim() !== '') {
    base.status = '🔵';
    return base;
  }

  base.status = '⬜';
  return base;
}

/** Escape raw pipes so a title can never break the table again. */
function cell(text: string): string {
  return text.replace(/\\\|/g, '|').replace(/\|/g, '\\|');
}

function renderRows(rows: ComposedRow[]): string {
  const lines = ['| D# | Title | Status | PR | Verified by | Notes |', '|---|---|---|---|---|---|'];
  for (const r of rows) {
    lines.push(
      `| D${r.num} | ${cell(r.title)} | ${r.status} | ${cell(r.pr)} | ${cell(r.verifiedBy)} | ${cell(r.notes)} |`,
    );
  }
  return lines.join('\n');
}

function renderSummary(rows: ComposedRow[]): string {
  const labels: [State, string][] = [
    ['⬜', 'Not started'],
    ['🟡', 'In progress'],
    ['🔵', 'Shipped'],
    ['🟢', 'Verified'],
    ['🚫', 'Retired'],
    ['🔴', 'Blocked'],
    ['⏸️', 'Deferred'],
  ];
  const lines = [SUMMARY_START, ''];
  for (const [symbol, label] of labels) {
    lines.push(`- ${symbol} ${label}: ${rows.filter((r) => r.status === symbol).length}`);
  }
  lines.push(`- **Total: ${rows.length} D-decisions**`);
  lines.push('');
  lines.push(SUMMARY_END);
  return lines.join('\n');
}

function spliceBlock(src: string, start: string, end: string, replacement: string): string {
  const s = src.indexOf(start);
  const e = src.indexOf(end);
  if (s === -1 || e === -1 || e < s) {
    console.error(`✗ ${LOG_PATH} missing markers ${start} ... ${end}`);
    process.exit(2);
  }
  return src.slice(0, s) + replacement + src.slice(e + end.length);
}

function main(): void {
  const checkMode = process.argv.includes('--check');

  const planPath = resolvePlanPath();
  if (!planPath) {
    console.error(`✗ Plan not found. Checked:\n  - ${MIRROR_PATH}\n  - ${LOCAL_PATH}`);
    process.exit(1);
  }

  const decisions = parseDecisions(readFileSync(planPath, 'utf8'));
  if (decisions.length === 0) {
    console.error(`✗ No D-decisions parsed from ${planPath}`);
    process.exit(1);
  }

  const current = readFileSync(LOG_PATH, 'utf8');
  const blockStart = current.indexOf(DECISIONS_START);
  const blockEnd = current.indexOf(DECISIONS_END);
  if (blockStart === -1 || blockEnd === -1) {
    console.error(`✗ ${LOG_PATH} missing markers ${DECISIONS_START} ... ${DECISIONS_END}`);
    process.exit(2);
  }
  const overlay = parseOverlay(current.slice(blockStart, blockEnd));

  const implementedBy = deriveImplementedBy(readMergedPrs());

  const demotions: string[] = [];
  const rows = decisions.map((d) =>
    composeRow(d, overlay.get(d.num), implementedBy.get(d.num) ?? [], demotions),
  );

  let next = spliceBlock(
    current,
    DECISIONS_START,
    DECISIONS_END,
    `${DECISIONS_START}\n\n${renderRows(rows)}\n\n${DECISIONS_END}`,
  );
  next = spliceBlock(next, SUMMARY_START, SUMMARY_END, renderSummary(rows));

  if (checkMode) {
    if (next === current) {
      console.log(`✓ IMPLEMENTATION-LOG.md is current (${rows.length} D-rows).`);
      return;
    }
    console.error('✗ IMPLEMENTATION-LOG.md is stale. Run `pnpm generate-impl-log` and commit.');
    const currentRows = new Map(
      [...parseOverlay(current.slice(blockStart, blockEnd)).entries()].map(([k, v]) => [
        k,
        `${v.status}|${v.pr}`,
      ]),
    );
    for (const r of rows) {
      const now = `${r.status}|${r.pr}`;
      if (currentRows.get(r.num) !== now) {
        console.error(`  D${r.num}: ${currentRows.get(r.num) ?? '(no row)'} → ${now}`);
      }
    }
    process.exit(1);
  }

  writeFileSync(LOG_PATH, next);
  console.log(`✓ Wrote ${rows.length} D-rows to ${LOG_PATH} (plan: ${planPath}).`);
  if (demotions.length > 0) {
    console.log(`  Evidence audit demoted ${demotions.length} row(s) 🟢→🔵:`);
    for (const d of demotions) console.log(`    - ${d}`);
  }
}

main();
