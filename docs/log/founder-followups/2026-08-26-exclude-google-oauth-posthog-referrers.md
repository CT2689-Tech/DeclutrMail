### 2026-08-26 — Stop PostHog counting Google sign-in as a referrer

**Source:** FOUNDER-FOLLOWUPS.md (root, deleted 2026-11-19; read with `git show cb785809:FOUNDER-FOLLOWUPS.md`), entry dated 2026-08-26.
**Why:** We keep each signup's first-touch `ref` in Postgres across Google sign-in. PostHog, though, sees `accounts.google.com` as the referrer, so every signup looks like it came from Google. This undermines the channel numbers the launch relies on.
**How:**
1. PostHog → the DeclutrMail production project → Project settings → Web analytics (or the referring-domain / internal-traffic filters).
2. Exclude these referring domains: `accounts.google.com`, `declutrmail.com`, `www.declutrmail.com`, `app.declutrmail.com`, `localhost`.
3. Save the settings.
**Verifies by:** For a test signup that starts at `https://declutrmail.com/inbox-simulator?ref=hn` and goes through Google, PostHog shows `$initial_referring_domain` as `declutrmail.com` or empty, and that user's `signup_attribution_ref` in Postgres is `hn`.
**Who:** Founder
**Status:** Open
