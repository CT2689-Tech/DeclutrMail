## 2026-10-02 — Include recovery and keyboard states in preview audits
**PR:** Cleanup flow audit, branch `codex/flow-audit-cleanup` (D226 follow-up).
**Caught by:** Independent flow reviewer and synthetic browser smoke.
**What happened:** Initial fixes covered normal cleanup previews but missed Activity retry identity. Browser smoke then showed that loading primary buttons could leave focus behind the dialog. Excluding a disabled primary alone still allowed the focus trap to target links inside closed Details when no earlier visible control existed.
**Correct approach:** Sweep normal, recovery, loading, zero-count and disclosure states. Verify real browser focus, not only dialog presence; explicitly prefer enabled Cancel when confirmation is disabled and keep hidden disclosure descendants out of the focus cycle.
**Rule:** A modal is not keyboard-safe merely because a focus-trap hook is installed.
**Enforcement update:** Added visible account recovery coverage and four PreviewSheet keyboard regressions, plus the flow-audit runbook's recovery and accessibility checks.
