### 2026-08-26 — Smoke the preview-placement setting and verify D34

**Source:** FOUNDER-FOLLOWUPS.md (root, deleted 2026-11-19; read with `git show cb785809:FOUNDER-FOLLOWUPS.md`), entry dated 2026-08-26.
**Why:** D34 (a per-verb choice in Settings for where the action preview opens) is still 🔵. Its unit test passes, but nobody has watched the setting round-trip through the real Settings card and Guided Review.
**How:**
1. Start the API, worker and web app and sign in with the dev login (CLAUDE.md §8.7).
2. Settings → Previews → set Archive to "On the page".
3. In Guided Review, Archive a sender: the preview opens on the page, not in a pop-up.
4. Reload Settings: the choice is still "On the page". Set it back to "Pop-up".
5. `pnpm verify-d D34 --observed "dev-login: set Archive preview to On the page in Settings, Guided Review showed it inline, survived reload, set back"`
**Verifies by:** D34 reads 🟢 in `IMPLEMENTATION-LOG.md` with that observation.
**Who:** Engineering (an agent can do it)
**Status:** Open
