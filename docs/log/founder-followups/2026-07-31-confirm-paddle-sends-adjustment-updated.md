### 2026-07-31 — Confirm Paddle sends `adjustment.updated` to production

**Source:** FOUNDER-FOLLOWUPS.md (root, deleted 2026-11-19; read with `git show cb785809:FOUNDER-FOLLOWUPS.md`), entry dated 2026-07-31.
**Why:** On a live account Paddle approves or rejects most refunds later, through `adjustment.updated`. The adapter now handles that event, so the subscription is all that is missing; without it we rely on the slower reconciliation sweep. The watchdog that would catch a missing event needs a read-only Paddle key that the 2026-11-17 snapshot does not list.
**How:**
1. Check in the Paddle dashboard → Developer tools → Notifications → the production destination. Add `adjustment.updated` to its events if missing.
2. Create a Paddle API key with only `notification_setting.read`. Run `gh secret set PADDLE_WATCHDOG_API_KEY`, and set the repo variable `PADDLE_WATCHDOG_KEY_EXPIRES_ON` to its expiry date (YYYY-MM-DD).
3. Run the `vendor-limits-watchdog` workflow and read the "Paddle (webhooks)" row.
**Verifies by:** The "Paddle (webhooks)" row is OK; it names `adjustment.updated` if that event is missing.
**Who:** Founder
**Status:** Open
