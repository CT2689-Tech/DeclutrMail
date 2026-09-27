## 2026-09-27 — Autopilot `pendingTotal` counted suggestions on Protected senders

**PR:** #802 (https://github.com/CT2689-Tech/DeclutrMail/pull/802)
**Caught by:** defect-class sweep during PR #791, confirmed by a failing test and live on the dev DB
**What happened:** #715 added the Protected-sender exclusion to the pending
list and both approve UPDATEs in `autopilot.read-service.ts`, but not to the
Observe digest's `pendingTotal`, a fourth inline copy of the same
"pending suggestion" predicate. `pendingTotal` feeds "Review all ~N" /
"Approve all ~N" once the list hits its 50-row cap, and the day-7 prompt's
`> 0` gate, so both counted suggestions that approve skips. Live on the dev
mailbox with one sender Protected, `pendingTotal` was 39 and the list was 38.
The same function's `inboxMessagesNow`, documented as "what a sweep now would
act on", also counted the Protected sender's 69 inbox messages. Its
`senders7d` counted the sender itself, and the unsubscribe presets render that
number as "Would have requested unsubscribe from N senders". One function
away, the "Approve selected" toast reported the selection size, not the
server's `approvedCount`, so a skipped Protected match still read as approved. #715's test
for the list asserted the list only. Its sibling test for stale senders
asserted both the list and the counter, which is how that exclusion reached
the count and this one did not.
**Correct approach:** Define the predicate once and have the count, the list
and the action all use it. It now lives in
`packages/db/src/autopilot-suggestions.ts` (`ruleMatchIsOfferableSuggestion`,
`ruleMatchIsPendingSuggestion`, `ruleMatchSenderIsProtected`). Every surface
that shows, counts or approves a suggestion goes through it, and so does the
approve's own `skippedProtectedCount`.
**Rule:** When a guard is added to a predicate that is spelled inline at N
sites, move the predicate into one shared definition in the same PR. Then
assert count == list == action in a single test.
**Enforcement update:** none. A hook cannot prove that two SQL predicates
match, so the shared function is the enforcement.
