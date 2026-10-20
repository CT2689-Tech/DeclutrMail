# Unsubscribe cleanup preview: review patch

Scope: Senders single and bulk/group confirmation, Triage modal and remembered inline, and Screener unsubscribe-only inline. Owner and integration owner: this chat. Based on Later draft #1084 at c32a0a395a64b020f81ac8d48268115e061186fc; dependencies #1081–#1084 remain held for review. Existing prototype and preview worktrees stay untouched.

Contract: supported one-click or manual mailto request, optional existing-email cleanup where already supported, mandatory preview, explicit confirmation, queued/provider outcome and Activity recovery through existing paths. Unsubscribe cannot be recalled; only existing-email cleanup is undoable. No real mailbox mutation, merge, release, Autopilot, onboarding or billing work. Screener has no composite cleanup control; Triage domain groups have Archive/Later only. The existing group Unsubscribe path is Senders bulk.

The founder approved Archive default Any age and Delete default Older than 180 days, with Any age available. Preserve the initial unsubscribe-only/archive choice, reach defaults, supported channels, Protected single override and bulk exclusions. Changing cleanup mode resets its age to the corresponding default and reach to Inbox only. Selected age/reach must drive count, sample, group per-sender matches and submitted cleanup. Unsubscribe-only has no age filter and does not move existing mail.

| State or transition                                  | UI and action contract                                          | Verification |
| ---------------------------------------------------- | --------------------------------------------------------------- | ------------ |
| Open / reopen / new selection                        | Existing initial mode; no stale filters                         | Pending      |
| Archive / Delete / age / reach                       | One live impact count; exact options submitted                  | Pending      |
| Unsubscribe only                                     | Existing email stays; no age or cleanup payload                 | Pending      |
| Loading / failure / missing bucket / zero cleanup    | No cached/all-age fallback; cleanup blocked, choices editable   | Pending      |
| Protected / bulk exclusions / unavailable channel    | Existing eligible recipients and explicit override preserved    | Pending      |
| Confirm click / keyboard / repeated click            | Same options, existing latches and lifecycle                    | Pending      |
| Accepted / partial / manual / unknown / retry / Undo | Existing outcome paths retained; source and regression coverage | Pending      |
| Phone width / focus / cancellation                   | Shared review layout, native controls, no preview bypass        | Pending      |

Production Gmail outcome is unverified for this candidate. Local browser fixtures and mocked request tests are separate evidence from provider completion.

## Implemented and checked

- Shared count-free cleanup choices, stable sender titles, Email age with approximate cutoff, one impact summary and short action button. Existing initial mode, manual mailto versus queued one-click, Protected overrides/exclusions, action feedback and cleanup Undo remain on their existing paths. Compact Home titles retain their existing counts; this pass does not redesign Home.
- Archive uses Any age. Choosing Delete resets to Older than 180 days and Inbox only; Any age remains available. Age changes preserve the selected Delete reach. Mode changes reset reach and choose the corresponding age default. Unsubscribe-only hides cleanup age and sends no Triage cleanup filter.
- Triage had no age in its unsubscribe-backlog request. The new modal and inline controls now carry the selected age to that endpoint. The unfiltered inbox total determines the opening mode; zero/missing selected buckets cannot silently change Archive into unsubscribe-only. Includes, samples/Gmail handoff and impact reflect the selected age and reach. Zero matches leave controls usable and disable cleanup, with an accurate next action.
- Group Unsubscribe is the existing Senders bulk path. Its eligible per-sender selected-age counts sum to the impact and selected sender IDs. No new Triage group action or Screener composite action is introduced.

Local evidence for the final candidate:

- Full web suite: **4,782 passed**, three existing skips across 381 files. Actual Senders-screen and Triage modal/inline requests cover default Delete180, explicit Any age, archived reach, selected Archive age, click/keyboard, zero/missing buckets and reset. Existing partial outcome, manual follow-up, unknown/retry and Undo regressions remain in the full suite.
- Backend UnsubscribeBacklogService: **22 passed**, including four mixed-date inbox/archived/Trash cases that assert the measured count and persisted cleanup-job age/reach. Label worker: **50 passed**, including age-scoped resolution and restoration. These use isolated test data and provider adapters, not a live Gmail account. Shared launch-copy checks: **21 passed**.
- Negative control: forcing unfiltered cleanup payloads in Senders and Triage fails six selected request assertions. Exact candidate bytes are restored before final verification.
- Workspace typecheck passes. Lint has zero errors and six existing unused-disable warnings. Formatting, static Storybook, production Next build with CI pricing/meter/pass flags, all **52 bundle budgets**, and **32 static-route prerender checks** pass; no budget rebaseline.
- Built-in browser: default Any-age Archive128, Delete180 inbox84, including archived96 and Any-age all-mail146. Group totals256 /168 /192 /292 match the per-sender breakdown and sample confirmation. Triage Ctrl-Enter confirms the same filtered scope; zero age remains editable without changing cleanup mode. Screener one-click and mailto previews distinguish the request from the manual Gmail step, and Cancel is not confirmation. All five review tabs have no browser error logs.
- At a 320px viewport, inline page and modal panel have equal client/scroll widths (310px); choices stack, fields fit and body scroll retains access to the controls above the persistent footer. Viewport sizing is reset. Review screenshots live outside the repository in `unsubscribe-pass/` under this chat's visualization directory. Static preview: localhost6026, Python PID80680, serving this worktree's Storybook output.

The first production-build attempt failed on an incomplete group-story fixture; the fixture is corrected. A later build reported ENOSPC during cache writes. Only disposable Next caches from this preview and the earlier Later candidate were removed; their delivered Storybook outputs were retained. The final production build passes. These earlier failures are not counted as successful verification.

Independent design/correctness review found and resolved the opening-mode/empty-range bug, selected-age Includes mismatch, Later control-order regression, missing unfiltered-total fixture field and canceled-caption issue. Final review result is recorded in the PR. No remaining blocking finding is known.

## Remaining boundaries and deferred work

No single live browser→Gmail provider journey was executed for this unmerged candidate. Browser fixtures prove the UI/sample callback, mocked frontend tests prove requests and recovery handling, and isolated backend/worker tests prove their contracts and label-selection behavior. Real provider completion, post-release persistence and restoration must be validated on the integrated deployed candidate with a narrowly authorized test mailbox. No real unsubscribe request was sent and no mailbox mutation needs restoration.

Screener cleanup add-ons and Triage group Unsubscribe would be new capabilities, not layout changes, and remain outside this targeted pass. Autopilot and other actions remain separate. This branch and all parent drafts are held for founder review; no merge, auto-merge or production release is authorized by this review pass.
