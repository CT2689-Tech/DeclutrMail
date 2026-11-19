### 2026-07-27 — Test the one-click unsubscribe in our own emails, in real Gmail

**Source:** FOUNDER-FOLLOWUPS.md (root, deleted 2026-11-19; read with `git show cb785809:FOUNDER-FOLLOWUPS.md`), entry dated 2026-07-27.
**Why:** Our emails carry `List-Unsubscribe` and `List-Unsubscribe-Post`, so a user can stop them in one click. The secrets and the `email-smoke` workflow work (green runs on 2026-07-28). Nobody has yet clicked the link in a real inbox and seen the preference change.
**How:**
1. Supabase SQL editor, production: `SELECT id FROM users WHERE email = '<your sign-in address>';`
2. GitHub → Actions → "Email smoke (Resend)" → Run workflow → paste that id into `unsubscribe_user_id`.
3. In Gmail, open the email. If Gmail shows Unsubscribe next to the sender, click it; if not, use Show original to confirm both headers are there.
4. SQL: `SELECT preferences->'emailPrefs' FROM users WHERE id = '<id>';`
5. Turn that email back on in Settings.
**Verifies by:** step 4 shows the clicked category as `false`.
**Who:** Founder
**Status:** Open
