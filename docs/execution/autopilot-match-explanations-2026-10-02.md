# Recorded Autopilot match explanations

Current preset producers in packages/workers/src/autopilot-presets.ts emit engine
verdict/threshold strings, abbreviated new-sender ages, and dormancy read-rate
strings. Old development fixtures also contain unsupported machine-key formats.

One display-only helper now serves pending suggestions and read-only rule samples.
Known producers show plain recorded-time explanations; all ages say At matching
rather than masquerading as current observations. Confidence numbers remain in
closed technical details, with no probability claim. Equal rounded numbers retain
the recorded matcher decision: comparison occurs before formatting to two decimals.

Dormancy shows the recorded indexed-email count and last-seen age. Its original
rate remains inspectable with a caveat: the timeseries numerator can exclude mail
marked read by other tools, so it does not prove reading or equal raw Gmail READ
flags. Unknown/legacy/invalid formats retain their exact escaped diagnostic text
without guessing units, window or eligibility. Missing text stays unavailable.

Phone rule samples stack identity and explanation, using the existing 600px
breakpoint; desktop alignment remains. No worker, thresholds, database, API,
permissions, Gmail mutation or telemetry collection changes. Relates to D245;
ADR-0042 governs the existing tokens and primitives.

Root owns the helper/component/contracts/story and pending row/rule sample.
Pending row is also changed by merged PR860 (match date); changes are separate
lines, same integration owner, no semantic dependency. Based on main76d23446;
normal merge queue must verify combined source. Rollback: revert, no migration.

Full repository typecheck/lint pass (six existing warnings). Relevant 97 web tests
passed after recorded-time and adjusted-rate corrections; final18 contracts passed
including the rounding regression. Final web typecheck and targeted lint pass.
Independent reviewer cleared semantics, privacy, fallback and disclosure behavior.
Synthetic Storybook desktop and390x844 verified pending and sample contexts, native
keyboard disclosure with visible focus, no selection/mutation and no horizontal
overflow. The mobile sample layout correction was inspected in the same preview.
Required production build/bundle/accessibility CI and live UI verification pending.
No real mailbox or consented analytics changed.
