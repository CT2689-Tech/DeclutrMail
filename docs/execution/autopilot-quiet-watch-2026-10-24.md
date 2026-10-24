# Quiet watch production implementation

## Flow contract and ownership

User request: implement the selected Quiet watch design in the real Autopilot app, including rule customization, Schedule within Autopilot settings, mandatory preview, queued approval, completion, and Undo. The in-memory prototype is design evidence only; its clock, fixtures, and queue must not enter production.

Integration owner: this session. Branch `chore/bootstrap-autopilot-quiet-watch`, isolated worktree based on freshly fetched `origin/main` at `75a44acaa99e1eb4cfb09cb8b80bf2dfc61389e7`. Intended ownership: Autopilot and Schedule web screens/styles/stories/tests, their authenticated routes, shared navigation and route tests, and bounded Autopilot/action API and label-worker changes needed for durable approved snapshots and queue feedback. Dependencies are existing sender-rule APIs, quiet-hours configuration, action batches, label worker, feedback tray, and Undo journal. No dependencies on open PRs. Existing billing, mobile auth, dependency, and worker-pool PRs remain separate. No migrations, payment, OAuth, privacy inventory, or global theme changes are intended.

Entry: authenticated `/autopilot` for the selected Gmail account. Existing capability gates remain authoritative. Settings lives at `/autopilot/settings`; legacy `/quiet` links redirect there. Remove the separate Quiet hours tab. Per-account Schedule configuration remains persisted through its existing API.

Story: discover Quiet watch → New rule/Edit rule → select known senders and Archive/Delete scope/age → save without moving email → preview exact current targets → exclude senders → explicit confirmation → durable approved batch → wait while Schedule is active → execute the frozen targets after the window ends → show actual terminal result → Undo through the existing journal and poll restoration → return to rule review. Custom sender-rule approvals freeze message IDs; new arrivals and excluded senders are never added. Protected checks remain authoritative. Preset approvals retain their existing sender-based sweep semantics. Editing a rule after approval must not expand or rewrite an approved batch; pausing or retiring a rule still stops unstarted work. Preview/version validation remains mandatory before approval.

Design: reuse the approved production shell and plum/lilac token palette, Geist controls and evidence, and the existing display font for the Quiet watch statement. Left-aligned statement and inbox → watching → approval path form the signature. Keep custom rules visibly editable and presets available with their real eligibility/observe/active constraints. Light and dark modes, keyboard/focus, 320px layout, and reduced motion retain existing conventions. No prototype comparison bar or sample clock ships.

## States and acceptance

| State or transition                                  | UI / source of truth                                                                            | Cache and verification                                                   |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Loading, empty, unavailable, old API                 | Honest loading/error/retry and existing preset fallback                                         | Existing hydration/capability tests plus new route/layout checks         |
| Account switch, disconnected/no account, plan change | Reset drafts, preview tokens and receipts by mailbox; server guards remain authoritative        | Scope tests and authenticated synthetic browser harness                  |
| Save/edit/cancel rule                                | Name, senders, action, reach and age persist; saving moves no email                             | Existing sender-rule mutation and paged/search editor tests              |
| Preview/exclusions, stale or expired preview         | Count and selected senders come from server snapshot; stale/expired cannot confirm              | Contract tests, UI rejection/retry and negative controls                 |
| Approval during Schedule                             | Durable queued status and actual scheduled hint; never report completion optimistically         | API/worker tests with fake Gmail and frozen message IDs                  |
| Rule edited while batch waits                        | Keep the approved action and exact targets; no new arrivals                                     | Worker regression including edits before execution and during quota wait |
| Pause/retire waiting work                            | No unstarted provider mutation; clearly distinguish cancellation from failure                   | Worker guards; no separate batch cancellation endpoint is introduced     |
| Assigned resume time arrives                         | Worker rechecks current schedule and executes only approved IDs                                 | Fake clock/queue integration; Schedule save/read refresh                 |
| Terminal success, partial, failed, unknown           | Actual affected counts and retry/Activity route, with no success inferred from queue acceptance | Batch polling and persisted refresh tests                                |
| Undo / expired or failed Undo                        | Existing token, expiry, reverse job and exact placement restoration                             | API/worker regression and browser flow; no changed retention policy      |

Production mailbox mutations are excluded from evidence generation. Use isolated synthetic accounts, PGlite/test harnesses and fake Gmail adapters for execution/failure cases. Production serving and read-only browser verification are separate from real-mail outcome verification. Onboarding and billing are excluded.

## Implementation decisions

- Reused bounded sender-list customization, preview/version validation, action queue, Schedule configuration and the complete Undo pipeline. Presets retain their own Observe/Active semantics.
- Custom approvals retain frozen action/reach/age/message IDs after edits. A later mode transition revokes unstarted approvals, even if a rule is resumed before delivery. The initial check and atomic provider admission compare stored timestamps at PostgreSQL precision; a microsecond regression covers classification as well as refusal.
- New optional active/batch feedback carries the approved rule identity and a confirmed Schedule wait. Pending custom batches remain discoverable beyond 24 hours. Neither queue acceptance nor a status-read failure is called completion. The six latest cards poll at a bounded cadence; Activity retains the full history.
- Schedule edits are rechecked at an already queued batch's assigned wake time. Shortening/disabling a window does not proactively wake existing deliveries. This limitation is visible in settings. Pause/retire guards stop unstarted work; there is no new Cancel endpoint.
- The legacy route redirects at the Next routing boundary, before streaming. Bundle verification declares that redirect and measures the new settings page. Its comparison probe also uses a real known comparison when runtime pricing leaves that route unprerendered; no existing route cap was raised.

## Verification and review

Local implementation is ready for PR checks; merge, deployment and production serving are separate pending states.

- Web: 396 relevant tests across Autopilot, Schedule, action feedback and shell/route suites passed. Subsequent targeted reruns passed 71 cases after UI recovery changes and all 26 rule-library cases including the final modal-focus regression.
- API: 23 sender-rule cases and 142 action/pipeline cases passed. The integrated fake-clock case previews/excludes, approves exactly two emails at 06:59 UTC, waits through a rule edit and a new arrival, executes only that pair at 07:00, then runs and confirms the complete reverse set.
- Workers: all 26 approved-custom-rule cases passed, including config edits before execution/during quota wait, microsecond mode revocation, pause/resume, disconnect, entitlement downgrade, Protected changes, Schedule deferral, ambiguous retries and Delete placement recovery.
- Shared: 61 navigation, route and entitlement-literal checks passed. Workspace typechecks and lint passed (six existing unrelated lint warnings). Final web and E2E typechecks passed after story/fixture adjustments.
- Production web build passed, including generated route types. All 49 measured route budgets pass; all three declared redirects are verified. Settings has a measured 291.0 kB first load and a generated 306 kB cap. Existing route caps are unchanged. All 32 public static-route checks pass. The budget helper's 34 contract cases passed.
- Storybook includes Quiet watch states and approved-batch empty/loading/waiting/completion/partial/error/Undo states. The real-component paint fixture compiles and lists all ten required cases; its updated selectors/hooks remain synthetic. No standalone browser automation was used locally: built-in-browser walkthroughs supply local interaction evidence, with the automated browser cases left to required CI.
- Independent architecture/design/flow and JSON-schema compatibility reviews passed with no blocking findings. The reviewer separately passed 72 feedback tests, web/E2E types and diff checks. All reported findings were fixed. A final browser keyboard check also caught row-preview focus escaping behind the modal; a consumed focus request now leaves focus with the modal and restores its actual row opener, covered by a regression test and final independent review.

## Built-in browser evidence and boundary

An isolated, loopback-only Nest + Next + disposable PostgreSQL/Redis stack used `chintan.e2e.billing@synthetic.test`. A separate guarded BullMQ consumer ran the real label worker with a fake Gmail client; no Gmail transport or real token was present. Its client awaited `beforeFirstRequest` before recording any change.

The walkthrough created Evening cleanup, saved Schedule, approved two fixture emails during the pause, refreshed the page and rediscovered the same two waiting until 14:35 PDT. While waiting, the rule was changed to older than 90 days and a third arrival was inserted. The real delayed queue ran Archive only for `e2e-bill-m1` and `e2e-bill-m2`. Inline Undo completed the reverse job for exactly those IDs. SQL readback showed both forward/reverse done with requested/affected counts 2; both original messages were back in Inbox and the third arrival remained untouched.

A clean production build was then exercised at 320px in both themes: settings navigation, save/reload, the legacy redirect and preserved overnight window. Its settings page had no uncontained viewport escape. Expanded preset and editor/preview exclusion flows were checked in the real-component fixture at 320px; the preset filter's deliberate horizontal scrolling remained contained. Desktop and 390px views were also inspected.

One minified hydration error appeared while switching the verification server between development and rebuilt production artifacts. It did not reproduce in development, or on clean production settings reload and legacy-redirect reload with the same dark preference and stored Schedule. No speculative theme change was made. The Schedule journey now checks dark-mode reloads for hydration errors, and the new settings path is covered in hydration/responsive CI.

Local server startup needed a temporary preload of the installed SWC package's already materialized official binary because its compressed carrier could not initialize without HOME in the credentials-stripping harness. This workaround is outside the repository; no provider credentials, source SDK replacements or production changes were introduced.

No production mailbox mutation was used for verification. These results establish synthetic end-to-end behavior, not real Gmail provider restoration or production serving.
