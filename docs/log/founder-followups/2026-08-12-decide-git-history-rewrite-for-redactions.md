### 2026-08-12 — Decide whether to rewrite git history for redacted personal data

**Source:** FOUNDER-FOLLOWUPS.md (root, deleted 2026-11-19; read with `git show cb785809:FOUNDER-FOLLOWUPS.md`), entries dated 2026-08-12 and 2026-09-26.
**Why:** The repo is public. A beta user's email address, a full name, a relative's first name and two signups' email addresses were removed from the working tree (2026-08-12 and 2026-09-26), but older commits still hold them. The signups' mailbox ids and failure dates are also public (`scripts/known-stuck-mailboxes.tsv`), so a reader can link an address to a failed first scan. `docs/adr/0022-postgres-supabase-pre-launch.md:45` still publishes the production database project ref.
**How:**
1. Pick one: (a) accept redaction at HEAD (the 2026-08-12 recommendation: the repo was already public, and a rewrite forces every open PR to rebase), (b) rewrite history, or (c) make the repository private.
2. For (b): rewrite with `git filter-repo --replace-text`, force-push `main` yourself (agents never force-push `main`), then ask GitHub Support to clear cached views and old pull-request refs.
3. Decide whether an agent should replace the project ref in ADR-0022 with a placeholder.
4. Record the answers on this entry's Status line.
**Verifies by:** this entry's Status line; for (b), `git log --all -p -S '<address>'` finds nothing in a fresh clone.
**Who:** Founder
**Status:** Open
