# Single-sender Unsubscribe + Delete audit — 2026-10-14

## Flow contract and scope

Founder-primary Gmail account, matched to the visible signed-in application and the connected Gmail account. Inspect the existing production action without sending another unsubscribe, moving mail, triggering sync, or undoing the user's cleanup. Onboarding and billing are excluded.

The story is sender action → preview count and reach → confirm once → independent Delete and unsubscribe execution → truthful results → persistence after reload → existing Activity/Undo recovery. The row stays in its original position while the result is pending, partial, or uncertain, with fresh current-mail counts and unsubscribe status. Following the founder’s October 15 choice, a confirmed completed action plus a fresh zero inbox/archived count removes it from Cleanup immediately. Positive remaining counts keep the sender visible. This hides the row; it does not erase sender history, policy, or Activity/Undo. Changing search/filter/sort/mailbox releases retained rows.

This session owns the Senders retention hook and pinning changes, the shared submission-feedback selector, its Senders/Detail/Triage callers, regression tests, and this record. Integration owner: this Codex chat. No dependent PR, API/worker contract change, migration, provider permission change, or production mailbox test mutation. Base reviewed: `1f4e8127` from freshly fetched origin/main.

## Production evidence

Read-only inspection of the action/audit records and direct Gmail minimal-message reads, around 23:37 PDT on October 14 (06:37 UTC October 15):

| Check                            | Observed result                                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Delete request                   | One forward action, 21 requested, 21 affected, 21 unique resolved Gmail message IDs, `all_mail` reach, no time cutoff    |
| Delete completion                | Done at 23:37:44.196 PDT; no action error                                                                                |
| Actual Gmail                     | Each of the 21 IDs read individually: all carry TRASH, none carry INBOX                                                  |
| Remaining sender mail            | Gmail search outside Trash/Spam returns zero; application current-mail predicate also returns zero                       |
| Unsubscribe                      | One execution action; endpoint accepted at 23:37:44.755 PDT; separate intent/idempotency record is not another execution |
| Bytes moved                      | Gmail size estimates total 1,790,887 bytes, exactly matching the selected-message database total                         |
| Screenshot's approximately 84 MB | 83,653,442 indexed bytes across 565 historical sender messages, rather than the 21 selected current messages             |

The result is 21 messages moved to Gmail Trash, about 1.8 MB. This is recoverable Trash movement, not permanent deletion or immediate freed storage. Endpoint acceptance proves receipt of the unsubscribe request, not that future delivery has stopped. The action happened before this audit; no new real Gmail actions were performed.

Local Cloud Run log reads initially failed because Google authentication required reauthentication. The prescribed automated WIF fallback succeeded in [run 38693969260](https://github.com/CT2689-Tech/DeclutrMail/actions/runs/38693969260): API `00791-wos` and worker `00220-d5q`, each serving 100%, snapshot observed at 06:42:10 UTC. That workflow supplies serving metadata, not arbitrary logs.

After the founder completed the built-in browser's Google verification, Logs Explorer returned five entries for the exact 23:37:35–23:37:50 PDT interval and the relevant endpoint/workers:

- One `POST /api/actions/unsubscribe-backlog`: HTTP 201, 2,078 ms, logged at 23:37:43.549.
- One LabelActionWorker start at 23:37:42.643 and success at 23:37:44.836: attempt 1, duration 2,193 ms, `affectedCount: 21`, `alreadyDone: false`.
- One UnsubExecutionWorker start at 23:37:43.527 and success at 23:37:45.025: attempt 1, duration 1,499 ms, endpoint `httpStatus: 200`, `alreadyDone: false`.

The two jobs share the same pseudonymous mailbox reference. Their timing/results agree with the existing action/audit records and direct Gmail verification. No duplicate execution or retry appears in that bounded interval. Logs Explorer displayed default-scope/visual-editor warnings, but the text query and relevant log entries/results rendered successfully; this does not certify the entire Cloud dashboard. Browser verification did not refresh local CLI credentials.

## Findings and repairs

1. **P1 — retained row facts become stale.** The list excludes a sender with no current mail, while the UI reinserts its old snapshot indefinitely. The screenshot can therefore show `Requesting…`, 21 current emails, and a confirmed Delete 21 at the same time. Preserve position until confirmed zero current mail, and hydrate missing single-sender rows through the existing detail query. Continue a two-second read only while its unsubscribe remains requested; this also handles completion invalidating an initial GET that TanStack joins rather than refetches. Stop pending reads on terminal/error states and release them with the existing list/mailbox scope.
2. **P2 — overlapping submission/completion feedback.** A watched one-click request plus Delete emitted a submission toast saying `Unsubscribe requested · Deleted 21 emails`, then a terminal unsubscribe toast, alongside the move's existing Undo feedback. The submission response contains requested count, not terminal affected count. Suppress that redundant toast for a single watched one-click request paired with a move. The actual unsubscribe outcome and existing move/Undo feedback remain. Apply the selector consistently to Senders, Sender Detail, and Triage; manual instructions, skips and failed submissions retain their existing feedback.
3. **P2 — initial refresh can outrun row retention.** A fast post-confirm refetch may exclude the sender before terminal processing captures its row. Save the position on enqueue acknowledgement, independently of action phase. This avoids leaving Protected skips permanently working.
4. **Zero versus partial cleanup.** Start a new detail-query generation after observing completion, so cached zero counts and pre-completion reads cannot justify removal. Remove a completed row only when that new successful read confirms both current counts are exactly zero. A time-limited cleanup leaving messages keeps the sender with its measured remaining count; requested/affected totals are not used to infer that count. Failed/unconfirmed actions and unreadable counts retain the row. Keep independent unsubscribe observation and terminal feedback alive even after the row disappears. Undo releases completed retention and the existing current-mail list can show restored mail.
5. **Failure honesty.** TanStack retains successful data after a failed refetch. Check the error before cached data; a missing retained row with failed refresh no longer claims old counts as current or an old request as ongoing. Historical volume and the independently confirmed action result remain.

## Verification

- Full Senders-screen regressions drive an archived-only preview → explicit Inbox + archived reach → Delete confirmation → independent results. Full cleanup deletes 21 and removes the zero-current row; a 30-day cutoff deletes 14 and retains 7. Both assert the actual submitted reach/cutoff and the independent terminal unsubscribe announcement. Replacing the repaired screen with its base version makes the test fail on the extra submission toast. Restoring the repair passes.
- Hook tests cover list truth winning without extra reads, scope release, zero/partial/unconfirmed count rules, restored/new current mail, cached-data refresh failure, the invalidated initial-read race, and avoiding bulk detail fan-out.
- A composite Protected-skip regression waits for the terminal action read before checking the row is not busy.
- Independent reviewer applied the design-system gate and correctness/failure/performance review. Three issues discovered during review were repaired. Independent hook/pinned/toast run: 35 tests passed; no remaining implementation blocker for the single-sender flow.
- The initial, pre-policy built-in-browser smoke used the real Next.js runtime and synthetic client API responses: zero inbox + 21 archived → explicit Inbox + archived preview → Delete 21 → retained zero current mail → independently completed request → Request accepted without reload. The submission produced no extra completion toast. Evidence screenshot is local and synthetic; no private screenshot is committed. The local process and checkout identity were verified.
- Storybook's temporary full-screen harness hit an import/assertion syntax error in that runner; the browser smoke was completed through Next.js instead. No new render component is introduced, so no new Storybook component story is required.
- Updated policy smoke ran against a production Next.js build in the built-in browser with synthetic API responses: archived-only 21 → Delete all → row disappears after a post-completion zero read → terminal unsubscribe feedback remains. The persistent Undo tray stayed available; Undo restored the row to 21. A separate 30-day cutoff preview deleted 14 and kept the sender showing 7 current mail, Request accepted, and Deleted 14. Temporary fixture removed before the final clean build.
- No real provider mutation/Undo restoration was rehearsed: production access stayed read-only. Synthetic Undo verifies the UI lifecycle, not a Gmail restoration.

Final check counts and PR/integration state are recorded in the PR rather than inferred from this document.

## Deferred opportunities and limits

- **P2 — align displayed size with current-mail scope.** The approximately 84 MB number is historical indexed volume, while the adjacent count is current mail. A useful follow-up would explicitly label historical size or return a current-scope size from the existing metadata. No additional Gmail data is needed. Acceptance: a 21-current/565-historical fixture cannot suggest that deleting 21 clears all historical bytes.
- **P2 — bulk retained-row facts.** Bulk rows retain baseline behavior. This fix deliberately enables individual detail reads only for single-sender actions; issuing up to 1,000 detail GETs after a bulk cleanup is inappropriate. A bulk repair should provide bounded aggregate refresh plus per-sender truthful outcomes. Mixed failures/skips must remain visible and must not be inferred from aggregate affected count.
- **P3 — combined outcome presentation.** A single compound receipt could name both endpoint acceptance and Delete/Undo. The bounded repair removes the redundant submission announcement while retaining the distinct outcomes. The founder explicitly approved the zero-current removal rule on October 15; the prior position-retention rule still applies to pending, partial, and uncertain outcomes.
