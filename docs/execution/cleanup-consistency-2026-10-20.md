# Cleanup consistency review — 2026-10-20

## Scope and ownership

Archive, Delete, Later and Unsubscribe in Senders, Triage and Screener, including supported dialog, inline and group previews. Autopilot is excluded. This chat owns the review and bounded fixes on `codex/cleanup-consistency-review` in the existing isolated Unsubscribe worktree. The follow-up depends on draft #1087 (`codex/unsubscribe-preview`, base `34a3b441550a22323ac8d230eaf89caafb2e9eef`) and its earlier preview stack. The original prototype checkout remains untouched. No merge, deployment, schema, billing, OAuth or worker changes are part of this pass.

## Shared contract

Mandatory preview → explicit confirmation → accepted/in-progress → terminal result → refreshed/revisited state → Activity Undo for cleanup. Selected email age, inbox/archived reach and Later return time drive both the displayed count and the submitted request. Loading, unavailable and zero-match cleanup cannot confirm. Protected exclusions and one-click versus manual unsubscribe remain distinct.

| Action                | Email age at opening | Other behavior                                           |
| --------------------- | -------------------- | -------------------------------------------------------- |
| Archive               | Any age              | Inbox only                                               |
| Delete                | Older than 180 days  | Any age available; archived email opt-in                 |
| Later                 | Any age              | Inbox only; return defaults to seven days                |
| Unsubscribe only      | No age control       | Existing email stays where it is                         |
| Unsubscribe + Archive | Any age              | Same Archive age/count semantics                         |
| Unsubscribe + Delete  | Older than 180 days  | Any age available; same Delete age/count/reach semantics |

Counts belong in the impact summary. Primary buttons describe the action. “Older than N days” selects older email; “Last N days” would select a different set. The approximate cutoff remains visible below Email age.

| Surface  | Supported entry points                                                          |
| -------- | ------------------------------------------------------------------------------- |
| Senders  | Single and bulk modal previews for all four actions                             |
| Triage   | Single modal; remembered inline Archive/Later/Unsubscribe; Archive/Later groups |
| Screener | Per-sender inline previews; Unsubscribe is future-only                          |

Triage Delete remains modal-only; its forced inline renderer story is not a reachable product entry point. Triage Unsubscribe/Delete groups and Screener groups/Unsubscribe cleanup are unsupported rather than missing test cases.

## Findings and bounded repairs

1. Senders Archive/Later Details still displayed legacy plus-suffixed age labels. They now use the same day labels and Email age fact label as Delete.
2. Later confirmation could remain visually armed after an idle preview’s return time expired. A shared clock hook updates all five preview consumers, handles focus/visibility changes and long native timeout limits, and cleans up its timer/listeners. Senders also rechecks immediately before click and keyboard submission. No return default or action payload changes.
3. Screener had no Retry preview for a failed cleanup count. Its existing preview refetch is now exposed through the row, without confirming or resetting age/reach/return.
4. Triage remembered inline previews had the same recovery gap. Retry is now wired through list and focus layouts independently of preview detail availability. Future-only Unsubscribe remains available during a failed count, while Retry can recover the cleanup choices. Triage single/group preview recovery uses the same Retry preview label; a missing group age bucket also offers retry while remaining blocked. Recovery stories model an actual unavailable-to-ready transition.

No count formula, mailbox selector, provider operation, age default, reach default or seven-day return default changed in this follow-up.

## Local candidate verification

Evidence artifacts are outside the repository in the task’s local `final-consistency` folder. Fictional fixtures contain no live mailbox content.

- Browser matrix: 19 supported default previews; 10 Archive/Later changed-age confirmations; 18 loading/unavailable cases. All defaults and enabled/disabled primary controls were rechecked after the final build. Seven dialog/inline/group retry cases preserved the selected 90-day age and Later return time, recovered the matching count and did not confirm an action. Future-only Unsubscribe recovery kept that choice selected while restoring cleanup choices.
- Idle Later expiration was observed in the real browser without another edit: confirmation disabled and “Choose a future return time” appeared at the selected time. Native datetime input commits were verified through visible Details, rather than assuming a programmatic fill committed React state.
- Negative regression runs failed before the fixes: five preview consumers did not expire while idle; list/focus inline recovery had no Retry; failed-first-fetch inline Unsubscribe had no Retry.
- Tests cover expiration/rearming, background clock jump, long timeout, close/unmount cleanup, invalid times, immediate Senders click/keyboard guards, retry without mutation, selected age/return preservation and matching request payloads. Group recovery covers both missing aggregate and missing per-sender age buckets.
- Delete Any age checked across all three surfaces: inbox-only count 128 → include archived count 146 → sample confirmation 146 with the same reach/age. Zero-match Delete stayed disabled on all three. Four supported Unsubscribe single/group/inline previews switched Delete to 180 days, Archive to Any age and future-only to no age control; sample confirmation left existing mail in place.
- Three representative previews passed a 320-pixel viewport check without horizontal overflow. Escape canceled Senders group Unsubscribe without confirmation and restored focus to its invoking Review button. Browser console had no errors; the existing Next runtime-config deprecation warning remained.
- Full web suite: **4,803 passed, 0 failed, 3 existing skips**. Two missing-group-bucket regressions were added afterward; the final affected group suite passed **20/20**. The complete Triage request suites passed **104/104** before the final assertion was tightened to count the actual unsubscribe endpoint; the subsequent full suite includes that tightened assertion.
- Final production web build, root typecheck, lint (0 errors, 6 existing unused-disable warnings), changed-file formatting, Storybook build and diff whitespace checks pass. Prerender checks pass for 32 static routes. Bundle budget passes for 52 measured routes plus one verified redirect with the same PRICING_V2/METER_V2/BILLING_PASS_ENABLED flags as the build. An initial budget invocation omitted those flags and incorrectly expected the pricing changelog to redirect; rerunning in the matching environment passed without changing the budget or product code.
- Independent read-only reviewer: no remaining code findings or runtime blockers in the bounded diff. React checklist: shared timer cleanup and stable dependencies, existing design tokens/buttons, no new dependencies or waterfall, and request-level safety gates retained.

## Authorized live deployed-baseline checks

The founder authorized connected-Gmail testing and selected one specific sender for a single Unsubscribe-only submission. Visible account identity and exact provider labels were checked before mutations. Private addresses, message IDs, subjects and production screenshots remain outside git. No permanent deletion, email sending, broad cleanup or direct database writes were performed.

The candidate preview stack is not deployed. The following checks exercise the existing production action pipeline and recovery; they do not establish that the new candidate UI has completed a connected-provider journey.

- **Sender A, one email:** Archive → normal Undo, Delete with 180-day age → normal Undo, Later with Any age/default seven-day return → normal Undo. Each action changed only its intended Gmail labels; each Undo restored the exact baseline. Application counts reconciled. All six forward/reverse jobs completed with requested/affected counts of one. Later’s database timer cleared after Undo; the standing policy stayed neutral and no Keep was introduced.
- **Sender B, two emails in Screener:** Archive removed only Inbox; normal Undo restored both exact provider label sets. Activity records the reversal and standing policy/timer remain neutral. The sender remains marked reviewed and the pending Screener count remains one lower. This is existing durable “decide once” semantics, not full restoration of application review state. No production reset was made. Evidence: `outbox-consumer-router.ts` marks the decision, `db/predicates.ts` filters decided rows, label Undo does not clear it, and `score.worker.test.ts` explicitly preserves decided rows.
- **Sender C, three emails, selected by founder:** one Unsubscribe-only submission. The sender endpoint redirected ambiguously (`UNSUB_AMBIGUOUS_REDIRECT`); the delivery job failed and the durable UI/Activity outcome is **Result unconfirmed**. The intent job completing does not prove endpoint acceptance or stopped future delivery. No retry was submitted. All three Gmail label sets remained exactly unchanged. The durable unsubscribe/unconfirmed record is intentional test residue.
- Triage production was inspected without submitting a mailbox mutation. Those deployed-baseline checks did not include group or combined-Unsubscribe mutations; subsequent connected-candidate coverage is below.

Production access readback at 2026-10-20 14:54 UTC reported API `declutrmail-api-00849-cop` and worker `declutrmail-worker-00245-hq9` serving 100% traffic. At that checkpoint the local connected runtime was unavailable. The subsequent candidate verification below resolves that local-runtime limitation; it does not deploy the candidate.

## Connected candidate verification

The founder subsequently requested small reversible connected-Gmail tests before merge, explicitly excluding another attempt on the previously selected unsubscribe sender and keeping Autopilot separate.

The candidate at `37c3d6ee0be5937a8bd75817b7d63bcb6045af83` ran through the built-in browser, local Next/API, the real `LabelActionWorker`, application outbox consumer and Gmail. Existing encrypted local OAuth state was reused inside an isolated database clone. No cookies or plaintext tokens were exported. Production CORS/cookie restrictions were retained. A stale local Postgres PID file was confirmed to reference an unrelated process and moved aside before starting the existing service. Existing migrations were applied only to the task clone; the source and production databases were not written.

The temporary manual worker restricted Gmail mutations to three identified emails, then two after external interference was observed. No Autopilot, unsubscribe-delivery, watch, sync or scheduled-return consumers ran. Triage recommendations, the domain used to expose a Later group, Screener review rows and search prefixes were clone-only fixtures around the existing real message IDs. Message ages, count selectors and provider label operations remained real. Temporary names, domains and unsubscribe capability metadata were restored. The task API, manual worker, web server and dedicated Redis were stopped after verification; the isolated clone remains local for audit.

| Candidate entry point    | Connected verification                                                                                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Senders single           | Archive Any age, Delete Older than 180 days with Any age available, Later Any age/default seven-day return; normal Undo after each                                                                      |
| Senders group            | Archive, Delete and Later for exactly three emails; normal group Undo after each                                                                                                                        |
| Triage modal             | Archive, Delete and Later for one email each; normal Undo                                                                                                                                               |
| Triage remembered inline | Archive and Later at Older than 90 days; submitted age and affected count matched; normal Undo                                                                                                          |
| Triage groups            | Archive recommendation group and Later domain group, three emails each; normal group Undo                                                                                                               |
| Screener inline          | Archive; Delete default correctly blocked at zero Inbox matches, then included the one archived email after explicit opt-in; Delete Undo restored the archived baseline and Archive Undo restored Inbox |
| Screener Later           | Any age/seven-day return; a past return time disabled confirmation and was canceled; fresh valid confirmation and normal Undo completed                                                                 |
| Unsubscribe cleanup      | Senders single and two-sender groups for Archive/Delete, Triage Archive modal and Delete remembered inline; real Gmail cleanup followed by normal Undo, with sender delivery refused locally            |
| Screener Unsubscribe     | Future-only preview had no Email age and kept existing email in place; local delivery refusal displayed “nothing changed” and created no unsubscribe job                                                |

There were **22 cleanup confirmations and 68 completed forward/reverse child jobs**: Archive 28, Delete 20 and Later 20. Every child job requested and affected one email. Terminal job readback and Gmail labels established completion, independently of submission toasts. The final provider labels and local message mirror matched all three original baselines exactly. All three policies stayed neutral, protection unchanged, and Later timers cleared after Undo. No nonterminal task jobs remained.

One three-email Delete/Undo checkpoint initially failed exact restoration: a new `Unroll.me/Unsubscribed` label appeared on one email and Inbox was removed. The manual worker did not add this label, and the scoped production DeclutrMail read had no corresponding recent action. This indicates outside interference; it does not prove which external process acted. That email was excluded from further tests and restored once to its captured baseline. A later final provider read confirmed it still matched. This exceptional recovery is distinct from normal product Undo success.

Combined Unsubscribe uses synthetic capability metadata in the clone and a reserved `.invalid` endpoint, with `UNSUB_SEND_ENABLED=false` explicitly set and no delivery worker. Real cleanup completed with matching age/reach/count; the API refused unsubscribe before writing an intent, delivery job or policy. The UI honestly reported cleanup plus unsubscribe failure. There were **zero new unsubscribe database jobs and zero waiting, active or delayed delivery queue entries**. These cases verify combined cleanup, recovery and partial-failure handling, not real sender eligibility or successful unsubscribe delivery. The previously selected sender was never retried.

The initial CI journey lane had 35 passes and three failures from stale pre-redesign assertions. The bounded follow-up updates the Archive title/impact assertion and Unsubscribe action labels. The recent-email Delete seed now explicitly checks the 180-day zero-match block, selects Any age, verifies the two-email impact and asserts `olderThanDays: null` in the submitted request. Existing quota, persistence and recovery assertions remain. An independent read-only reviewer confirmed the revised assertions and the disabled-delivery safety boundary. Required CI must pass on the evidence/assertion follow-up; the PR head checks are the authoritative result. No merge has occurred.

## Remaining limits and review decisions

- A successful endpoint-accepted Unsubscribe journey was not demonstrated by the selected sender; the unconfirmed outcome must remain visible and must not be reported as success.
- Screener Undo restores email placement but retains the reviewed decision. A change to that product policy needs a separate decision.
- Missing age buckets stay unconfirmable; this pass exposes recovery rather than inventing/falling back to a count.
- Candidate cleanup → local API → real worker → Gmail verification is complete for the supported entry points above. Successful external unsubscribe delivery remains unverified; fixture capability and a send-disabled failure must not be reported as a successful real unsubscribe. Merge/deploy and production verification remain separate states.
