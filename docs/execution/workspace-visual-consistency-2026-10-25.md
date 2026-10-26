# Workspace visual consistency — 2026-10-25

The founder requested the accepted Home visual treatment across Cleanup, Automations, Catch up and Activity. This chat owns the scoped presentation layer, affected feature styles and visual evidence. Integration owner: this chat. No dependency PR; no overlap with the open billing/mobile/ops work. Base: `4803be25f`.

## Design and flow contract

Retain the approved app palette: canvas `#f7f6f9`, surface `#ffffff`, ink `#2b2730`, secondary ink `#6b6473`, purple `#6f568a`, boundary `#d8d3de`. Consume the existing tokens and their dark equivalents. Use the existing Geist/sans role, 28–34px page headings, semibold names/counts, tabular numeric roles, 12–14px supporting text, and 12px panel corners.

Keep each feature's established layout and information hierarchy:

```text
Page title / context
Views and filters
Work list or summary | Detail / review (where present)
Results / supporting context
```

Cleanup keeps its list/detail workspace; Automations keeps its review and rule library; Catch up keeps its distinct Later, Brief and Follow-ups views; Activity keeps its summary, filters and timeline. The primary detail/review or summary panel receives the accent edge. Other panels stay quiet. Avoid adding decorative dashboards or equal-weight cards for every row.

Changes are presentation only. Existing routes, query scope, counts, gates, filters, selections, previews, confirmations, keyboard commands, provider execution, Undo and refresh owners remain authoritative. Scope the common typography to the requested workspaces; preserve Home, onboarding, billing and account settings. No new data, chart, action, API, dependency or permission is planned.

Verification will use the real local app/API with disposable synthetic rows and the built-in browser. Cover desktop, 320px phone, dark mode, list/detail or review navigation, filter/period state, preview/cancel, and relevant empty/loading/error states. Use existing regression suites for safety and persistence. No real mailbox mutation will be used as test evidence. Independent review and normal queue checks remain required.

## Implemented and verified

The common presentation wrapper uses `display: contents` and only marks the Cleanup, Automations, Catch up and Activity route groups. Home, Settings and Plan & billing were inspected after navigating away from the selected routes and have no workspace appearance marker. The existing light/dark token roles remain authoritative. Storybook now uses the actual app palette and the same scoped typography for the affected stories.

The visual pass also resolved small-screen presentation defects found during smoke: Cleanup's report moves below its title instead of squeezing “Senders” into two fragments; the first-run AI prompt spans the sender grid; Activity's five summary metrics form two columns; Follow-ups metadata spans its row; and Later's buttons wrap within the panel with 44px touch targets. No action policy, data source or execution callback changed.

Browser verification used the real isolated web/API stack with disposable synthetic Postgres/Redis data. Desktop (1280px), phone (320px), light and dark modes were checked across Cleanup list/detail and first review, Automations review/rule library, Brief, Follow-ups, Later and Activity. All phone views retained a 320px document width. Activity's Archived filter updated the URL and visible results. Brief's current Inbox preview showed the fresh server count, focused Cancel, closed without confirmation, and returned focus to the opener. No real Gmail operation was executed. Empty/loading/error behavior remains covered by the existing suites and stories; not every such state was manually exercised.

Synthetic screenshots: [QA evidence](../qa/workspace-visual-consistency-2026-10-25/). Desktop/mobile pairs cover each area; selected dark captures cover the same tokens and the final wrapped Later controls.

Validation:

- Relevant broad existing suite: 1,583 tests passed, 3 skipped (99 files passed, one skipped).
- Final affected suite: 572 tests passed across 22 files; final Later/Follow-ups checks: 85 tests passed across seven files.
- Independent final behavior review: 277 tests passed across five files; no actionable source or visual findings. Existing handlers, queries, gates and confirmations retained.
- Production web build and all 49 route bundle budgets passed. Repository typecheck and lint passed (six existing unused-disable warnings). Storybook production build passed. Whitespace checks passed.
- Required PR checks, merge-group checks, deployment and production verification remain separate release evidence and are not asserted by these local results.

### Queue correction

The first merge-group run found the copy glossary scanner interpreting the internal CSS padding token as user-facing text. Renamed that token consistently to `--dm-content-padding`; no scanner rule or baseline was relaxed and no value/behavior changed. Independent review found no naming collision or missed reference. All 955 shared tests then passed locally; production build and bundle checks were repeated before the corrected candidate was pushed.
