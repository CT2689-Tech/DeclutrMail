## 2026-10-25 — Home derived reads need terminal refresh and complete scope

**PR:** Home Action overview change (linked from its execution record).
**Caught by:** independent frontend/flow/design review before merge.
**What happened:** New optional caches initially refreshed at enqueue success only; Automation state counted only preset rules; an empty shortlist could give returning users first-cleanup copy; a static scan fill implied measured progress.
**Correct approach:** Observe the existing terminal Activity invalidations without joining optional reads to Undo's latch; include both rule libraries; distinguish empty history from empty candidates; remove fabricated scan progress.
**Rule:** A derived overview must share its owning features' scope and terminal refresh signal.
**Enforcement update:** Held-read terminal-refresh, combined-rule, zero-Inbox returning-user regressions; existing scan/hydration checks retained.
