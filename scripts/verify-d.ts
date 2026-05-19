#!/usr/bin/env tsx
/**
 * verify-d.ts
 *
 * Flips a D-row in IMPLEMENTATION-LOG.md from 🔵 Shipped to 🟢 Verified.
 *
 * Usage:
 *   pnpm verify-d D11
 *   pnpm verify-d D11 --source=test
 *   pnpm verify-d D11 --source="schema-migration-reviewer + integration test"
 *
 * The --source flag is optional; if omitted, "manual" is recorded.
 *
 * State machine (CLAUDE.md §8):
 *   ⬜ Not started → 🟡 In progress → 🔵 Shipped → 🟢 Verified
 *   This script handles the 🔵 → 🟢 transition only.
 *
 * Exit codes:
 *   0 — verification recorded (row flipped 🔵 → 🟢)
 *   0 — already 🟢 (idempotent no-op)
 *   1 — argv error
 *   2 — D-row not found
 *   3 — D-row not in 🔵 state (must ship first via PR merge)
 *   4 — IMPLEMENTATION-LOG.md not found or malformed
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dirname ?? __dirname, '..');
const LOG_PATH = join(REPO_ROOT, 'IMPLEMENTATION-LOG.md');

function parseArgs(): { d: string; source: string } {
  const argv = process.argv.slice(2);
  const d = argv[0];
  if (!d || !/^D\d{1,3}$/.test(d)) {
    console.error('Usage: pnpm verify-d <D###> [--source=<text>]');
    console.error('  e.g. pnpm verify-d D11');
    console.error('       pnpm verify-d D11 --source=test');
    process.exit(1);
  }

  let source = 'manual';
  for (const arg of argv.slice(1)) {
    const m = /^--source=(.+)$/.exec(arg);
    if (m) source = m[1];
  }

  return { d, source };
}

function main(): void {
  const { d, source } = parseArgs();
  const num = d.slice(1);

  if (!existsSync(LOG_PATH)) {
    console.error(`✗ ${LOG_PATH} not found.`);
    process.exit(4);
  }

  const log = readFileSync(LOG_PATH, 'utf8');
  const lines = log.split('\n');

  // Row shape: `| D<num> | <title> | <status> | <pr> | <verified-by> | <notes> |`
  const rowPrefix = `| D${num} |`;
  const rowIdx = lines.findIndex((line) => line.startsWith(rowPrefix));
  if (rowIdx === -1) {
    console.error(`✗ Row for ${d} not found in ${LOG_PATH}.`);
    console.error(`  Run \`pnpm generate-impl-log\` first if rows are missing.`);
    process.exit(2);
  }

  const row = lines[rowIdx];
  const cells = row.split('|').map((c) => c.trim());
  // cells: ['', 'D<num>', '<title>', '<status>', '<pr>', '<verified-by>', '<notes>', '']
  if (cells.length < 7) {
    console.error(`✗ Row for ${d} is malformed: ${row}`);
    process.exit(4);
  }

  const currentStatus = cells[3];
  if (currentStatus === '🟢') {
    console.log(`✓ ${d} is already 🟢 Verified (no-op).`);
    process.exit(0);
  }
  if (currentStatus !== '🔵') {
    console.error(`✗ ${d} is ${currentStatus || '(empty)'} — must be 🔵 Shipped to verify.`);
    console.error(`  PR-merge auto-flips ⬜/🟡 → 🔵 via .github/workflows/pr-merged.yml.`);
    process.exit(3);
  }

  cells[3] = '🟢';
  cells[5] = source;
  const nextRow = '| ' + cells.slice(1, -1).join(' | ') + ' |';
  lines[rowIdx] = nextRow;

  writeFileSync(LOG_PATH, lines.join('\n'));
  console.log(`✓ ${d}: 🔵 Shipped → 🟢 Verified (source: ${source})`);
}

main();
