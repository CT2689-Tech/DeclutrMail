## 2026-10-24 — D173's "mobile reuses shared hooks" premise did not survive
**Context:** Scoping a native iOS/Android prototype; D173 estimated 3–5 dev days to add a React Native app that consumes `packages/shared/hooks`.
**Finding:** `packages/shared/src/hooks` holds six UI hooks only. The 69 data hooks and the API client are in `apps/web` (the client reads `document.cookie`), and 162 of 502 feature files touch `next/*` or DOM globals. The discipline D173 imposed was not followed, so the estimate no longer describes the code.
**Rule (provisional):** Re-measure before quoting a plan estimate that rests on a code-layout promise. For mobile, size it from the web app's actual coupling, not from D173.
**Distillation trigger:** "promote to CLAUDE.md §4 if a plan estimate is found stale against the code ≥3 times"
