# Senders header and current Inbox impact

Owner: Codex, this chat. Isolated branch `codex/senders-clarity-production`, based on `726ac77e34d73f8da137ff476f991e9d4b6029e1`. No feature dependencies. Shared presentation files: Senders screen/workspace/filter shortcuts, collapsed Inbox Report entry/panel/styles, and Triage focus card. No API, worker, migration, entitlement, provider or action-owner changes.

## Approved scope and flow contract

Implement the selected compact prototype in the production components. Returning users can find senders sooner, and Suggested Guided Review distinguishes current Inbox stock from historical received volume. Keep the real shell, native detail view, selection/filter scope, review queue/navigation and action lifecycle.

Discovery → sender or review → existing action entry → mandatory preview/confirmation where applicable → existing accepted/pending/result reconciliation → existing recovery/Undo. Keep, Archive, Unsubscribe, Later and Delete remain owned by their existing handlers. Protected exclusions, quota, offline/unknown handling and account isolation remain authoritative. Current Inbox count comes from the existing optional `TriageDecisionRow.inboxCount`; absent is unavailable, explicit zero is clear. Historical received volume is secondary, always labelled with its 90-day window. No new measurement/query or recommendation/eligibility policy.

Needs first review and sender detail are regression siblings, not redesign targets. Expanded Inbox Report and its action flow remain unchanged. First-run/loading/error/account-switch/busy/preview locks stay in existing owners. Billing, onboarding, provider mutation and real mailbox testing are excluded.

## Implementation

- Align title/review entry on desktop, remove repeated introduction and general Trash note from the directory header, make the matching sender total a compact summary and simplify filter shortcut labels on phones while retaining full accessible labels and touch targets.
- Quiet the dismissed report only. Keep report reopen/close state and expanded panel/action callbacks intact. Its existing entry occupies the phone title row while collapsed.
- In guided focus cards, show current Inbox count first, 90-day received count second, zero-Inbox explanation and a distinct unavailable state. Compact identity/spacing bring the existing toolbar forward. Standalone Triage facts are unchanged.
- Independent reviewer identified inline-size containment as a mobile report sizing risk. Compact dismissed entries now use `container-type: normal`; expanded report keeps its container queries. Re-review found no remaining actionable code issues.

## Verification status

Independent reviewer: 7 focused files / 113 tests passed before the machine crash; action owners, callbacks, preview gates, protection, Undo, sender detail and review lifetimes unchanged. Integration owner had also obtained 10 files / 465 tests passing before the crash. Temporary logs/services were lost in the crash; fresh build and verification are being collected in the task worktree's parent directory.

Fresh local verification: 11 files / 468 tests passed with one worker; scoped ESLint, web typecheck and formatting passed. The initial post-crash overlapping test run was interrupted after two timing failures under contention; the complete serial run passed without source or threshold changes.

The synthetic browser production build compiled and validated successfully. Its explicit API URL makes a pre-existing comparison page dynamic, so the budget harness cannot choose a prerendered `/vs/[competitor]` path and probes a deliberate 404. A separate build with the CI marketing configuration (no public API URL) passed the full route budget and prerender checks: 49 measured routes within budget and two declared redirects verified. No budget caps or harness code changed. The browser runtime uses an isolated copy of the completed API-backed build, with disposable PostgreSQL/Redis, fixed synthetic account and no worker/provider credentials.

Built-in browser walkthrough completed 24 October against the isolated API-backed production build:

- Desktop 1280×720, light and dark; 320×760 light phone and 390×844 dark phone. No horizontal overflow; one main landmark on inspected views.
- All senders compact header, live search, selection and native detail layout verified. Matching sender count/scope and Protected exclusions remain intact.
- Mobile report entry measures approximately 90×44px, fully inside the viewport. Reopen/close preserves the existing expanded panel, without overflow.
- Suggested Guided Review shows 2 current Inbox emails versus 191 received in 90 days; the next sender shows explicit 0, its Inbox-clear explanation and 191 historical emails. Previous/Next/Finish retain their existing behavior; navigation buttons measure 44px high on phones.
- Archive preview resolves 2 eligible emails; Delete's existing 180-day default shows zero matches and disabled confirmation; Later retains its return-time control and 2-email preview. Open previews lock review navigation. Each preview was cancelled; no mail-changing confirmation or Keep/Unsubscribe was submitted.
- Selected review uses its existing native card/action owner. Native sender detail and Back to Guided Review preserve position 2 of 2, and returning to All senders preserves selection. Clear restores the directory.
- Needs first review opens its unchanged accordion, evidence and action controls at 320px. Unsubscribe remains gated by the existing method data (the synthetic senders have no checked method); unit suites cover that action path.
- Final browser warning/error log was empty; viewport override reset. Database readback remained Fresh Finds 2/191 and Meadow Lane 0/191. All 50 action jobs were the fixture's pre-seeded quota rows; no new mail action was recorded.

No actual emails changed. Synthetic checks do not establish Gmail worker execution or restoration; those mechanisms remain covered by their existing API/worker suites. Integration and current CI/queue/release state are tracked in [PR #1112](https://github.com/CT2689-Tech/DeclutrMail/pull/1112). Browser captures are under the local visualization directory `2026/10/24/senders-clarity-production/`.
