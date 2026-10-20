# Cleanup integration and release — 2026-10-20

## Authorization and integration ownership

The founder approved merging the reviewed cleanup changes through the normal queue, coordinating related sessions/PRs, and verifying the deployed flows. Autopilot stays separate and the earlier ambiguous unsubscribe sender must not be retried. Existing small reversible Gmail-test authorization remains bounded by preview, exact provider readback and restoration.

This chat is the integration owner. PR #1090 is retargeted to main and consolidates the linear preview stack #1081, #1082, #1083, #1084 and #1087, plus the related Senders confirmation/Undo repair #1078 and accepted-feedback/Keep Undo repair #1079. All original commits remain in the integration history. The superseded PRs should close only after the integrated candidate merges. Unrelated documentation, dependencies and infrastructure PRs remain independent.

Main at integration was `2b00538b15c55df1758b419fa21b71eb7231988b`. Its existing worker recovery, database-pool and alert corrections were preserved. Other marketing, web-metadata and infrastructure sessions reported no competing cleanup edits or release hold. Their already-merged work stays intact; no deployment policies or credentials change here.

## Final behavior

- Archive: Email age defaults to Any age; Inbox only.
- Delete: Older than 180 days, with Any age available and archived email an explicit opt-in.
- Later: Any age, default return seven days later, future-time confirmation guard.
- Unsubscribe cleanup: Archive/Delete use those same age/count/reach semantics. Unsubscribe-only leaves existing mail in place; existing initial cleanup choices and one-click/manual channel behavior remain distinct.
- Supported single, remembered inline and group previews use the selected age/reach/return for the impact summary and submitted action. Counts stay out of the primary button. Retry preserves selections; loading/unavailable/zero-match cleanup cannot confirm.
- Accepted cleanup stays visible through progress, unknown/failed readback and normal Undo. Senders stale-cache confirmation reads current facts and still respects in-flight locks. Keep Undo reconciles the returned policy even when list refetch fails; mailbox lock timeouts remain bounded/retryable.

## Integration repairs and verification

Independent review of #1078 found two lifecycle gaps before inclusion: a successful live read could leave `submitting` latched when a later guard refused dispatch, and detail unmount did not cancel the pending read. The integration releases only the completed, still-owned read's submitting state before refusal guards; actual mutations re-arm it. Detail unmount aborts its controller, and the abort/owner check prevents a late POST even when transport ignores cancellation.

Regressions cover detail unavailable → another preview, detail busy → retry, list Archive/Later/Delete busy → retry, and delayed refresh → unmount → zero unsubscribe POSTs for both page and pane. The focused eight-case run passes. Negative controls exposed the stuck confirmation and post-unmount dispatch before repair. Four stale #1078 tests were updated to the reviewed count-free buttons and Email age label. The affected API suites pass 44/44. Full candidate tests, build/budgets, final typecheck/lint, required CI and queue checks are release gates; their exact-head results are recorded on PR #1090.

The prior [connected verification](cleanup-consistency-2026-10-20.md#connected-candidate-verification) remains scoped to its named candidate: 22 cleanup confirmations, 68 completed forward/reverse child jobs, exact restoration of three Gmail baselines, neutral policies and cleared Later timers. Its combined-Unsubscribe tests used clone-only capability and disabled delivery, not a real successful unsubscribe. One external label interference required a single explicit restoration and exclusion from further testing.

Final integrated local validation: **4,825 web tests passed, zero failed, three existing skips**; the affected API suites passed 44/44; root typecheck, lint (zero errors, six existing warnings), formatting and diff checks passed. Production build, 52 measured route bundle budgets plus one redirect, and the prerender checks passed. The first full run had one checkout-panel timing failure; its isolated 161-test suite and the subsequent uncontended full run passed with no billing source change. An initial typecheck raced the build's regeneration of `.next/types`; the required post-build rerun passed. These observations are retained rather than presenting the initial runs as green.

Integrated CI then identified a retired-pricing-term guard hit in a new source comment. The comment was corrected without changing the guard or its baseline, and the shared/config/events suites were run locally before the corrective push. This correction changes no runtime behavior; the exact-head CI and queue checks remain required.

## Deployment verification boundary

Queue acceptance, merge, deployment and production verification are separate states. After merge, verify the actual serving web commit and applicable API/worker revisions, then exercise the deployed preview defaults/counts, supported inline/group entry points and small reversible cleanup/Undo. Reuse the signed-in built-in browser and connected Gmail account. Do not dispatch another irreversible unsubscribe, change Autopilot settings, reset production review fixtures, or infer sender acceptance from the earlier unconfirmed result. Production observations and any unavailable entry point must be reported explicitly on the release handoff.
