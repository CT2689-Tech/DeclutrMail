#!/usr/bin/env tsx
/**
 * verify-d.ts — STUB.
 *
 * Flips a D-row from 🔵 Shipped to 🟢 Verified once its verification source
 * (test, contract, story, etc.) passes. Real implementation lands in PR 1b
 * alongside the GH Action that auto-runs it.
 *
 * Usage: pnpm verify-d <D###>
 *
 * Exit codes:
 *   0 — verified (D row flipped 🔵 → 🟢)
 *   1 — D not found or already verified
 *   2 — verification source failed
 *
 * For now: always exits 1 with a notice — call sites are unblocked but
 * verification is a manual flip until PR 1b lands the runner.
 */

const d = process.argv[2];
if (!d || !/^D\d{1,3}$/.test(d)) {
  console.error('Usage: pnpm verify-d <D###>  (e.g. pnpm verify-d D11)');
  process.exit(1);
}

console.error(
  `verify-d: stub — automated verification lands in PR 1b. Flip ${d} manually in IMPLEMENTATION-LOG.md for now.`,
);
process.exit(1);
