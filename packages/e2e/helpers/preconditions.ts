import { test } from '@playwright/test';

/**
 * A precondition that is OPTIONAL locally but GUARANTEED in CI.
 *
 * `test.skip(cond, reason)` is the right call on a developer laptop: the
 * Gmail-backed specs cannot run without a synced mailbox, and skipping
 * with a reason beats a red suite that says nothing. In CI it is the
 * wrong call — every precondition the CI lane cares about is something
 * the workflow itself provisions (postgres, redis, the api, the web app,
 * `DEV_AUTH_ENABLED`, `BILLING_ENABLED`, the synthetic seed). If one of
 * those is missing, the run has discovered a real break, and skipping
 * reports it as a green checkmark.
 *
 * That is not hypothetical. `billing-upgrade.spec.ts` — the money path,
 * paywall → signed webhook → tier flip — guarded all three of its
 * preconditions with `test.skip`, so a broken dev-login, a dark billing
 * module, or an unset webhook secret would each have turned the required
 * `Authenticated accessibility smoke` check green having asserted
 * nothing. It is the same shape as the permanently-skipped spec found
 * live on 2026-08-11 and the never-green infra monitor before it: a
 * guard whose input is starved reports success.
 *
 * Use this instead of `test.skip` for any condition CI is supposed to
 * satisfy. Keep bare `test.skip` only where the missing thing genuinely
 * cannot exist in CI (a real Gmail mailbox), and see
 * `scripts/assert-e2e-ran.mjs` for the backstop that catches skips this
 * helper never saw.
 */
export function requirePrecondition(unmet: boolean, reason: string): void {
  if (!unmet) return;
  if (process.env.CI) {
    throw new Error(
      `e2e precondition unmet in CI — CI provisions this, so it is a failure, not a skip: ${reason}`,
    );
  }
  test.skip(true, reason);
}
