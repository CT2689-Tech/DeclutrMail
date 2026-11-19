### 2026-08-25 — Create the billing-verdict alert and audit the billing API keys

**Source:** FOUNDER-FOLLOWUPS.md (root, deleted 2026-11-19; read with `git show cb785809:FOUNDER-FOLLOWUPS.md`), entry dated 2026-08-25.
**Why:** The code shipped, but the alert lives in GCP and must be created once. Without it a billing provider read can fail silently, as it did for 11 days before the 2026-08-25 refund lockout. That lockout came from one missing Paddle key permission; others may be missing on rarer endpoints.
**How:**
1. Run `./scripts/setup-billing-verdict-alert.sh` (idempotent; creates only what is missing).
2. Check in GCP Monitoring: `gcloud alpha monitoring policies list --project=declutrmail-ai-prod --format="value(displayName)"` lists "Billing: provider read blocked or refund verdict frozen".
3. Check in Paddle (Developer Tools > Authentication > API keys > Edit): compare the ticked permissions with every endpoint `apps/api/src/billing/paddle.adapter.ts` calls.
4. Do the same in Razorpay. New INR checkout is paused (ADR-0045), but cancellation and reconciliation still use the key.
5. Decide one gap: a provider that answers but leaves a refund `pending_approval` past 7 days logs `verdict_unsettled` and pages nobody. Recommended: accept it; the backstop screen sends the customer to support.
**Verifies by:** the policy is listed, a test log line delivers mail, and every adapter endpoint answers something other than 403 with the production key.
**Who:** Founder
**Status:** Open
