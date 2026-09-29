## 2026-09-26 — `bool_and` over a comparison with a NULL column ignored the row

**PR:** pending (worktree `upbeat-wiles-416cdd`)
**Caught by:** flow-completeness-auditor, confirmed with a PGlite probe
**What happened:** The undo list counted a sender as "Protected sender skipped" when `bool_and(m.status = 'done' and m.error_code = 'LABEL_SENDER_PROTECTED')` held over its jobs. A job that ran has `error_code` NULL, so its comparison is NULL, and `bool_and` skips NULLs: a composite sender whose primary moved mail and whose secondary was skipped read as wholly skipped, on the same Undo line that counted its moved mail. The batch status excluded that sender, so two reads of one fact disagreed.
**Correct approach:** `m.error_code is not distinct from …`, so a NULL compares false.
**Rule:** Inside `bool_and` / `bool_or` / `every`, compare nullable columns NULL-safely; an aggregate that skips NULL turns "unknown" into "true".
**Enforcement update:** undo.service spec for the same-sender mixed case, red before the fix.
