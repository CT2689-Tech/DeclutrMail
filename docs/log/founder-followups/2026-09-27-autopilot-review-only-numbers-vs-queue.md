### 2026-09-27 — Decide what the two review-only Autopilot numbers promise
**Source:** PR #802. Defect-class sweep of the Autopilot pending count, verified in code.
**Why:** The review-only rules are "Review low-engagement senders for
Archive" and "Review new senders for Later". Two of their numbers describe
a different set from the queue "Review all" acts on.
- **The digest line.** The line reads "N senders matched in the last 7
  days · M emails could be archived if you approve them". It counts only
  senders matched in the last 7 days. "Review all" approves every pending
  suggestion of any age. The queue never refreshes a suggestion's match
  date, so after the first week most of it is outside M.
- **The turn-on headline.** "N senders ready for review" counts matched
  senders that have Inbox mail. The Watch-first sweep also suggests matched
  senders with no Inbox mail, so the queue is larger than promised. Approving
  one of those logs "archived 0".
**How:** Reply with a choice for each.
- **Digest line.**
  - (a) *Recommended:* count M over the pending queue, so "if you approve
    them" is exactly what "Review all" moves.
  - (b) Drop "if you approve them" and state only what matched this week.
- **Headline.**
  - (a) *Recommended:* the Watch-first sweep stops suggesting senders with
    no Inbox mail for Archive and Later rules. This is the same check the
    Active sweep applies, so the queue matches the headline and "archived 0"
    rows stop appearing.
  - (b) Count every match in the headline instead.
**Verifies by:** Tests pinning that each number equals the set its action
acts on.
**Status:** Done 2026-09-29
