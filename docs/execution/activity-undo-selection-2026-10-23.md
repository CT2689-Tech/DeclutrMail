# Activity bulk Undo selection

## Flow and ownership

The requested correction is limited to Activity selection: show checkboxes only
for undoable actions, explain bulk Undo, and keep checkboxes separate from sender
logos. This chat owns the Activity component, its tests/stories and an isolated
browser fixture. The branch is `codex/activity-undo-selection`, based on
`726ac77e3`; no other open PR claimed these files at the initial check.

The flow is eligible action -> select -> selected action count -> bulk Undo ->
pending -> terminal result/recovery. Already-undone, expired, unavailable and
currently-reversing actions are not selectable. Refreshed eligibility removes
stale selections, while an in-flight batch preserves its receipt until settled.
An individual row's Undo and existing partial-failure recovery remain available.

Billing, account configuration, provider permissions and actual Gmail mutations
are outside this UI correction's verification scope.

## Changes

- Eligible rows have a visible native checkbox in a separate layout cell before
  the sender logo. The mobile label has a 44px touch target.
- The list explains “Select actions to undo together.” Selected counts and the
  button use “actions” and “Undo N actions” rather than unexplained row counts.
- Checkbox accessible names include sender, action and occurrence time, and
  reference the list's selection hint.
- One screen-level mutation subscription and clock determine eligibility for
  both timeline and grouped views. No network request is added.
- During bulk Undo, remaining selection controls and Clear are disabled. Partial
  failures preserve the existing per-row retry feedback.
- On compact screens, the timestamp and controls sit below the sender line;
  the result uses the card width rather than a narrow indent under the logo.
- The browser fixture contains fictional accounts and blocks fetch entirely.

## Verification

The complete Activity suite passed 126 tests after the desktop restart, including
new eligibility and refresh-pruning coverage plus pending/partial-failure
assertions. A previous resource-constrained run timed out loading an unrelated
recovery dialog; that case passed in isolation and the serial full run passed.

Codex's built-in browser verified the real component with fictional data at
1280px and 320px: exactly two eligible row checkboxes, three unavailable rows
without them, no checkbox/logo overlap, keyboard Space and multiple selection,
correct selected-action counts, and Clear. At 320px the two sample sender names
fit their 116px text cells without clipping; the page had no horizontal overflow.
Grouped 320px verification opened an eligible sender and a group containing three
ineligible actions: only the eligible action exposed a checkbox. Console warning
and error logs were empty. The temporary viewport override was reset.

The first CI run passed the desktop render case but failed the 320px sender
readability assertion. A compact-screen spacing adjustment gives sender names
12px more room, and the test now waits for responsive geometry before measuring
it. The check still requires at least 100px and no clipped sender names. The
126-test Activity suite and built-in phone verification passed after this fix;
the updated CI run must pass before queueing.

An independent reviewer inspected the final source/tests and desktop, phone and
grouped-phone screenshots. Design-system, accessibility, React/performance and
partial-failure review found no remaining issue. No additional production email
mutation was performed for this UI correction.

The regression test fails against the original component (five selectable rows
where only one is eligible) and passes with the correction. Production web build,
all 49 bundle budgets and 32 public prerender checks passed. Activity measured
302.5 kB against its existing 314 kB budget; no budget change was required.

CI, queue, deployment and production verification remain separate release gates.

The full queue suite caught one new glossary hit in the checkbox tooltip. The
tooltip now reads “Select for Undo”; the glossary baseline and release checks
remain unchanged. The shared (946), config (38), events (76) and Activity (126) tests passed
serially after the tooltip correction, with changed-file lint and formatting.
The corrected commit must pass the protected queue again.

The next PR run passed both Activity paint cases, but the recently merged theme
paint test failed its exact dark screenshot comparison. Trace frames show the
baseline still painted light and the next frame painted dark. Main was merged
to resolve this actual integration failure. The test now verifies the dark
palette before its baseline and captures with finite animations finished. The
exact pixel comparisons, contrast checks and production theme behavior are
unchanged; this adds a bounded test stability fix to the release scope.
