# Later calendar clock repair

## Flow and scope

Review scheduled sender returns in the active account's timezone, edit a return-time
or note, cancel or save, request a return, and retain honest pending/error state.
The clock repair changes presentation only. Mail movement, provider completion,
recovery receipts, tier rules, telemetry and billing are unchanged.

Before: unchanged cached rows kept yesterday's date groups indefinitely; an open
Tomorrow preset kept its original date. A document hydrating across account
midnight could also rebuild its mismatched server markup.

After: one minute clock updates groups, return labels, presets and custom-date
validity. Presets resolve again at click time, and expired presets/custom times
show a recovery message before any request. The serialized server timestamp keeps the first hydration markup stable.
Rows share one keyed list parent, with accessible bucket headings/counts between
rows, so regrouping preserves input DOM, draft, focus and mutation observers.
The existing mailbox-keyed screen still discards account-specific interaction state
on an account switch. No shared clock hook or backend contract changed.

| State or transition              | Visible result                                                    | Cache effect                  | Verification                                                 |
| -------------------------------- | ----------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------ |
| Account midnight, data unchanged | Tomorrow becomes Later today; label updates                       | None required                 | Fake clock with pending refresh and unchanged cache identity |
| Midnight during hydration        | Server markup hydrates, then adopts Today                         | None                          | Real renderToString/hydrateRoot, zero recoverable errors     |
| Midnight with menu open          | Draft, focus and menu survive; Tomorrow resolves next account day | None until explicit submit    | Input identity/focus and submitted ISO assertions            |
| Midnight during save             | Pending controls survive; failure remains actionable with draft   | Existing invalidation         | Deferred response regression                                 |
| Midnight during wake             | Pending confirm survives; queued callback records waiting state   | Existing invalidation         | Deferred response regression                                 |
| Account switch                   | Previous account's draft closes                                   | Existing scope-reset contract | Draft reset and existing wake-state reset tests              |
| Loading/error/empty              | Existing recovery states                                          | Existing query behavior       | Existing screen suite                                        |

## Evidence and limits

Click-before-tick controls also failed the first repair: Tomorrow saved the old
date and an expired preset still sent a request.

The first three regression assertions failed on the original source: stale heading,
real hydration mismatch, and the original Tomorrow ISO submitted after midnight.
Ten new cases plus existing Later/date/shared-clock cases pass: 40 tests in four
files. Web typecheck, changed-file ESLint, Prettier and diff checks pass.

Local browser smoke used an isolated source copy, local Postgres/Redis and an
explicit synthetic account. Four owned fixtures displayed all four calendar groups,
account timezone, honest unavailable mirror counts, editable note/custom controls,
keyboard navigation, cancellation and reload. No captured console errors. Filling
the native datetime control initially did not dispatch a React change; a real arrow
key did, and enabled Set. No schedule or wake was submitted in this browser pass.
Midnight and in-flight transitions were exercised by the real component regressions,
not by claiming the browser session happened at midnight. Synthetic screenshot is
stored outside Git. The four owned senders and policies were removed (zero
remaining owned rows), the tab closed and owned services stopped. Independent
source/design/TypeScript review found no blockers and independently passed all
40 focused tests.

The existing minute clock may be throttled in a background tab; it samples the
current wall clock on its next tick. This is presentation freshness, not a worker
scheduling guarantee or proof of Gmail completion. Durable successful-return
receipts remain a separate product/data decision.

## Ownership and integration

This audit session owns the Later server page, screen, date-helper documentation,
clock regressions, existing Storybook additions and this record. No unmerged
change is required. Independently queued hydration fixes touch different files.
Required production build, bundle budgets and browser/accessibility suites remain
part of CI and the merge queue. Ready, merged, deployed and production verification
are reported separately; this authored record does not assert rollout completion.
