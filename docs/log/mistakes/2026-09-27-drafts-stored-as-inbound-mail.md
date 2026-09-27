## 2026-09-27 — Drafts and chat lines were stored as inbound mail
**PR:** #791 (https://github.com/CT2689-Tech/DeclutrMail/pull/791)
**Caught by:** manual test (found while fixing the Gmail-category fallback, 2026-09-26)
**What happened:** Both sync workers set `is_outbound` from the SENT label alone and stored every message Gmail listed. A draft carries only DRAFT, so the user's own unsent drafts were stored as mail sent *to* them *by* them: a sender row for the mailbox owner, scored Keep at 95%, and two drafts in the Reply section of LLM-composed Briefs (subject and preview sent to the model). Saved Hangouts/Chat lines counted as email the same way — 790 rows and 23 chat-only senders on the founder's dev mailbox. ~30 readers of `is_outbound`/labels inherited the error.
**Correct approach:** Decide at ingest what counts as mail before deriving direction from it, and enumerate the labels that mark a non-mail item (DRAFT, CHAT) in one shared place (`NON_MAIL_LABELS` in `packages/db/src/predicates.ts`).
**Rule:** Any classification derived from Gmail labels must name what it does with DRAFT and CHAT; a message Gmail lists is not necessarily mail.
**Enforcement update:** none (ingest tests pin DRAFT/CHAT skipping; the purge test pins the cleanup)
