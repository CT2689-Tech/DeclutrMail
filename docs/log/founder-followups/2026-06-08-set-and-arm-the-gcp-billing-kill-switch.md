### 2026-06-08 — Choose the GCP spend kill-switch amount, then arm it

**Source:** FOUNDER-FOLLOWUPS.md (root, deleted 2026-11-19; read with `git show cb785809:FOUNDER-FOLLOWUPS.md`), entry dated 2026-06-08.
**Why:** GCP budgets only send email; nothing stops spend. A stuck job or a leaked key could run up a large bill before anyone reads the alert. The kill switch is written (`infra/billing-hard-cap/`) but not set up. When it trips, it unlinks billing and the whole product goes offline.
**How:**
1. Pick the amount, well above normal spend. Spend was $91.42 month-to-date on 2026-09-28, so the old $60 would have taken production down. Check in GCP Billing → Reports for this month's rate.
2. Follow `infra/billing-hard-cap/README.md` steps 1–6 with that amount, keeping the 24-hour dry run (step 5) before arming (step 6).
3. An agent writes the amount and date into `docs/runbooks/billing-guardrails.md`.
**Verifies by:** the function logs `billing_cap.evaluation` lines, then runs without `DRY_RUN`, and GCP Billing → Budgets shows the budget wired to `billing-budget-alerts`.
**Who:** Founder
**Status:** Open
