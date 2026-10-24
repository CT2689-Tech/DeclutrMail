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

Desktop/mobile production-build walkthrough is pending: the built-in browser connection closed during tab creation; reopening was requested. CI/queue and release status are pending. No actual emails changed. Synthetic checks do not establish Gmail worker execution or restoration; those mechanisms remain covered by their existing API/worker suites.
