## 2026-09-26 — Simulate a client estimator against the producer's real pacing
**Context:** the sync gate's "about N min left", computed in the browser from worker batches seen by a 3s poll.
**Finding:** A reviewer's discrete-event simulation — the worker's token-bucket pacing, the Redis key's writes and TTL, the reader, TanStack's poll/hidden/focus rules — driving the real `observeScan`/`scanMsLeft` found 9 scenarios showing ≥2× wrong times (up to 25×) that 19 hand-written unit tests had passed. Each candidate fix could then be scored across every scenario at once, which is how the two-gap rule was chosen over a wire-level write id.
**Rule (provisional):** For any estimate a client derives from a producer's cadence, model the producer and the delivery loop and replay the real functions over stalls, retries, hides and skew before trusting the unit tests.
**Distillation trigger:** promote to CLAUDE.md §8 if a second estimator or rate-derived display ships.
