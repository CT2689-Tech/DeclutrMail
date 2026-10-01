## 2026-10-01 — Include work-count plan regressions in performance checks

**PR:** `codex/sender-meta-performance` candidate.
**Caught by:** Independent architecture/correctness gate.
**What happened:** The full read-service suite passed, but an adjacent current-mail plan test still expected four default statements after removal of the redundant count.
**Correct approach:** Assert three default statements and retain a separate filtered-count scenario with different matching and absolute totals; verify index coverage on both paths.
**Rule:** When eliminating a query, search and run existing query-plan and statement-count regressions as well as the service suite.
**Enforcement update:** Expanded the affected test selection; no CI gate bypass.
