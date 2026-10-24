# Settings light control contrast — 2026-10-24

## Scope and ownership

- User authorized the two appearance fixes, tests, review and normal merge queue.
- Integration owner: this Codex chat; isolated branch `codex/settings-light-controls`.
- Base: `ecd481850` from fresh main. No dependencies on open PRs.
- Shared runtime file owned here: `apps/web/src/features/theme/app-light-theme.css`.
- Related decisions: D114 settings preferences and D147 cookie preferences.

## Change

Three app-light-only CSS rules give Off switches a one-pixel neutral outline
and muted thumb, and give cookie radio inputs the existing purple accent.
Every selector requires `#dm-app-theme` and excludes `data-theme='dark'`.
On controls, disabled opacity, dimensions, focus, semantics and handlers are
unchanged. Public consent components and their styles are unchanged.

## Local verification

- 156 Settings/consent unit tests passed across 11 files.
- All workspace typechecks passed, run serially to limit memory pressure.
- Lint passed with six existing unrelated warnings.
- Production web build passed; all 49 bundle budgets and 32 static public
  prerender checks passed.
- New real-component browser fixture uses SettingsSwitch, Switch and
  CookiePreferences without replacing their handlers. No API or account needed.
- Built-in browser: checked default-light paint at 320, 375 and 1280px;
  enabled Off controls are distinct from disabled controls; click and Space
  activation work; consent can be selected with mouse and keyboard.
- Dark and public fixture screenshots match the original main stylesheet
  byte-for-byte at all three widths (six comparisons). Public fixtures keep
  the app stylesheet loaded without the route marker.
- Negative control: original main has no Off track outline, a white Off
  thumb, and native `auto` radio accent. It fails the new light paint
  expectations, while the changed stylesheet satisfies them.
- Browser error/warning log was empty. No real account preference was changed.

The three automated render cases additionally assert consent persistence,
disabled state, On paint, horizontal overflow, exact dark/public pixels and
light restoration. They are included in the existing CI render project;
execution and merge-queue results are recorded on the PR.

## Review

Independent reviewer found no actionable issues in the runtime scope or test
coverage. Runtime change is CSS only; no workflow, API, consent-persistence,
Gmail or billing implementation changed. Existing keyboard and focus behavior
remains intact. Reviewer requested confirmation that CI executes the new browser
cases and that the negative control is recorded; see above and the PR checks.

Local screenshots and manual measurements are saved outside the repository in
the current chat's `settings-controls-fix-2026-10-24` evidence folder.
This document records local validation; merge, deployment and production
verification are separate states.
