## 2026-10-03 — Dashboard shape checks accepted an unsupported distribution mean aligner

**PR:** [#856](https://github.com/CT2689-Tech/DeclutrMail/pull/856) introduced the action panels.
**Caught by:** Authenticated production dashboard check and the exact chart query's HTTP 400 response.
**What happened:** Action metrics were present but eight charts stayed blank. A review replaced approximate histogram percentiles with direct ALIGN_MEAN to preserve snapshot means. That aligner rejects DELTA/DISTRIBUTION. The test asserted the chosen query shape rather than validating it against the actual descriptor type. Initial independent review missed the incompatibility too.
**Correct approach:** Verify every aggregation stage against its input kind/value type, then execute the exact real query and inspect the authenticated shared dashboard. Preserve original series identity while converting distribution means to numbers before secondary numeric aggregation.
**Rule:** A dashboard configuration readback or shape assertion cannot establish chart usability; require descriptor-compatible stages, real query results and authenticated rendering.
**Enforcement update:** Descriptor-aware regression went red on the shipped chart. Weighted means/revision/zero/absence fixture and independent 672-point live parity check protect the correction. No broader agent-rule change in this follow-up.
