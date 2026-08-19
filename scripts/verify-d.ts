#!/usr/bin/env tsx
/**
 * verify-d.ts — evidence-gated 🔵 → 🟢 flips (D158 call 4, 2026-07-28).
 *
 * History: the previous version "verified" nothing — it rewrote one
 * character in the table and recorded whatever free text `--source`
 * carried, defaulting to the literal string "manual". 67 rows reached
 * 🟢 through that no-op. 🟢 exists to record the thing CI structurally
 * cannot do (CLAUDE.md §8: green gates ≠ verified behavior), so a flip
 * now requires one of:
 *
 *   --cmd "<shell command>"   The command is EXECUTED here and now.
 *                             Exit 0 flips the row and records the
 *                             command + commit + date. Non-zero leaves
 *                             the row untouched.
 *   --observed "<what you exercised and saw>"  A recorded hand-smoke
 *                             observation (≥ 20 chars — "works" is not
 *                             an observation). Records text + commit +
 *                             date.
 *
 * Bare flips are rejected. The generator's evidence audit
 * (generate-impl-log.ts) demotes 🟢 rows whose evidence is empty,
 * literal "manual", or cites a file that no longer exists — so evidence
 * written here should name real paths.
 *
 * Usage:
 *   pnpm verify-d D226 --cmd "pnpm --filter @declutrmail/api exec vitest run src/actions"
 *   pnpm verify-d D34 --observed "dev-login smoke: toggled preview pref, status flipped Row/Window and round-tripped"
 *
 * Exit codes:
 *   0 — verification recorded (or already 🟢: idempotent)
 *   1 — argv error (missing/invalid evidence)
 *   2 — D-row not found
 *   3 — D-row not in 🔵 state
 *   4 — IMPLEMENTATION-LOG.md not found or malformed
 *   5 — --cmd executed and FAILED (row untouched)
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { fragmentPath, parseFragment, renderFragment } from '@declutrmail/config/impl-log';

const REPO_ROOT = join(import.meta.dirname ?? __dirname, '..');
const LOG_PATH = join(REPO_ROOT, 'IMPLEMENTATION-LOG.md');
const FRAGMENT_DIR = join(REPO_ROOT, '.impl-log');

interface Args {
  d: string;
  cmd: string | null;
  observed: string | null;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const d = argv[0];
  const usage = [
    'Usage: pnpm verify-d <D###> (--cmd "<command>" | --observed "<what you exercised and saw>")',
    '  --cmd runs the command NOW; exit 0 is the evidence.',
    '  --observed records a hand-smoke observation (>= 20 chars).',
    '  Bare flips are rejected — 🟢 means verified, not visited.',
  ].join('\n');

  if (!d || !/^D\d{1,3}$/.test(d)) {
    console.error(usage);
    process.exit(1);
  }

  let cmd: string | null = null;
  let observed: string | null = null;
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    const c = /^--cmd=(.+)$/s.exec(arg);
    const o = /^--observed=(.+)$/s.exec(arg);
    if (c) cmd = c[1];
    else if (o) observed = o[1];
    else if (arg === '--cmd') cmd = argv[++i] ?? null;
    else if (arg === '--observed') observed = argv[++i] ?? null;
    else if (arg.startsWith('--source')) {
      console.error(
        '✗ --source is retired: it recorded assertions, not evidence. Use --cmd or --observed.',
      );
      process.exit(1);
    }
  }

  if (!cmd && !observed) {
    console.error('✗ Evidence required.\n' + usage);
    process.exit(1);
  }
  if (cmd && observed) {
    console.error('✗ Pass --cmd or --observed, not both.');
    process.exit(1);
  }
  if (observed && observed.trim().length < 20) {
    console.error('✗ --observed must actually describe what was exercised and seen (>= 20 chars).');
    process.exit(1);
  }

  return { d, cmd, observed };
}

function shortSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown-sha';
  }
}

const STATES = ['⬜', '🟡', '🔵', '🟢', '🚫', '🔴', '⏸️'];

function main(): void {
  const { d, cmd, observed } = parseArgs();

  if (!existsSync(LOG_PATH)) {
    console.error(`✗ ${LOG_PATH} not found.`);
    process.exit(4);
  }

  const log = readFileSync(LOG_PATH, 'utf8');
  const lines = log.split('\n');
  const rowIdx = lines.findIndex((l) => l.startsWith(`| ${d} |`));
  if (rowIdx === -1) {
    console.error(`✗ No row for ${d}. Run \`pnpm generate-impl-log\` first if rows are missing.`);
    process.exit(2);
  }

  // Titles/evidence may contain ESCAPED pipes (\|); split on unescaped
  // pipes only, then locate the status cell positionally.
  const line = lines[rowIdx];
  const rawCells = line.split(/(?<!\\)\|/);
  const trimmed = rawCells.map((c) => c.trim());
  const statusIdx = trimmed.findIndex((c) => STATES.includes(c));
  if (statusIdx < 2 || statusIdx + 2 >= rawCells.length) {
    console.error(`✗ Malformed row for ${d}: ${line}`);
    process.exit(4);
  }
  const status = trimmed[statusIdx];

  if (status === '🟢') {
    console.log(`✓ ${d} is already 🟢.`);
    return;
  }
  if (status !== '🔵') {
    console.error(`✗ ${d} is ${status}, not 🔵 Shipped — merge it with a Closes trailer first.`);
    process.exit(3);
  }

  const date = new Date().toISOString().slice(0, 10);
  let evidence: string;

  if (cmd) {
    console.log(`→ Running: ${cmd}`);
    try {
      execSync(cmd, { cwd: REPO_ROOT, stdio: 'inherit' });
    } catch {
      console.error(`✗ Command failed — ${d} stays 🔵. Fix the failure, then re-run.`);
      process.exit(5);
    }
    evidence = `cmd: \`${cmd}\` → exit 0 @ ${shortSha()} ${date}`;
  } else {
    evidence = `smoke: ${observed!.trim()} @ ${shortSha()} ${date}`;
  }

  // The 🟢 and its evidence are RECORDED state, so they go in the
  // decision's own fragment — not into the rendered table, which is
  // regenerated from the fragments. Writing the row directly used to put
  // every parallel PR in conflict on one file (2026-08-19).
  const num = Number(d.slice(1));
  if (!existsSync(FRAGMENT_DIR)) mkdirSync(FRAGMENT_DIR, { recursive: true });
  const fragmentFile = join(REPO_ROOT, fragmentPath(num));
  const existing = existsSync(fragmentFile)
    ? parseFragment(num, readFileSync(fragmentFile, 'utf8'))
    : { num };
  writeFileSync(
    fragmentFile,
    renderFragment({ ...existing, num, status: '🟢', verifiedBy: evidence }),
  );

  console.log(`✓ ${d} 🔵 → 🟢 (recorded in ${fragmentPath(num)})`);
  console.log(`  evidence: ${evidence}`);
  console.log('  Run `pnpm generate-impl-log` to rebuild the table.');
}

main();
