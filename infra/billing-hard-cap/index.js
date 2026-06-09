// infra/billing-hard-cap/index.js
//
// Cloud Function (Node 22, Gen 2) — the "kill switch" half of the
// hard billing cap (D38).
//
// Architecture:
//
//     Cloud Billing Budget (configured at $60/mo)
//         │
//         ▼  Pub/Sub message every time the budget is re-evaluated
//             (multiple times per hour). Payload includes the current
//             cost vs. budget, threshold breaches, currency, etc.
//         │
//     Pub/Sub topic `billing-budget-alerts`
//         │
//         ▼  Push subscription invokes this function via OIDC.
//         │
//     This function:
//         1. Decodes the budget alert payload.
//         2. Compares `costAmount` against `budgetAmount`.
//         3. If `costAmount >= budgetAmount * KILL_RATIO` (default
//            100 %) → calls Cloud Billing API to UNLINK the project
//            from its billing account.
//         4. Unlinked project → Cloud Run + KMS + Pub/Sub etc.
//            stop billable usage. Site goes dark.
//
// Why a Cloud Function (vs. a script in CI):
//   * Budget Pub/Sub messages arrive within seconds of the cost
//     threshold being crossed. A daily GH Actions cron would miss the
//     window completely.
//   * The function is idempotent — if the project is already
//     unlinked, the API call returns a no-op-equivalent.
//
// SAFETY:
//   * `KILL_RATIO` env var defaults to 1.0 (100 %). Set lower to test
//     the kill path against a cheap budget (e.g. 0.95 = trigger at
//     95 %).
//   * `DRY_RUN=true` env logs what WOULD happen without unlinking.
//     Recommended for the first 24 h after deploy to confirm the
//     plumbing.
//
// AUTH:
//   * Runtime SA needs `roles/billing.projectManager` on the BILLING
//     ACCOUNT (not the project). Granted by the founder during setup.
//
// PRIVACY: zero user data. The function only sees billing metadata
// (project ID, cost amount, currency) — no PII, no mail data.

import { CloudBillingClient } from '@google-cloud/billing';

const PROJECT_ID = process.env.PROJECT_ID;
const KILL_RATIO = Number.parseFloat(process.env.KILL_RATIO ?? '1.0');
const DRY_RUN = process.env.DRY_RUN === 'true';

if (!PROJECT_ID) {
  throw new Error('PROJECT_ID env not set — refusing to start');
}

const billing = new CloudBillingClient();

/**
 * Pub/Sub-triggered entry point.
 *
 * The CloudEvent's `data` is base64-encoded JSON matching Cloud
 * Billing's BudgetAlertNotification schema.
 */
export async function onBudgetAlert(cloudEvent) {
  const raw = cloudEvent.data?.message?.data;
  if (!raw) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        kind: 'billing_cap.no_message_data',
        message: 'Pub/Sub envelope had no data — ignoring',
      }),
    );
    return;
  }

  const payload = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
  const {
    budgetDisplayName,
    costAmount,
    budgetAmount,
    currencyCode,
    alertThresholdExceeded,
  } = payload;

  const ratio = budgetAmount > 0 ? costAmount / budgetAmount : 0;

  console.log(
    JSON.stringify({
      level: 'info',
      kind: 'billing_cap.evaluation',
      budgetDisplayName,
      costAmount,
      budgetAmount,
      currencyCode,
      alertThresholdExceeded,
      ratio,
      killRatio: KILL_RATIO,
      dryRun: DRY_RUN,
      willKill: ratio >= KILL_RATIO,
    }),
  );

  if (ratio < KILL_RATIO) {
    // Below kill threshold — nothing to do. The Cloud Billing budget
    // alerts also email the founder so the soft notification still
    // fires.
    return;
  }

  if (DRY_RUN) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        kind: 'billing_cap.dry_run',
        message: `Would unlink billing for ${PROJECT_ID} (cost ${costAmount}/${budgetAmount} ${currencyCode}) — dry-run gate ON.`,
      }),
    );
    return;
  }

  // Real kill path. Idempotent: if the project is already unlinked,
  // the API returns a project with `billingAccountName=''` and no
  // change is made.
  const [project] = await billing.updateProjectBillingInfo({
    name: `projects/${PROJECT_ID}`,
    projectBillingInfo: { billingAccountName: '' },
  });

  console.error(
    JSON.stringify({
      level: 'error',
      kind: 'billing_cap.unlinked',
      projectId: PROJECT_ID,
      costAmount,
      budgetAmount,
      currencyCode,
      result: project,
      message:
        'BILLING UNLINKED — Cloud Run / KMS / Pub/Sub will stop billable usage. Re-link manually via gcloud or GCP console after the cause is resolved.',
    }),
  );
}
