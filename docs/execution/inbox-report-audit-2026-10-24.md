# Inbox Report audit — 2026-10-24 PDT

## Flow contract

User intent: understand the active Gmail account’s scanned mail and identify senders worth reviewing. Home → open report on Senders → inspect snapshot/scope → review exactly the suggested sender IDs → use existing sender actions and their mandatory live previews → Activity completion/Undo → return to Senders. The report is available after initial scan readiness and is not evidence that email is unwanted.

This session is the integration owner on `codex/inbox-report-audit-20261024`, isolated from the user's existing checkout, based on main `4b57d8ed5`. Own report presentation, Home re-entry, report-to-guided-review handoff, focused tests/stories and this audit. Shared contracts are the existing report DTO and guided-review navigation identities; no backend, worker, database, pricing, permissions or collection changes are planned. Open PRs checked before editing; no observed overlap with these files.

Baseline: current-main source and the deployed public synthetic demo. The built-in browser reached sign-in for the authenticated app, so no live mailbox identity was available or inferred. Onboarding, billing, real-mailbox mutations, unsubscribe sending, production configuration and broad redesign are excluded. Synthetic preview cancellation is the smallest safe action test. Provider completion and real-mailbox Undo are not claimed from synthetic evidence.

Relevant states: first/return visits, dismissal/reopen, loading/error/retry, mixed historical/recent insights, fallback/empty, capped suggestions, report IDs outside loaded sender pages, stale data, current sender failure/protection, account switch, keyboard and phone layout. No report-only quota or destructive action exists; those states belong to the existing mandatory preview and action owners. Report review must never dispatch an action or widen the named sender set.

## Review

Summary:
The report mixes an orientation snapshot, cleanup recommendation and outcome celebration. It needs a clearer connection to the product’s sender-review workflow. Large aggregate numbers can dominate the useful decision, while their time scope and freshness are not visible enough.

Strengths:

- Server computes mailbox-scoped aggregates; ranking is shared with the synthetic demo.
- Suggested cleanup excludes Protected/Keep senders and senders the user has written to or already handled.
- Live cleanup counts come from the existing mandatory preview, rather than trusting the report snapshot.
- Reduced-motion and responsive container rules exist; report dismissal is per mailbox.

Risks & Concerns:

- P1: “Review them first” links to an unconsumed `fix` query. It does not identify the suggested set in the signed-in list. Fallback's “Show those senders” button has no handler. Review intent can silently become an unfiltered directory.
- P1: all lead insights are labeled “Last 90 days,” including all-history size, oldest year, sender concentration and current Trash. The basis count is all scanned inbound history even beside a 90-day percentage. No generated timestamp is shown.
- P2: Home's “Open report” points only to `/senders`, where the report may remain dismissed.
- P2: fewer than two eligible insights produces “Your inbox is in good shape,” even for an empty or insufficient snapshot; one eligible insight is hidden. Absence of threshold matches is not a health judgment.
- P2: report loading and initial errors disappear as `null`, although loading/error strings already exist.
- P2: fallback uses uncapped eligible count while actions hold at most 50 IDs. A CTA must name the actual review set.
- P1, follow-up investigation: backlog outcome conversion uses `requestedCount` as `archived` and can say “Archived” before the polled job completes. The related toast/Home paths share this concern; a terminal-result repair needs to cover that family together, including partial failure and unsubscribe outcomes.

Trade-offs & Alternatives:

- Recommended direction: a compact, dated snapshot with sender review as the primary path. Keep bulk cleanup as an explicit secondary preview after users can understand the set. This preserves the product promise of inspect → decide → preview.
- Retaining the prominent reveal requires equally clear per-metric scope, provenance, and actionable drill-down. Cosmetic polish alone does not repair the broken review handoff.
- Do not infer wanted/unwanted mail from read flags or predict categories. No threshold or protection-policy change is proposed.

Actionable Recommendations (Priority-Ordered):

1. Repair exact-set review, time scopes, honest fallback, re-entry and visible retry locally.
2. Reconcile report/Home outcome copy against terminal action and unsubscribe results as one bounded follow-up.
3. Decide the compact/review-first presentation. No new collection is required. Success: users can identify the snapshot date, interpret the denominator, open the exact sender set and leave it unchanged.
4. Later: explicit useful links for large-message/Trash insights and measured review completion. Current report is not a storage-reclamation tool; do not imply an Archive frees space. New analytics require separate design and consent review; no mailbox content should be logged.

Next Steps:

1. Implement and verify the bounded repairs above, using synthetic data.
2. Independent final-diff review; record concrete evidence and limitations below.

## Repairs and verification

Implemented:

- Recent, historical and Trash insights each show their own scope; the basis explicitly says scanned emails. A localized generated timestamp identifies the snapshot, without server/client date mismatch.
- Full and fallback review hand off exactly the report IDs to the existing Guided Review owner, including IDs outside the loaded/filter results. Current detail reads and mandatory action previews remain authoritative.
- Fallback copy reports suggestions without declaring inbox health; its CTA count uses the capped ID set. A standalone panel without a review owner links plainly to the sender directory.
- Home’s resolved header, report card and loading-shell entry all deep-link to the expanded report. Close removes the anchor so dismissal remains useful. The anchor has an offset for sticky chrome.
- Loading and errors stay visible with polite status and a distinct Retry report action. Buttons have 44px minimum height, hover and keyboard focus treatment.
- “Up to 10 senders” replaces “just 10” because a mailbox with fewer than ten senders can qualify. Thresholds/ranking are unchanged.

Evidence:

- Independent reviewer inspected the complete diff, adjacent states, exact-set navigation, account isolation, copy and regressions; no blocking findings. Follow-up reviews also covered polite errors, Home loading-shell links, anchor offset and small-mailbox wording.
- Two focused regressions fail against the original panel: per-insight time scopes and a working capped fallback CTA. They pass with this repair. Temporary baseline test files were removed.
- Focused report/Senders suites: 227 tests pass, including off-page suggested IDs and no action dispatch. Home sibling suites passed in the earlier combined run; final Home/loading/hydration/layout run passes 36 tests. Shared selection/presentation/deck run passes 42 tests; the final copy/presentation run passes 32 tests, and the final panel run passes 23 tests. Workspace typecheck passed for all packages; the repaired web typecheck passed again. Workspace lint passes with six existing unused-disable warnings elsewhere.
- Built-in browser: public synthetic demo at 1280px and 375px; scope/date labels render, report closes/reopens by keyboard, preview cancellation returns focus, all report buttons are at least 44px high, and there is no phone horizontal overflow. No console errors observed.
- Built-in browser: signed-in disposable account on localhost. Home reopened a previously dismissed report. The full report opened exactly its one suggested sender in Guided Review. Repeating while the list was filtered to another sender still loaded the correct suggestion’s authenticated detail. After synthetic facts produced the fallback, Show that sender opened the same review. A second empty synthetic mailbox displayed zero scanned emails/no suggestions and removed the first account’s report; its 375px layout had no horizontal overflow. No mail-changing action jobs were created after the smoke began.
- No provider worker, Gmail credentials, purchases, real-mailbox changes, new telemetry or production configuration changes were used. The only account preference changes were inside the disposable synthetic workspace. The disposable API/web processes were stopped after verification. Docker temporarily became unavailable during cleanup; after its daemon returned, both audit containers were removed. No test data or real-mailbox residue remains.

Verification limits and tooling:

- The public production app reached sign-in, so live-mailbox behavior was not observed. Preview cancellation is not provider execution/Undo proof.
- Storybook reached its preview but failed with `Unexpected identifier 'assert'`; isolated story visual verification is unavailable. The same report rendered through the local Next app instead. Storybook fixtures remain for review.
- The disposable API initially failed because the sanitized launcher lacked a usable SWC native-addon cache. A temporary launcher outside the repository supplied an explicit trusted cache root; no credentials or broader environment were inherited and no harness code is changed in this PR. An initial migration attempt preceded database readiness and failed; the subsequently completed migrations and successful seed are separate evidence. An HTTP 127.0.0.1 browser session lost client authentication; the standard localhost origin succeeded without authentication-code changes.
- Production web build, 49-route bundle budget and prerender checks pass. Remote CI, merge queue, deployment and production readback remain separate. No PR is merged or deployed at this checkpoint.

Deferred priorities:

1. **Outcome accuracy:** reconcile report/Home/backlog feedback with terminal provider results, partial outcomes and durable Undo. The existing requested-count celebration is a separate cross-surface defect; this patch does not claim to repair it.
2. **Product hierarchy:** favor a compact snapshot and sender review over a large reveal/bulk action. The optional design question remains unanswered; no wholesale redesign is included. The minimal repairs are useful under either presentation.
3. **Insight usefulness:** suppress trivial concentration/zero-people highlights on tiny or incomplete histories, distinguish current Inbox from all scanned history more directly, and add supported evidence drill-downs. This requires a ranking/coverage decision; do not silently alter thresholds or collect new data.

Review lenses: the flow-audit runbook, SaaS reviewer, React checklist and [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md). Product conclusions above are grounded in repository queries and browser observations, not a usability study or measured conversion outcome.

## Integration handoff

Owner: this Inbox Report audit session. Dependency: none. This patch does not change outcome polling or sender eligibility policy. Review and follow-up review found no blockers. Readiness requires remote required checks; merge through the normal queue under the user’s standing merge authorization. Deployment and live-mailbox verification must not be inferred from the local browser evidence above.
