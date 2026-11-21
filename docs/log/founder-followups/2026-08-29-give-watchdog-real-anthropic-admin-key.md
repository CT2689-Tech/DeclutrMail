### 2026-08-29 — Give the vendor watchdog a real Anthropic Admin key

**Source:** FOUNDER-FOLLOWUPS.md (root, deleted 2026-11-19; read with `git show cb785809:FOUNDER-FOLLOWUPS.md`), entry dated 2026-08-29.
**Why:** The watchdog's Anthropic spend check runs, but the stored `ANTHROPIC_ADMIN_KEY` is not an Admin key, so it errors ("The Admin API requires an Admin API key"). Its acknowledgement in `scripts/known-vendor-issues.tsv` expired on 2026-10-26, so by that file's rules the daily run fails on this cause again. A run that is always red hides new failures, and LLM spend stays unwatched.
**How:**
1. Anthropic Console → Settings → Admin keys (needs the admin role). Create a key for the watchdog.
2. Run `gh secret set ANTHROPIC_ADMIN_KEY` and paste the key.
3. Run the `vendor-limits-watchdog` workflow by hand and read the Anthropic row.
4. If the Console offers no Admin keys for this account type, say so here; an agent then records that spend is checked by hand in Console → Cost and removes or re-acknowledges the check.
**Verifies by:** The Anthropic row shows a month-to-date dollar figure, or this entry records that the account cannot have an Admin key.
**Who:** Founder
**Status:** Open
