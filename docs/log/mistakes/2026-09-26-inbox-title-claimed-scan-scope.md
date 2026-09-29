## 2026-09-26 — A new count sat under "Reading your inbox…" and so claimed an inbox the scan does not read
**PR:** TBD (feat/d109-sync-gate-progress-count)
**Caught by:** usability-editor, round 2 [BLOCKING]
**What happened:** "12,400 of 40,898 emails" counts all mail but Spam and Trash; the title, the progress bar's label and the failure titles said "inbox". Elsewhere the product uses "in your inbox" for the Inbox only, and the ready email already calls the same number "scanned from" the address. Round 1 kept "inbox" as local convention — the convention predated any number beside it.
**Correct approach:** "Reading your Gmail…" (Home's syncing title too), and "the scan" for the scan's own strings.
**Rule:** When a surface gains a number, re-read every word around it for scope: an old label becomes a claim once a count sits under it.
**Enforcement update:** gate, page and Home tests pin "Gmail".
