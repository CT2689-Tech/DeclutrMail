# Quiet watch rule inventory

Owner and integration owner: this Codex session. Based on main `4b57d8e` (Quiet
watch #1126). Owns Autopilot web composition, library and preset row, their
stories/fixtures/tests, and affected browser checks. No unmerged dependencies or
shared backend, database, worker or provider changes.

## Flow contract and finding

An entitled user opens Autopilot for the active mailbox, sees the rules counted
by Quiet watch, finds an existing rule in Your rules, opens Edit rule, changes
supported settings, previews matches, and returns to the list. Changing a setting
uses the existing rule API; mail-changing actions still require their existing
preview and confirmation. Custom sender rules retain their editor, batch
approval, Schedule and Undo flows.

Before: the hero counted preset and custom rules, but Your rules counted and
listed only custom rules. A mailbox with two enabled Observe presets and no
custom rules displayed `2 watching` and `Your rules 0`, with presets hidden in a
separate disclosure.

After: one inventory contains presets and sender rules. Its count, search,
Ready/Inactive filters and six-row pages cover both. Presets are labelled Built-in
rule; Edit rule opens their existing settings and explicit preview. There is no
second hidden preset list or misleading first-custom-rule empty state when
presets exist. Pending suggestions remain available below the inventory.

| State or transition                  | Visible behavior                                                                                | Verification                           |
| ------------------------------------ | ----------------------------------------------------------------------------------------------- | -------------------------------------- |
| Two Observe presets, no custom rules | Both rows and count 2; visible Edit rule                                                        | Route regression, synthetic browser    |
| Edit built-in threshold              | Existing PATCH, settings remain with the row                                                    | Route regression, synthetic browser    |
| Search/filter/page mixed rules       | One bounded inventory                                                                           | Library regression, responsive browser |
| Custom editor/preview/approval       | Existing controls and exact preview                                                             | Existing focused tests                 |
| Missing old custom API and recovery  | Preset surface remains usable; open confirmation persists and restores focus to visible content | Rollout regressions                    |
| Partial/unavailable inventory        | Total unavailable rather than invented zero; existing retries                                   | Focused tests                          |
| Refresh or mailbox scope change      | Server queries own persisted state; drafts retain mailbox reset                                 | Existing tests and synthetic refresh   |

Onboarding, billing, new preset conditions, provider semantics and real mailbox
mutations are excluded. No new data or product policy is introduced. Schedule,
queued execution and Undo are unchanged; their existing tests remain in scope for
regression verification. Production verification is read-only.

## Validation

The new route assertion failed before the fix: the main library did not contain
the presets. All 213 Autopilot tests pass, including two presets/no custom rules,
actual threshold PATCH, mixed filters/pagination, unavailable totals, cached read
failure/Retry, combined pause messaging, API fallback and hydration recovery.
Independent design-system/flow review passed after resolving cached control,
inactive label and preset-only pause-banner findings; the reviewer independently
ran four focused regressions.

The built-in browser verified expanded built-in controls at 320px in light and
dark themes with no overflowing controls. Full production-build smoke and release
evidence are recorded in the PR. No production mailbox or settings were changed.
