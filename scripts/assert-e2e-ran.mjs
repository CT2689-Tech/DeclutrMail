#!/usr/bin/env node
/**
 * assert-e2e-ran.mjs — a Playwright run that skipped is not a pass.
 *
 * Playwright exits 0 when every test skips. Chained behind a required
 * status check, that renders as a green checkmark over an assertion
 * nobody made. This repo has now shipped that shape three times (a
 * never-green infra monitor, a permanently-skipped spec, and the money
 * path's `test.skip` preconditions), so the CI lane asserts coverage
 * explicitly instead of trusting an exit code.
 *
 * Fails when:
 *   - the report is missing or unparseable  (the run did not produce one)
 *   - `expected` is 0                       (nothing ran at all)
 *   - `skipped` is > 0                      (something declined to run)
 *
 * `unexpected` / `flaky` are deliberately NOT checked here — Playwright's
 * own exit code already covers those, and duplicating it would report one
 * failure as two.
 *
 * Usage:  node scripts/assert-e2e-ran.mjs <report.json> [label]
 */
import { readFileSync } from 'node:fs';

const [reportPath, label = reportPath] = process.argv.slice(2);

if (!reportPath) {
  console.error('✗ usage: node scripts/assert-e2e-ran.mjs <report.json> [label]');
  process.exit(2);
}

let stats;
try {
  stats = JSON.parse(readFileSync(reportPath, 'utf8')).stats;
} catch (err) {
  console.error(
    `✗ ${label}: no readable Playwright JSON report at ${reportPath}. The run`,
    'produced no coverage evidence, so it cannot count as a pass.',
  );
  console.error(String(err));
  process.exit(1);
}

const expected = stats?.expected ?? 0;
const skipped = stats?.skipped ?? 0;

if (expected === 0) {
  console.error(`✗ ${label}: zero tests ran. A suite that runs nothing is not a passing suite.`);
  process.exit(1);
}

if (skipped > 0) {
  console.error(
    `✗ ${label}: ${skipped} test(s) skipped. In CI every precondition is`,
    'provisioned by the workflow, so a skip means something broke and went',
    'unreported. Use requirePrecondition() from packages/e2e/helpers/preconditions.ts',
    'so the break fails loudly instead.',
  );
  process.exit(1);
}

console.log(`✓ ${label}: ${expected} test(s) ran, 0 skipped.`);
