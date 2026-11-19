### 2026-09-21 — Check five past checkouts in the Paddle and Razorpay dashboards

**Source:** FOUNDER-FOLLOWUPS.md (root, deleted 2026-11-19; read with `git show cb785809:FOUNDER-FOLLOWUPS.md`), entry dated 2026-09-21.
**Why:** PostHog recorded five `checkout_started` events, the last on 2026-08-15, and no matching billing events. Only the provider dashboards can say whether any of those people paid. If someone paid and never got their plan, we owe them a fix or a refund.
**How:**
1. Paddle (live account) → Transactions and Customers: look near 2026-06-12, 2026-07-31, 2026-08-12 and 2026-08-15. Note each transaction's status.
2. Razorpay → Subscriptions and Payments: look near 2026-07-31 07:15 UTC.
3. For any completed payment, check whether that workspace has a matching `subscriptions` row and the plan it paid for.
4. Write one line per date on this entry: no checkout, abandoned, paid and granted, or paid and not granted.
**Verifies by:** This entry gives a result for every date, and any "paid and not granted" case is fixed or refunded.
**Who:** Founder
**Status:** Open
