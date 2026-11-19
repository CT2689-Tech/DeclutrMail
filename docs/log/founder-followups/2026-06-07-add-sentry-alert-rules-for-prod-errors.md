### 2026-06-07 — Add Sentry alert rules for production errors

**Source:** FOUNDER-FOLLOWUPS.md (root, deleted 2026-11-19; read with `git show cb785809:FOUNDER-FOLLOWUPS.md`), entry dated 2026-06-07.
**Why:** Errors reach Sentry, but no file in the repo shows a Sentry rule that emails anyone. A spike of production errors stays unseen until someone opens the dashboard.
**How:**
1. Check in Sentry → Alerts. If production rules like the ones below exist, mark this Done.
2. Otherwise create an Issue Alert: environment `production`, level error or higher, more than 10 events in 5 minutes, action: email.
3. Create a second rule for level `fatal` that alerts on the first event.
**Verifies by:** Both rules are listed under Sentry → Alerts, and a test notification from the rule reaches the inbox.
**Who:** Founder
**Status:** Open
