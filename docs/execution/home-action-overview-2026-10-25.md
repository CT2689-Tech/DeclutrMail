# Home Action overview — 2026-10-25

User approved the Action overview concept, real data, missing mailbox-wide aggregates, desktop/mobile verification, independent review, and normal-queue merge. This chat owns Home, the snapshot read, its shared contract and focused tests. No open PR overlapped these areas at branch creation. Integration owner: this Codex chat; no dependency PR. Existing shell, billing, workers, OAuth and Gmail action policies are excluded.

## Flow contract and sources

Home loads for the selected signed-in mailbox. It presents a maximum-three sender shortlist, current Inbox counts and 90-day marked-read evidence; review backlog remains visible alongside it. Only report-eligible, unprotected, non-Keep senders with positive current Inbox counts appear. The existing Unsubscribe + Archive pipeline refreshes its preview, focuses Cancel, confirms only on explicit action, and retains the shared terminal feedback/Undo owner. This change adds no mail-changing endpoint.

Results reuse the existing rolling `7d` and `all` Activity summaries. Confirmed Archive + Delete totals exclude completed Undo. Recent completed cleanup excludes in-progress, failed and undone rows. Automation state combines preset and sender-list rules; the pending count uses uncapped preset-buffer metadata and is labeled accordingly. Follow-ups, Brief and first review respect capabilities.

`GET /api/mailboxes/{id}/inbox-snapshot` authorizes workspace ownership, validates UUID input, and makes one read-only aggregate over all scanned inbound messages, independent of sender pagination and cached report facts. Inbox excludes Trash; received totals and estimated sizes include archived/Trash mail. Unknown size remains null; partial coverage is labeled. This is scanned metadata, not Gmail storage quota or bytes freed. No migration, new Gmail collection, processor, logging field, or analytics payload was added.

## State coverage

| State / transition                            | User-facing behavior                                                                                      | Verification                                       |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Loading / first scan                          | Loading/stage copy; no fabricated progress percentage                                                     | Unit, hydration                                    |
| Ready with first-review backlog               | Shortlist and review queue coexist                                                                        | Unit; local browser                                |
| Empty mailbox                                 | First-cleanup prompt; no achievement count                                                                | Unit; local browser                                |
| Returning with zero-Inbox candidates          | Neutral sender exploration                                                                                | Regression                                         |
| Independent read fails                        | Unavailable section; other work remains usable; results retry refreshes both windows                      | Unit                                               |
| Account switch / late response                | New mailbox keys; old counts/report/dialog disappear                                                      | Unit; local browser                                |
| Running / unknown / failed return / reconnect | Priority recovery; competing preview suppressed                                                           | Unit; local reconnect browser check                |
| Preview / cancel                              | Fresh matching scope, Cancel focus, focus returned to opener                                              | Existing live-dialog tests; desktop/mobile browser |
| Terminal action / Undo                        | Shared Activity invalidations refresh optional snapshot/receipt/sender facts without holding Undo's latch | Regression, held optional request                  |

## Evidence

- Local Home + Undo suite: 214 tests passed; inbox-report API suite: 15 passed. Final CI remains the authority for the full release suites.
- Repository typecheck and lint passed (six pre-existing unused-disable warnings). Production web build, all 49 bundle budgets, prerender checks passed.
- Negative controls failed as required: disabling the terminal invalidation observer; removing the snapshot mailbox predicate. Both were restored before positive verification.
- Real local PostgreSQL aggregate over 1,243 synthetic messages returned the same 1,243 Inbox/received/unread totals as HTTP/UI, with 1,240 known sizes. EXPLAIN showed one aggregate over the filtered scan; 0.640 ms execution in this tiny local fixture, not a production performance claim.
- Actual API session checks: owned response 200, unowned mailbox 404, unauthenticated 401. New controller test checks ownership before read, denied read, envelope and rate-limit metadata.
- Codex built-in browser: desktop 1280px and phone 320px; no horizontal overflow; mobile confirmation bounds 0–320px; initial Cancel focus and return focus verified. Light and dark lower sections remain readable. Browser logs contained no error entries.
- Independent API/architecture/privacy review: clear. Independent frontend/design/flow review: clear after terminal refresh, automation scope, returning copy and scan-indicator findings were fixed; independent rerun: 48 tests passed. Screenshot review found no desktop/mobile/dark visual blocker.
- [Desktop](../qa/home-action-overview-2026-10-25/desktop.jpg), [phone](../qa/home-action-overview-2026-10-25/mobile.jpg), [phone totals](../qa/home-action-overview-2026-10-25/mobile-totals.jpg). All captures contain synthetic fixture data from the real local app/API/DB.

No production mailbox was changed. Provider execution/restoration was not rehearsed: the local stack has no worker or Google credentials; existing provider/action contracts remain unchanged. No production deployment or measured conversion/retention improvement is claimed by this record. Trend charts and storage-savings claims remain excluded because these reads do not establish them.
