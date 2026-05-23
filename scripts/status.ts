#!/usr/bin/env tsx
/**
 * status.ts — console view of D-decision progress
 *
 * Reads IMPLEMENTATION-LOG.md (source of truth) and renders a colored
 * summary + topic-grouped table to stdout. No mutation, no subprocess.
 *
 * Usage:
 *   pnpm status                       # full summary + all topics
 *   pnpm status D14                   # one-row detail
 *   pnpm status --topic=privacy       # filter to one topic substring
 *   pnpm status --status=shipped      # filter by state name
 *   pnpm status --next[=N]            # next N (default 5) ⬜ rows in D# order
 *   pnpm status --summary             # one-line summary only (statusline-safe)
 *   pnpm status --json                # machine-readable
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dirname ?? __dirname, '..');
const LOG_PATH = join(REPO_ROOT, 'IMPLEMENTATION-LOG.md');

type Status = '⬜' | '🟡' | '🔵' | '🟢' | '🔴' | '⏸️' | '?';

const STATUS_LABEL: Record<Status, string> = {
  '⬜': 'not-started',
  '🟡': 'in-progress',
  '🔵': 'shipped',
  '🟢': 'verified',
  '🔴': 'blocked',
  '⏸️': 'deferred',
  '?': 'unknown',
};

const STATUS_ALIAS: Record<string, Status> = {
  'not-started': '⬜',
  notstarted: '⬜',
  'in-progress': '🟡',
  inprogress: '🟡',
  shipped: '🔵',
  verified: '🟢',
  blocked: '🔴',
  deferred: '⏸️',
};

// Topic groups — first-match wins, so a D belongs to exactly one bucket.
// Order reflects narrative priority (privacy + lifecycle outrank generic).
type TopicRule = { name: string; match: (n: number) => boolean };

const TOPICS: TopicRule[] = [
  { name: 'Privacy', match: (n) => n === 7 || n === 228 },
  { name: 'Webhooks & auth', match: (n) => n === 229 || n === 8 },
  { name: 'Action lifecycle', match: (n) => [34, 35, 200, 207, 208, 226, 232, 233].includes(n) },
  { name: 'Triage UX', match: (n) => [27, 28, 29, 30, 31, 32, 33, 36, 37, 221].includes(n) },
  { name: 'Senders & Screener', match: (n) => (n >= 38 && n <= 49) || n === 194 },
  {
    name: 'Autopilot rules',
    match: (n) => (n >= 99 && n <= 108) || [10, 192, 197, 222, 234].includes(n),
  },
  { name: 'Onboarding & sync', match: (n) => [6, 109, 224].includes(n) },
  { name: 'Branding & typography', match: (n) => n === 1 || n === 2 },
  { name: 'Pricing & tiers', match: (n) => (n >= 17 && n <= 21) || n === 77 || n === 81 },
  { name: 'Database schema', match: (n) => [11, 12, 14, 150, 152, 235].includes(n) },
  {
    name: 'API + workers',
    match: (n) => (n >= 201 && n <= 205) || [13, 156, 157, 225].includes(n),
  },
  { name: 'Frontend state', match: (n) => n === 200 },
  { name: 'Observability', match: (n) => n === 159 },
  { name: 'CI/CD & hosting', match: (n) => n === 158 || n === 160 },
  { name: 'Test strategy', match: (n) => [182, 183, 206].includes(n) },
  { name: 'UI Constitution', match: (n) => [209, 210, 211, 212, 220, 227].includes(n) },
  { name: 'Codex Grill R2', match: (n) => n >= 227 && n <= 235 },
  { name: 'Legal & docs', match: (n) => [16, 17, 18, 218, 219].includes(n) },
  { name: 'Misc', match: () => true },
];

function topicOf(n: number): string {
  for (const t of TOPICS) if (t.match(n)) return t.name;
  return 'Misc';
}

interface Row {
  num: number;
  title: string;
  status: Status;
  pr: string;
  verifiedBy: string;
  notes: string;
}

// Same anchored shape verify-d.ts uses so titles with `\|` survive.
const ROW_RE = /^\| D(\d{1,3}) \| (.+?) \| (\S+|) \| ([^|]*?) \| ([^|]*?) \| ([^|]*?) \|\s*$/;

function parseLog(): Row[] {
  if (!existsSync(LOG_PATH)) {
    console.error(`✗ ${LOG_PATH} not found.`);
    process.exit(2);
  }
  const text = readFileSync(LOG_PATH, 'utf8');
  const rows: Row[] = [];
  for (const line of text.split('\n')) {
    const m = ROW_RE.exec(line);
    if (!m) continue;
    const raw = (m[3] || '?') as Status;
    const status: Status = STATUS_LABEL[raw] ? raw : '?';
    rows.push({
      num: Number(m[1]),
      title: m[2].trim(),
      status,
      pr: m[4].trim(),
      verifiedBy: m[5].trim(),
      notes: m[6].trim(),
    });
  }
  if (rows.length === 0) {
    console.error(`✗ No D-rows parsed from ${LOG_PATH}. Run \`pnpm generate-impl-log\`.`);
    process.exit(2);
  }
  return rows.sort((a, b) => a.num - b.num);
}

const useColor = !process.env.NO_COLOR && (process.stdout.isTTY || process.env.FORCE_COLOR === '1');
const c = {
  dim: (s: string) => (useColor ? `\x1b[2m${s}\x1b[0m` : s),
  bold: (s: string) => (useColor ? `\x1b[1m${s}\x1b[0m` : s),
  cyan: (s: string) => (useColor ? `\x1b[36m${s}\x1b[0m` : s),
  green: (s: string) => (useColor ? `\x1b[32m${s}\x1b[0m` : s),
  yellow: (s: string) => (useColor ? `\x1b[33m${s}\x1b[0m` : s),
  blue: (s: string) => (useColor ? `\x1b[34m${s}\x1b[0m` : s),
  red: (s: string) => (useColor ? `\x1b[31m${s}\x1b[0m` : s),
  gray: (s: string) => (useColor ? `\x1b[90m${s}\x1b[0m` : s),
};

function colorStatus(s: Status): string {
  switch (s) {
    case '🟢':
      return c.green(s);
    case '🔵':
      return c.blue(s);
    case '🟡':
      return c.yellow(s);
    case '🔴':
      return c.red(s);
    case '⏸️':
      return c.dim(s);
    default:
      return c.gray(s);
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

function counts(rows: Row[]): Record<Status, number> {
  const out: Record<Status, number> = {
    '⬜': 0,
    '🟡': 0,
    '🔵': 0,
    '🟢': 0,
    '🔴': 0,
    '⏸️': 0,
    '?': 0,
  };
  for (const r of rows) out[r.status]++;
  return out;
}

function renderSummaryLine(rows: Row[]): string {
  const k = counts(rows);
  const parts = [
    `${k['🟢']}${colorStatus('🟢')}`,
    `${k['🔵']}${colorStatus('🔵')}`,
    `${k['🟡']}${colorStatus('🟡')}`,
    `${k['⬜']}${colorStatus('⬜')}`,
  ];
  if (k['🔴']) parts.push(`${k['🔴']}${colorStatus('🔴')}`);
  if (k['⏸️']) parts.push(`${k['⏸️']}${colorStatus('⏸️')}`);
  const next = rows.find((r) => r.status === '⬜');
  const tail = next ? `  ${c.dim('next')} D${next.num}` : '';
  return `${c.bold('D')} ${parts.join(' ')}${tail}`;
}

function renderRow(r: Row, titleWidth: number): string {
  const id = `D${r.num}`.padEnd(5);
  const title = truncate(r.title, titleWidth).padEnd(titleWidth);
  const pr = r.pr ? c.cyan(`#${r.pr.replace(/^#/, '')}`) : c.dim('   ');
  const ver = r.verifiedBy ? c.dim(r.verifiedBy) : '';
  return `  ${colorStatus(r.status)} ${c.bold(id)} ${title} ${pr.padEnd(5)} ${ver}`;
}

function renderGrouped(rows: Row[]): string {
  const groups = new Map<string, Row[]>();
  for (const t of TOPICS) groups.set(t.name, []);
  for (const r of rows) groups.get(topicOf(r.num))!.push(r);

  const TITLE_W = 60;
  const out: string[] = [];
  for (const [name, rs] of groups) {
    if (rs.length === 0) continue;
    const k = counts(rs);
    const head =
      `${c.bold(name)} ${c.dim(`(${rs.length})`)}  ` +
      `${k['🟢']}${colorStatus('🟢')} ${k['🔵']}${colorStatus('🔵')} ` +
      `${k['🟡']}${colorStatus('🟡')} ${k['⬜']}${colorStatus('⬜')}` +
      (k['🔴'] ? `  ${k['🔴']}${colorStatus('🔴')}` : '') +
      (k['⏸️'] ? `  ${k['⏸️']}${colorStatus('⏸️')}` : '');
    out.push(head);
    for (const r of rs) out.push(renderRow(r, TITLE_W));
    out.push('');
  }
  return out.join('\n');
}

function renderOne(r: Row): string {
  return [
    `${colorStatus(r.status)} ${c.bold(`D${r.num}`)} — ${r.title}`,
    `  ${c.dim('status     ')}  ${r.status} ${STATUS_LABEL[r.status]}`,
    `  ${c.dim('topic      ')}  ${topicOf(r.num)}`,
    `  ${c.dim('pr         ')}  ${r.pr ? c.cyan('#' + r.pr.replace(/^#/, '')) : c.dim('—')}`,
    `  ${c.dim('verified by')}  ${r.verifiedBy || c.dim('—')}`,
    `  ${c.dim('notes      ')}  ${r.notes || c.dim('—')}`,
  ].join('\n');
}

interface Args {
  d?: number;
  topic?: string;
  status?: Status;
  next?: number;
  summary?: boolean;
  json?: boolean;
}

function parseArgs(): Args {
  const a: Args = {};
  for (const arg of process.argv.slice(2)) {
    let m: RegExpExecArray | null;
    if (/^D\d{1,3}$/i.test(arg)) {
      a.d = Number(arg.slice(1));
    } else if ((m = /^--topic=(.+)$/.exec(arg))) {
      a.topic = m[1].toLowerCase();
    } else if ((m = /^--status=(.+)$/.exec(arg))) {
      const sym = STATUS_ALIAS[m[1].toLowerCase()];
      if (!sym) {
        console.error(`✗ Unknown status "${m[1]}". Use: ${Object.keys(STATUS_ALIAS).join(', ')}`);
        process.exit(1);
      }
      a.status = sym;
    } else if (arg === '--next') {
      a.next = 5;
    } else if ((m = /^--next=(\d+)$/.exec(arg))) {
      a.next = Number(m[1]);
    } else if (arg === '--summary') {
      a.summary = true;
    } else if (arg === '--json') {
      a.json = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        [
          'Usage: pnpm status [D###] [--topic=<name>] [--status=<state>] [--next[=N]] [--summary] [--json]',
          '',
          '  D###            drill into one decision',
          '  --topic=<name>  filter by topic substring (privacy, triage, autopilot, ...)',
          '  --status=<s>    not-started | in-progress | shipped | verified | blocked | deferred',
          '  --next[=N]      next N unstarted in D# order (default 5)',
          '  --summary       one-line counts (statusline-safe)',
          '  --json          machine-readable',
        ].join('\n'),
      );
      process.exit(0);
    } else {
      console.error(`✗ Unknown arg: ${arg}`);
      process.exit(1);
    }
  }
  return a;
}

function main(): void {
  const args = parseArgs();
  const all = parseLog();

  if (args.json) {
    process.stdout.write(
      JSON.stringify(
        {
          total: all.length,
          counts: counts(all),
          rows: all.map((r) => ({ ...r, topic: topicOf(r.num) })),
        },
        null,
        2,
      ) + '\n',
    );
    return;
  }

  if (args.summary) {
    process.stdout.write(renderSummaryLine(all) + '\n');
    return;
  }

  if (args.d !== undefined) {
    const row = all.find((r) => r.num === args.d);
    if (!row) {
      console.error(`✗ D${args.d} not found in ${LOG_PATH}.`);
      process.exit(3);
    }
    process.stdout.write(renderOne(row) + '\n');
    return;
  }

  let rows = all;
  if (args.topic) {
    rows = rows.filter((r) => topicOf(r.num).toLowerCase().includes(args.topic!));
    if (rows.length === 0) {
      console.error(`✗ No rows matched topic "${args.topic}".`);
      process.exit(3);
    }
  }
  if (args.status) rows = rows.filter((r) => r.status === args.status);
  if (args.next !== undefined) rows = all.filter((r) => r.status === '⬜').slice(0, args.next);

  process.stdout.write(renderSummaryLine(all) + '  ' + c.dim(`${all.length} total`) + '\n\n');

  if (args.next !== undefined) {
    process.stdout.write(c.bold(`Next ${rows.length} ⬜ in D# order`) + '\n');
    for (const r of rows) process.stdout.write(renderRow(r, 70) + '\n');
    return;
  }

  process.stdout.write(renderGrouped(rows));
}

main();
