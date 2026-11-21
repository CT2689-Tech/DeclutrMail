### 2026-09-26 — Check that the stuck-mailbox alert pages once per mailbox

**Source:** FOUNDER-FOLLOWUPS.md (root, deleted 2026-11-19; read with `git show cb785809:FOUNDER-FOLLOWUPS.md`), entry dated 2026-09-26.
**Why:** The repo defines one alert per stuck mailbox, but Cloud Monitoring changes only when the setup script runs with `--apply`. If it never ran, one old open alert hides every newly stuck mailbox. The starve test already passed on 2026-09-27; only the apply is unconfirmed.
**How:**
1. Check in GCP Cloud Monitoring → Alerting → policy "Mailbox stuck: broken past grace window, unnoticed". If its condition groups by `mailbox_account_id` and `reason`, mark this Done.
2. If not: `gcloud auth login` with the admin Google account, then run `node scripts/setup-stuck-mailbox-alert.mjs declutrmail-ai-prod` and read the plan.
3. Run the same command with `--apply`. Expect one email per mailbox stuck at that moment; acknowledge each in Alerting.
**Verifies by:** The policy groups by mailbox and reason, and its alert subjects name the mailbox.
**Who:** Founder
**Status:** Open
