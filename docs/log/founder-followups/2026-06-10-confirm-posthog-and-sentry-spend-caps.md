### 2026-06-10 — Confirm PostHog and Sentry cannot run up a bill

**Source:** FOUNDER-FOLLOWUPS.md (root, deleted 2026-11-19; read with `git show cb785809:FOUNDER-FOLLOWUPS.md`), entry dated 2026-06-10.
**Why:** A vendor with no cap turns a runaway loop into open-ended spend. Vercel's cap was confirmed on 2026-08-29. On that date PostHog was free with no card and Sentry was on its free plan, so neither could bill (`docs/runbooks/billing-guardrails.md`, "Current known limits"). If either now has a card on file, it needs its own cap.
**How:**
1. Check in PostHog → Organization → Billing. If a card is on file, set a billing limit on each paid product.
2. Check in Sentry → Settings → Subscription. If it is paid, set the on-demand budget to $0 and confirm Spike Protection is on.
3. An agent updates the "Current known limits" table with what you saw and the date.
**Verifies by:** each billing page shows either a free plan with no card, or a limit that is set.
**Who:** Founder
**Status:** Open
