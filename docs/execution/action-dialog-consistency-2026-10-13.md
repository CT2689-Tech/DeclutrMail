# Action preview consistency — 2026-10-13

## Flow contract

Review a sender or selection → choose Archive, Unsubscribe, Later, or Delete →
preview the active Gmail account, scope, destination, and recovery → confirm →
show submission → return to work and inspect the result in Activity.
Keep retains its existing immediate policy action. Triage's remembered inline
preview remains available. Unsubscribe retains its three choices and current
Archive default when a positive count is available on opening. Triage keeps its
existing default as its first live count arrives, unless the user has chosen
another option; Senders preserves its existing opening choice.

The selected flow covers Senders, Sender Detail, Triage, bulk previews, Inbox
Report's cleanup preview, and their synthetic demos. Onboarding, billing policy,
provider dispatch, retention windows, and production mailbox mutations are excluded.
The session owns preview components, their focused tests/stories, shared dialog
layout and radio interaction, and this record. Integration owner: this Codex chat.
No dependency on another open PR; inspect overlaps before pushing.

## Baseline evidence

Fresh main: `12149dba2`. Local synthetic design study at port 3137 uses the
production ConfirmActionModal and a fictional mailbox. Unsubscribe reproduced
plain radio rows, no sender avatar or Gmail account context, duplicated preview
paragraphs, and a filled primary color instead of the action's warning tone.
Source confirms its busyLabel locks cancellation during submission and drops
preview error/retry props at the specialized-dialog boundary. Triage separately
implements the same choices and resets the choice whenever its live count changes.

## Required states and acceptance

| State or transition               | Expected experience                                                                 | Verification                             |
| --------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------- |
| Single or bulk, loaded            | Shared identity/title/preview/note/controls/actions grammar                         | Component tests and synthetic browser    |
| Loading or refetch                | No cached count arms cleanup; future-only behavior stays available                  | Component regression                     |
| Failed preview                    | Cause and Retry preview; cleanup stays disabled                                     | Component regression                     |
| Missing sender                    | Refresh route; confirmation disabled                                                | Component regression                     |
| Zero current inbox                | Cleanup options disabled; future-only Unsubscribe available                         | Existing and new component tests         |
| Choice then count update          | Explicit choice preserved                                                           | Triage regression                        |
| Protected sender                  | Existing override consent and safe default preserved                                | Existing component tests                 |
| Submitting                        | Disable repeated confirmation; show Submitting; retain Cancel/Escape                | Component regression                     |
| Keyboard                          | Cancel opens consequential previews; arrow keys select radio options; focus returns | Shared tests and browser                 |
| Narrow viewport, expanded Details | Body scrolls; confirmation stays reachable; no horizontal overflow                  | Shared layout and browser                |
| Terminal/Undo/revisit             | Existing handlers and Activity lifecycle unchanged                                  | Existing tests; no provider test claimed |

Provider completion, worker persistence, and Undo restoration are outside this
presentation change and will not be claimed from synthetic interactions.

## Findings and repairs

| Priority | Evidence and impact                                                                                                                                        | Repair and verification                                                                                                                                                                                                      |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P2       | Browser reproduced Unsubscribe's plain radios, missing account/avatar and inconsistent color. Users had to relearn the same preview.                       | Shared PreviewSheet, sender identity, warning/danger tones, and SheetSegmented across Senders, Triage and public Senders demo; stories, component tests and browser smoke.                                                   |
| P2       | Source dropped failed/missing preview props and could use cached counts during refetch. An unavailable count could arm cleanup.                            | Forward error/retry/gone/account props; stale reads disable cleanup; future-only remains possible on ordinary count failure. Missing senders get refresh/review recovery and no confirmation. Regression tests cover each.   |
| P2       | Source reset Triage's explicit choice and remembered preference when counts changed.                                                                       | Keep user choices through refresh; reset them when closing or changing action/sender. Preserve existing default timing per surface. Async-count, explicit-choice and A → B → A regressions.                                  |
| P2       | Compact shell scrolled its entire panel, making the footer hard to reach with long Details on a short phone.                                               | Shared scrolling body and persistent footer. Browser at 320 × 568: expanded Delete body 640 px, available body 389 px; both buttons remain within viewport.                                                                  |
| P2       | Unsubscribe used busyLabel to disable Cancel/Escape; radios lacked conventional arrow navigation and focus trap included inactive radios.                  | Disable repeated confirmation, name Submitting, preserve cancel dismissal; roving tabindex with arrows/Home/End, skip disabled options. Component and browser focus evidence. Dismissal does not recall a delivered request. |
| P2       | Review found bulk destination hidden in Details, scope counts based on requested rather than eligible senders, and empty eligible sets still confirmable.  | Visible destination, settled eligible membership for counts/method summary, and blocked empty sets with recovery. Regression tests cover narrowed and empty membership.                                                      |
| P3       | Public demo's sibling actions retained bespoke modal/focus code; Protected controls and invalid Later dates lacked matching acknowledgement/recovery copy. | Reuse shared shell and scope control; Delete opens on Cancel; protected action says anyway; invalid Later date explains the block. Nine demo tests pass.                                                                     |

## Verification and limits

- Production Next build, bundle limits and prerender checks passed; Storybook build
  passed. Typecheck and lint passed; lint retains six preexisting unused-disable
  warnings outside this change. Final checks are repeated only for subsequent edits.
- Focused regressions were run against the old behavior first: six failures showed
  the missing identity, failure handling, submission and radio navigation gaps.
- Final affected web run: 16 suites, 646 tests passed; shared action run: 119
  tests passed. Expanded integration coverage exposed old accessible-name
  assertions and an unintended Triage default timing change; assertions now match
  visible labels and the default is restored.
- An early unbounded-worker run timed out two existing tests; narrow reruns and
  the bounded-worker run passed. A first build collided with this task's running
  Next dev server; stopping it and clean rebuilding resolved missing manifests.
  Neither result is counted as a product defect or silently omitted.
- Built-in browser used synthetic fixtures: actual ConfirmActionModal stories
  covered Archive, Unsubscribe, preview failure and submission. Production public
  demo covered Unsubscribe choices, Delete Details/phone layout, Escape and focus
  restoration, and Later rendering. Native date fills in the browser tool changed
  the DOM value without delivering React's change event, so Later validation is
  claimed from component regressions, not that browser attempt.
- Independent reviewer inspected the final flow/diff and adjacent safety, copy,
  layout and state transitions. Findings were fixed and re-reviewed; final review
  status is recorded in the PR. Reviewer performed source review; runtime checks
  belong to this session.
- Preview presentation only: no provider calls, real mailbox mutations, billing
  writes or test residue. Optional telemetry and action/Undo handlers are unchanged.
  Provider completion, persistence, account switching, quota policy, partial
  execution and expired Undo are not newly verified by these synthetic checks.

## Opportunities

1. **Implemented:** show the account, destination, recovery and usable scope
   controls consistently; expose actionable unknown/error/empty states.
2. **Deferred:** add the existing matching-subject/Gmail verification detail to
   specialized Unsubscribe cleanup previews. This could help users inspect exact
   matches, but requires deciding single/bulk detail density and is not necessary
   for the present shell repair. Use existing preview metadata only; no new Gmail
   content collection. Acceptance: sample matches agree with selected mode/count
   and unknown states never imply complete coverage.
3. **Out of scope:** prove provider completion and Undo restoration in a separately
   authorized mailbox fixture. Synthetic preview interaction does not prove it.

## Integration

No dependency on another PR. PR #1033 overlaps `tokens.css` and `panel.test.tsx`
in separate regions; current diff preserves those concerns. UI and focused tests
only; no contracts, migrations, workers, billing, dependency or policy edits.
The PR records the ready commit, checks and normal merge state. Local verification
does not establish deployment or production mailbox behavior.
