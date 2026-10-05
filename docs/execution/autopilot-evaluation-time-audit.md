# Autopilot evaluation time

User intent: confirm whether configured rules have evaluated recently.
Entry: Automations → Autopilot → one rule’s Details. Eligibility and mutations
stay under the existing Autopilot plan/permission contract.

Before: Last run showed a month/day only, making a fresh run and an hours-old
run indistinguishable. Source-confirmed data: the worker persists lastRunAt
with match and distinct-sender counts after its rule evaluation. This timestamp
is not a Gmail delivery receipt, completion timestamp or next-run schedule.

After: Details exposes a semantic time element with date, year, hour/minute
and the viewer’s local timezone label. Server and first client render retain
stable recorded-time copy; localization occurs after mount using the existing
hydration-safe clock. Missing timestamps retain Hasn’t run yet; malformed values
say Evaluation time unavailable rather than displaying raw input. Match counts
retain their existing meaning in Observe/Active, disabled and paused states.

Verification criteria: expand/collapse Details by keyboard, reload/remount,
valid/missing/malformed dates, deterministic server markup and narrow-screen
wrapping. No toggle, approval, preview, scheduler, API, schema, Gmail or analytics
change. Synthetic browser evidence is separate from production readback.

Ownership: core functional audit and integration; independent review required.
No dependency on the Brief availability patch. Larger skip-reason/next-run and
provider completion surfaces remain separate because their facts are not
represented by lastRunAt.

Local verification: 160 affected Autopilot tests and 84 final screen cases passed;
all three freshness regressions fail against the old component and pass after
restoring the candidate. Full workspace typecheck/lint pass (six existing lint
warnings), touched formatting and production web build/51-route bundle budget
pass. Independent source/design/React/privacy review clear. Synthetic Storybook
keyboard expansion/collapse and reload verified; phone document/client widths
match at 380 pixels under the responsive override, with readable wrapping.
No account configuration changes or new data collection. Source-ready evidence
only; PR/queue/deployment/production verification require separate readback.
