# Launch readiness audit — 2026-09-22

Branch: `claude/product-simplification-ideas-5a8515`. This is a candidate review, not a production-release assertion. The founder will test the branch before merging. No deployment, live payment, real-mail cleanup, support email or launch announcement was performed in this pass.

## Delivered in this pass

- Support requests are durably queued for the credentialed worker. HTTP 202 and the form acknowledge receipt, not delivery. See [support delivery](../runbooks/support-delivery.md).
- Unsubscribe guidance distinguishes requests, drafts and historical cleanup. Official competitor sources and uncertain claims were refreshed. See [content evidence and unpublished release note](release-note-draft-2026-09-22.md).
- `/pricing.md` declares `noindex, follow` and points its canonical Link header to `/pricing`.
- The homepage and four key guides include an interactive, explicitly illustrative Inspect → Preview → Result → Undo walkthrough. It uses made-up data and native keyboard controls without another client runtime. It is not a recording or evidence of real Gmail behavior. A real-product recording remains a launch asset to capture with a controlled inbox after final acceptance.
- The E2E harness uses isolated synthetic services, with explicit coverage and execution-count assertions. See [setup and coverage](../../packages/e2e/README.md). A prepared suite is not an executed suite.
- Marketing context, the founder checklist and operating runbook now distinguish current repository facts from historical/live operational evidence.

## Access-dependent checks

| Check                  | Observation in this pass                                                                                                                                         | Remaining acceptance                                                                                                                                                                                      |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google Search Console  | The authenticated browser returned “you don't have access” for `sc-domain:declutrmail.com`.                                                                      | Open that property with an authorized account. Inspect sitemap processing and indexing/canonical results for homepage, pricing, key guides and comparisons. Do not infer indexing from HTTP 200.          |
| Bing Webmaster Tools   | Public sign-in screen; no authenticated property data.                                                                                                           | Open the verified property and inspect sitemap/indexing results.                                                                                                                                          |
| PostHog                | The connector's required `learn` command is unavailable; skill discovery also reports missing `llm_skill:read` permission. No project event query was performed. | Repair connector authorization, load its required skill and verify the DeclutrMail project, recent consented events and funnel freshness. Do not equate a reachable JavaScript asset with event delivery. |
| Operational dashboards | No new dashboard was created or declared usable.                                                                                                                 | Open each exact shared URL in the intended account and verify panels and freshness under AGENTS.md.                                                                                                       |
| Support delivery       | Queue/worker behavior is covered with controlled tests.                                                                                                          | A release owner must verify inbox receipt, Reply-To and terminal-failure alert delivery using the controlled runbook.                                                                                     |
| Payment/OAuth/Gmail    | No provider transaction or real-mail mutation was performed.                                                                                                     | Follow the existing sandbox-first billing sequence and controlled test-inbox acceptance checklist.                                                                                                        |

## Measurement acceptance

Use the existing consent-gated event catalog; do not add mailbox content, recipients or message text to telemetry. Verify a declined session is silent, an accepted session appears in the intended project, and withdrawal stops capture. Confirm `action_confirmed` after server acceptance across Triage, Senders, inspector, Screener and Brief; it does **not** prove the worker finished. Use Activity outcomes for completion and failures.

The primary activation measure is a connected mailbox followed by a real previewed cleanup. Keep first-touch attribution through OAuth and self-report as separate dimensions. Count signups and paid outcomes from first-party records; optional analytics may undercount non-consenting users. Store a timestamp, selected date range, project and observed result for each verification rather than an undated checkbox.

## Observed beta protocol — prepared, participants not yet tested

Run five individual sessions with people who have not seen this redesign. Use a controlled inbox with known messages and authorized actions. Do not collect session recordings or mailbox screenshots by default. Record task outcomes and points of confusion without email contents.

1. Ask what the product does and what connecting Gmail permits, before explaining it. Record misconceptions.
2. Ask them to locate one noisy sender, inspect its recent mail, change a filter and return to the list. Record whether the right panel and filter scope are discoverable.
3. Ask them to select two senders and describe the preview's age, Inbox/archived scope and protected exclusions. Cancel first; execute only the agreed safe test action.
4. Ask them to explain Unsubscribe versus removing old mail, including the Gmail-draft case. They should identify which part cannot be undone.
5. Ask them to find the completed action and restore the controlled test mail. Check the actual mailbox state, not only a toast.
6. Ask what their current plan includes, how many inboxes it supports, what an upgrade would cost now, and where to get help. Stop before any payment.

For each task record: participant code, device/width, completed unassisted/with help/failed, observed hesitation, expectation versus actual result, severity and linked fix. A confident misunderstanding of scope, payment or recovery is a launch blocker even if the button technically works. Repeat failed tasks with another participant after fixes. These five sessions are qualitative feedback, not a conversion-rate estimate.

## Scope retained after launch

Storage-by-sender ranking remains a separately scoped enhancement; it requires trustworthy byte coverage and clear unknown/estimated states. Region changes and large-list virtualization remain measurement-led. The current launch pass does not make performance percentage claims or introduce a new feature family.

## Candidate verification and independent review

Three fresh reviewers independently inspected the branch against fetched `origin/main` (`2b3a249`), including this pass's working changes. They covered backend/worker/privacy contracts, frontend/design/content/billing paths, and cross-system state/CI/environment isolation. This was a risk-based review across the branch, not an assertion that every line or runtime state was exercised. Billing webhook handlers and migrations were unchanged against that base.

Seven confirmed P2 findings were fixed:

1. Support requests could wait through an initial Redis outage and enqueue after the caller stopped waiting. The producer now rejects before accepting work while unavailable; a real connection-recovery test proves rejected requests do not appear later.
2. The sender list and inspector owned separate pending actions. They now share preview, enqueue, polling and feedback. Integration tests cover both directions, switching inspector senders, and terminal unlock.
3. Bulk previews counted retained protected senders twice. The count now distinguishes exclusions upstream from senders included in the live preview.
4. The account-data deletion phrase field suppressed its keyboard focus indicator. The shared visible outline is restored.
5. Overview totals were outside the Activity invalidation family and could stay stale after cleanup or global Undo. They now refresh with Activity; three mounted-query regressions demonstrate the fix.
6. Local E2E app startup could inherit real dotenv credentials despite synthetic test guards. A dedicated launcher now uses sanitized child environments and temporary app copies with independent Next output.
7. Database/Redis URL query options could bypass the test target checks. The isolation guard now rejects query/fragment overrides; the PostgreSQL issue was reproduced with a harmless `current_database()` read before fixing it.

Verification on the reviewed changes:

| Check                                      | Result                                                                                                                                                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Full web suite                             | 241 files, 2,982 tests passed. Two stale content assertions found in the first run were corrected before the complete passing rerun.                                                                   |
| Full API suite                             | 131 files, 1,869 passed, 14 skipped.                                                                                                                                                                   |
| Full worker suite                          | 62 files, 997 passed, 1 skipped. Later support connection/transport tests also passed independently.                                                                                                   |
| Shared and database suites                 | 667 shared tests and 100 database tests passed.                                                                                                                                                        |
| Real PostgreSQL checks                     | 9 cleanup reservation tests and 14 outbox tests passed on separate disposable databases, including normally environment-gated concurrency checks.                                                      |
| Support real queue/worker smoke            | Real ephemeral Redis and BullMQ, fake delivery adapter only: accepted job, `worker.started`/`worker.succeeded`, correct recipient/Reply-To, completion and removal of payload verified. No email sent. |
| Isolated support API smoke                 | Authenticated synthetic request returned HTTP 202 with `data.status=accepted`; exactly one job appeared in the dedicated queue. No mail worker/provider was running.                                   |
| Harness contracts                          | 21 passed, including target isolation, sanitized launch and nonzero journey-report guards.                                                                                                             |
| Type checks and lint                       | Repository type checks passed. Lint: zero errors, seven existing unused-disable warnings.                                                                                                              |
| Production web build                       | Passed. All 52 existing JavaScript route budgets passed; all 45 expected public routes prerendered.                                                                                                    |
| Production-mode alternate pricing response | Local HTTP 200, `X-Robots-Tag: noindex, follow`, canonical Link to `https://declutrmail.com/pricing`, Markdown content type.                                                                           |

Manual CUA browser evidence used a synthetic mailbox on dedicated PostgreSQL/Redis services. Verified sender inspector navigation; Archive preview and cancellation; protection persistence across reload and reversal; bulk protected exclusions, zero-result age filter and widened Delete preview; Triage Keep persisting across reload and recorded in Activity; Brief's current-inbox count and cancellation. After applying reviewer fixes, repeated the bulk preview and verified exactly one protected sender was reported. An inspector Archive queued only in the disposable stack locked both list and pane, and remained locked after switching away and back; no Gmail worker was running. Completion/unlock has integration-test evidence, not a claim of provider execution. No browser console errors were observed in that final interaction.

The public walkthrough was checked through all four steps and keyboard arrows on the homepage and a key guide. The browser's requested narrow viewport did not take effect (the DOM remained 1,270px wide), so this pass does not claim a new mobile browser result. The existing responsive CI lane remains required.

The configured browser suites were not executed by a separate automation runner in this session; CUA was used for the manual checks above. CI's complete browser result, true provider-backed Archive/Undo, OAuth, payments, production delivery, authorized analytics/indexing access and observed beta participants remain explicit acceptance gates. Earlier experience/performance audit evidence retains its original revision and scope.
