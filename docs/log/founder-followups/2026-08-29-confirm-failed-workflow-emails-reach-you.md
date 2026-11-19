### 2026-08-29 — Make sure failed watchdog runs email an inbox you read

**Source:** FOUNDER-FOLLOWUPS.md (root, deleted 2026-11-19; read with `git show cb785809:FOUNDER-FOLLOWUPS.md`), entry dated 2026-08-29.
**Why:** The sync-stuck, vendor-limits and cron-stale watchdogs alert you only through GitHub's "failed workflow" email. GitHub sends it to the account that last edited each workflow's `cron:` line (`.github/workflows/vendor-limits-watchdog.yml:5-8`). On 2026-09-26 no such email had arrived in 40 days, even though `sync-stuck-watchdog` had failed 155 runs in a row. So these alerts may never reach you.
**How:**
1. On GitHub, open `.github/workflows/sync-stuck-watchdog.yml`, `vendor-limits-watchdog.yml` and `cron-stale-watchdog.yml`, click History, and note which account last changed the `cron:` line.
2. Signed in as that account: github.com → Settings → Notifications → Actions. Turn on email for failed workflows and send it to an address you read.
3. Check that address's filters for mail from `notifications@github.com`.
**Verifies by:** The next failed scheduled run in the Actions tab arrives as an email in your inbox.
**Who:** Founder
**Status:** Open
