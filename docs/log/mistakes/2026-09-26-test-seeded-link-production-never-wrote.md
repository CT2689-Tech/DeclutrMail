## 2026-09-26 — A test seeded the link that production never wrote

**PR:** pending (worktree `upbeat-wiles-416cdd`)
**Caught by:** adversarial review of the Activity skip rows
**What happened:** Activity renders a bulk Unsubscribe refused as Protected from the intent row's `actionJobId`. The bulk path and Autopilot inserted the intent row without it, so in production that branch never matched and the refusal fell through to the generic row. The spec passed because its fixture inserted the intent row WITH `actionJobId`, asserting the join the code never made.
**Correct approach:** Link the intent row to its job where the job is created (bulk and Autopilot), and test through the producer, not a hand-seeded row.
**Rule:** A fixture must not write a column the producer under test is responsible for writing; seed through the producer or assert the producer writes it.
**Enforcement update:** actions.service and Autopilot specs assert the link on the producer's own rows.
