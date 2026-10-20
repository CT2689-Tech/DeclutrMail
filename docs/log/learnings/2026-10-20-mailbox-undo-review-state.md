## 2026-10-20 — Mailbox restoration and review restoration are separate

**Context:** Bounded live cleanup verification with exact Gmail-label baselines and normal Activity Undo.

**Finding:** Screener Archive Undo restored both tested messages’ exact provider labels and neutral sender policy/timer state, while the sender stayed marked reviewed. Current quarantine and score-worker code deliberately preserves a completed first review. A restored Gmail Inbox is therefore not proof that every application workflow state returned to its baseline.

**Rule (provisional):** Before claiming a live test is fully restored, reconcile provider labels, mirrored counts, standing policy, timers, Activity and any review/queue bookkeeping. Record intentional state left behind instead of resetting production rows silently.

**Distillation trigger:** Promote to CLAUDE.md smoke guidance if this distinction recurs at least three times.
