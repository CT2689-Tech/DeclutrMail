# Billing hard cap — kill-switch Cloud Function

The catastrophic-spend safety net for `declutrmail-ai-prod`. A Cloud
Billing budget posts to a Pub/Sub topic on every re-evaluation; this
function reads the message, and if cost has crossed the kill ratio,
unlinks the project from its billing account. Cloud Run, KMS, Pub/Sub,
etc. all stop billable usage. The site goes dark. Better than a $5k
3 a.m. surprise.

## What it is NOT

This is the **last-resort** layer.

1. **Soft layer (already wired):** $30/mo budget ALERT — emails the
   founder at 50/90/100 %. The email is observability, not enforcement.
   Caps will still keep growing if the founder is asleep.
2. **Hard layer (this code):** budget kill at $60. The function
   triggers within seconds of cost crossing the threshold.

The two layers work together: the email warns you something is
wrong; the kill-switch stops the bleeding if the warning is missed.

## Setup (one-time, founder action)

### Step 1 — Create the Pub/Sub topic

```bash
gcloud pubsub topics create billing-budget-alerts \
  --project=declutrmail-ai-prod
```

### Step 2 — Create the Cloud Billing budget

GCP Console → Billing → Budgets & alerts → CREATE BUDGET.

- **Name:** `declutrmail-ai-prod-hard-cap`
- **Scope:** project `declutrmail-ai-prod`
- **Amount type:** Specified amount
- **Amount:** `60` USD
- **Threshold rules:** add `50%`, `90%`, `100%` actual spend
  (these fire the soft email — the same address you already get the
  $30 alerts on).
- **Manage notifications → Connect a Pub/Sub topic:**
  `billing-budget-alerts` in `declutrmail-ai-prod`.

(Note: the budget MUST be configured under the BILLING ACCOUNT
section, not under the project. Cloud Billing scopes budgets per
billing account.)

### Step 3 — Grant the runtime SA billing-manager on the billing account

The Cloud Function runs as a runtime SA. To unlink the project, that
SA needs `roles/billing.projectManager` on the BILLING ACCOUNT (NOT
the project — billing roles live at the org/billing-account level).

```bash
# Replace BILLING_ACCOUNT_ID with the founder's billing account
# (visible in GCP Console → Billing → Account Management; format:
# 01E2BA-A53600-B12546).
gcloud beta billing accounts add-iam-policy-binding 01E2BA-A53600-B12546 \
  --member=serviceAccount:billing-hard-cap@declutrmail-ai-prod.iam.gserviceaccount.com \
  --role=roles/billing.projectManager
```

### Step 4 — Create the runtime SA

```bash
gcloud iam service-accounts create billing-hard-cap \
  --project=declutrmail-ai-prod \
  --display-name='Billing hard-cap kill-switch'
```

### Step 5 — Deploy the function (DRY-RUN first)

```bash
cd infra/billing-hard-cap
gcloud functions deploy billing-hard-cap \
  --gen2 \
  --runtime=nodejs22 \
  --region=us-central1 \
  --project=declutrmail-ai-prod \
  --source=. \
  --entry-point=onBudgetAlert \
  --trigger-topic=billing-budget-alerts \
  --service-account=billing-hard-cap@declutrmail-ai-prod.iam.gserviceaccount.com \
  --set-env-vars=PROJECT_ID=declutrmail-ai-prod,KILL_RATIO=1.0,DRY_RUN=true
```

Wait 24 hours. Watch the function's Cloud Logging output for
`billing_cap.evaluation` lines. Each budget re-evaluation will log
one entry with the ratio + `dryRun=true`. Confirm the math looks
right.

### Step 6 — Flip DRY_RUN off

```bash
gcloud functions deploy billing-hard-cap \
  --gen2 \
  --runtime=nodejs22 \
  --region=us-central1 \
  --project=declutrmail-ai-prod \
  --source=. \
  --entry-point=onBudgetAlert \
  --trigger-topic=billing-budget-alerts \
  --service-account=billing-hard-cap@declutrmail-ai-prod.iam.gserviceaccount.com \
  --set-env-vars=PROJECT_ID=declutrmail-ai-prod,KILL_RATIO=1.0
```

(Note: omit `DRY_RUN` so it defaults to disabled. The kill path is now
armed.)

## Recovery — if the kill switch fires

Cloud Run, KMS, Pub/Sub, etc. will return errors until billing is
re-linked.

1. Diagnose the cost spike (Cloud Billing → Reports → Cost breakdown
   by service).
2. Re-link the project:
   ```bash
   gcloud beta billing projects link declutrmail-ai-prod \
     --billing-account=01E2BA-A53600-B12546
   ```
3. Bump the budget if it was a legitimate spike.
4. If a runaway worker / Cloud Function caused the spike, redeploy
   with the bug fixed before re-linking.

## Tuning

- `KILL_RATIO=1.0` — default. Triggers when cost ≥ budget.
- `KILL_RATIO=0.95` — early kill at 95 % of budget. Useful for testing
  the kill path against a $1 budget without paying the full $60.
- `KILL_RATIO=2.0` — DISABLES the kill (cost can never reach 200 % of
  the budget; the function logs evaluations but never unlinks). Use
  to temporarily disable while debugging.

## Privacy / D7 / D228

Zero user data. The function only sees billing metadata (project ID,
cost amount, currency). No PII, no mail data.
