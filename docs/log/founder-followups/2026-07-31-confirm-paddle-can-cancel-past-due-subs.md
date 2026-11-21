### 2026-07-31 — Confirm Paddle can cancel a past-due subscription, and alert if not

**Source:** FOUNDER-FOLLOWUPS.md (root, deleted 2026-11-19; read with `git show cb785809:FOUNDER-FOLLOWUPS.md`), entry dated 2026-07-31.
**Why:** The first gap is closed: refund and chargeback verdicts are now enforced every 10 minutes (`packages/workers/src/billing-verdict.queue.ts:32`). The second is still open. A Codex review reported that Paddle refuses changes to a `past_due` subscription. If so, a refund on a subscription in dunning can never be cancelled, and if the payment later recovers, Paddle bills the refunded customer. Each failure only logs `billing.reconcile.verdict_enforce_failed` (`apps/api/src/billing/billing-reconciliation.service.ts:1152`), which no alert matches (`scripts/setup-billing-verdict-alert.sh:63`).
**How:**
1. Look up in Paddle's API docs whether a `past_due` subscription can be cancelled, and record the link and date here. If the docs do not say, ask the founder to ask Paddle support.
2. If Paddle refuses, propose how to handle `past_due` rows (billing is Tier 1: the founder approves before you build).
3. Add `verdict_enforce_failed` to the log filter in `scripts/setup-billing-verdict-alert.sh`, then ask the founder to re-run the script.
**Verifies by:** This entry records a sourced answer, a test covers the `past_due` path, and the alert policy filter includes `verdict_enforce_failed`.
**Who:** Engineering (an agent can do it)
**Status:** Open
