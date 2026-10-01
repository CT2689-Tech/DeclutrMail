# Activity first dialog click: hydration readiness

Integration owner: current Codex performance session.
Isolated branch: codex/activity-filter-hydration, base main 27afff0c (#840).
Owned files: Activity screen/spec and this review evidence. No runtime overlap
or dependency on API Activity #841, icon #842 or readiness #836.

## Observed failure

Post-merge #840 CI run 36882426105 failed the mobile Activity first-open test:
Filter was clicked, but its dialog never mounted in 15 seconds. Billing and
journey report assertions failed afterward because the earlier failing
accessibility step caused those lanes to skip. No workflow condition is faulty.

The retained trace provides specific timing evidence: Filter click started at
30621ms, after HTML/load and the button's visible assertion; it returned at
30640ms with aria-expanded=false and the desktop 40px server style. Activity's
mobile hydrated style appeared at 30670ms (44px), with expanded still false.
No filter-dialog chunk was requested after the click. This identifies a click
against server markup before the feature's handler was attached. It is an
interaction race, separate from API query latency or a slow dynamic import.

## Candidate and negative control

Filter and support-export dialog triggers render disabled on the server and
on the initial matching client render. Their own effect enables them after
hydration; no timers, polling, data or authorization changes. Dialog code stays
lazy, and existing focus restoration, filtering and export consent stay intact.

The test renders the real Activity screen to HTML with its query cache populated,
requires the two dialog triggers to be disabled, hydrates the same element and
requires both to enable. The first enabled Filter click must open the dialog.
Against unchanged main, the SSR disabled assertion fails (negative control).
The candidate passes the full Activity screen suite: 114 tests. Final web typecheck, changed-file ESLint and formatting pass. Independent
design-system and hydration reviews pass, including 114 Activity tests and
production Storybook build. Production Next build passes. In the corrected
local production build (3158, read-only synthetic API), the first enabled
Filter click opens the lazy dialog; Escape closes it and restores focus to
Filter. First Export click opens its review with both privacy options off;
Cancel closes it and restores focus to Export. Mobile first-open and all
required journey verification remain enforced by exact-head CI.

## Scope and limits

This fixes the two lazy dialog triggers sharing this confirmed Activity
first-hydration pattern. It does not hide controls, render an empty page, remove
loading boundaries, eagerly load dialog bundles or weaken the first-open E2E.
Other SSR controls and cold-route rendering remain separately scoped work;
no blanket claim of all screens being interactive or loaded within 200ms.
