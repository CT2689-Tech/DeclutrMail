# Activity dialog hydration — independent review

**Design-system gate: PASS. Independent hydration/correctness review: PASS. No introduced blocking findings.**

Worktree `/Users/chintant/.codex/worktrees/d523/DeclutrMail-filter-hydration`, branch `codex/activity-filter-hydration`, base `27afff0cb1b6fa0e7cccdba1471648e63d341652`. Source scope: existing Activity screen, its test file, and `docs/qa/activity-dialog-hydration-2026-10-01.md`. No source edits, browser control, external comments, merge or deployment by this reviewer.

Reviewed SHA-256:

- Runtime `apps/web/src/features/activity/activity-screen.tsx`: `3bad1c43f7632c66f8c103a7a6f74bfe69d53586611dcbbf5323120ad8c8df15`
- Test `apps/web/src/features/activity/activity-screen.test.tsx`: `f0d9713fd939e760927137a23b8919fa4ab931349bc9ffa065674db0859895bf`

## Reader and interaction inventory

| Consumer                                             | Readiness / state                                                     | Effect of stale or missing state                                                                                                                     |
| ---------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Filter trigger                                       | Own committed client hydration and local open state                   | SSR-enabled control can accept a visible click before its feature handler exists, losing intent. New native disabled state prevents that acceptance. |
| Export support bundle trigger                        | Own hydration plus existing invalid-filter disable condition          | Same pre-handler intent loss; export's invalid-filter guard must continue to block invalid scopes afterward.                                         |
| Desktop popover / mobile filter sheet                | Existing live filter props, onClose, button ref                       | User changes filter URL/local grouping. Existing Escape, outside click, mobile close and focus restoration remain.                                   |
| Support bundle dialog                                | Existing filters/mailbox identity, explicit address/technical opt-ins | No export request until dialog's existing review/consent path. Hydration guard changes only entry readiness.                                         |
| Undo, bulk Undo and recovery preview/confirm readers | Existing authoritative request/query state                            | No moved read/write or changed guard. Mandatory preview and server validation remain unchanged.                                                      |

## Design System Agent — no findings

Read `.claude/agents/design-system-agent.md` and applicable CLAUDE §§7–8. Independent web typecheck, changed-file lint and production Storybook build all pass.

Checks A–I: no changed action vocabulary/shortcut, destructive lifecycle, component boundary/promotion, server-state storage, empty-state branch or motion token. One small feature-local headless hook returns a readiness boolean, with no JSX, network request, mutation or shared store. Local ephemeral hydration/open state is not server data. No new component file or screen was introduced; existing ActivityScreen and ActivityFilterDialog stories cover the rendered controls and edge variants. Therefore D210's new-component story requirement does not demand a new story file. The SSR readiness edge is directly exercised by the real rendering/hydration test. No gate stop condition applies.

## Independent adversarial hydration and UI assessment

At runtime lines 1223–1228, the hook initializes false in server rendering and the initial matching client render. React does not run effects on the server. Its own effect schedules readiness true after the trigger component commits, when React's event handling is installed. The resulting disabled attribute matches during hydration, and no timer, global hydration signal or unrelated parent's readiness is trusted. Strict Mode effect repetition does not introduce an external side effect. Remounted controls begin disabled again until their own commit.

Filter uses native `disabled={!hydrated}` (line1267); this blocks pointer and keyboard activation and removes the premature control from tab order. After readiness it retains the same toggle handler, aria-haspopup/aria-expanded, active-count rendering, tokens and mobile 44px target. The existing close callback restores focus; the readiness boolean cannot turn false during that mounted dialog's normal lifecycle. No effect steals focus when enabling.

Export uses `disabled={disabled || !hydrated}` (line1401). Its existing invalid-filter condition is preserved after hydration; readiness cannot override invalid filters. Same title, filters, mailbox identity, local open state, dialog consent controls and download behavior remain. Dialog implementations and their focus traps are unchanged. No new user data or telemetry is introduced.

All three dialog dynamic imports remain unchanged with ssr:false and are still rendered only when their open state requires them. The hook does not request a chunk or eagerly mount a dialog. A click during a cold dynamic import still relies on the existing loading behavior; this change specifically fixes acceptance before hydration, not arbitrary import/network latency.

The new test uses real `renderToString` and `hydrateRoot`, prefilled real QueryClient data, and the same UI element on both passes. It asserts both trigger disabled states in SSR, retains the Filter DOM-node identity after hydration, asserts both enabled states, then verifies the first enabled Filter click mounts the real dialog and expands the trigger. There is no next/dynamic stub or hydration-warning suppression in this test. The integration owner's copied-base negative control fails the original SSR disabled assertion. The test is meaningful evidence for the control contract, while browser mobile first-open verification is a separate integration-owner check.

Existing passing tests retain Escape/outside-click focus restoration, mobile bottom-sheet opening/closing and 44px targets, invalid-date Export disable behavior, bundle filter/mailbox scope and explicit full-address/technical opt-ins, and recovery/Undo semantics.

## Scoped defect-class sweep

Class: an SSR-rendered button opens a client-only lazy dialog but advertises enabled activation before its own click handler commits.

Confirmed seed: Activity Filter, as reported by the integration owner's retained mobile CI trace; root described click30621–30640ms against server-style40px markup, hydration44px at30670ms, aria-expanded remaining false and no dialog-chunk request. This reviewer read the retained QA account; the original trace was not independently opened here.

Proof of search:

```
Query: rg -n 'onClick=.*set.*(Open|open)|setOpen\(|dynamic\(' apps/web/src/features/activity --glob '*.tsx'
Seed: ActivityScreen Filter toggle, runtime line1268; lazy import line89.
Axes: shape checked; reachability checked for header/footer/row rendering; consumers checked; layer checked for screen triggers versus client-only dialogs; provenance skipped under sweeper's read/grep-only role.
```

Two scoped triggers are corrected: Filter and Export support bundle. Both are rendered in the ordinary Activity screen and open lazy dialogs; both now share the own-component readiness hook. No API/write timing or workflow changes are required for this class.

**Nonblocking, unchanged adjacent candidate:** RecoveryCell's `Check and retry` button (runtime lines2390–2402) opens the existing lazy ActionRecoveryDialog via startReview and is disabled only while createPreview is pending. A failed-action row in SSR can therefore expose the same general pre-handler activation window. Its preview/mutation/confirmation guards remain safe and no lost-click trace was reproduced on this control. This is reachable-but-unmeasured, trust6/10; browser first-click reproduction on an SSR-prefilled failed-action row would establish it. Parent was notified. It is a focused follow-up, not an introduced defect or evidence that this Filter/Export change is unsafe. Do not treat the narrow fix as an exhaustive guard of every SSR control.

Other Activity dialog-internal controls cannot exist in server HTML because their dialog imports are ssr:false and closed initially. Native links can navigate before hydration and do not share the lazy-open mechanism. Ordinary filter chips and row mutations are not reported merely from pattern similarity; their first-click behavior was not measured in this review.

## Independent validation

- Activity screen suite: **114 passed, 1 file**, 5.62s.
- Web typecheck: passed.
- Changed-file ESLint: passed.
- `pnpm --filter @declutrmail/web storybook:build`: production build completed successfully. Existing bundler/deprecation notices do not indicate a failed build.
- `git diff --check`: passed.

Logs:

- `/tmp/declutrmail-hydration-review-tests.log`
- `/tmp/declutrmail-hydration-review-typecheck.log`
- `/tmp/declutrmail-hydration-review-lint.log`
- `/tmp/declutrmail-hydration-review-storybook.log`

Integration owner independently reported successful Next production build and has browser smoke underway; this reviewer did not control the browser. Final-head CI and production rollout/verification remain integration-owner steps. No before/after page-speed or all-screen200ms claim is made by this interaction fix.

## Final disposition

Ready for integration-owner final-head checks and authorized integration. No unresolved design gate or introduced correctness blocker. The confirmed Filter race and matching Export entry pattern are fixed without altering lazy loading, filter/export scope or action authority; the unmeasured unchanged RecoveryCell entry is recorded as a separate follow-up.
