### 2026-09-27 — Decide whether Autopilot suggests unsubscribing from senders already unsubscribed
**Source:** PR #802. Defect-class sweep of the Autopilot pending count, verified in code.
**Why:** Watch-first Unsubscribe rules still suggest senders that already
carry an unsubscribe (`sender_policies.policy_type = 'unsubscribe'`).
- They appear in the list and in "Approve all ~N", in the day-7 prompt, and
  in "Would have requested unsubscribe from N senders".
- Approving one says "Approved", then the action worker drops it silently
  (`skippedAlreadyUnsubscribed`, no Activity row).
- The Active sweep and the turn-on preview already leave these senders out.
  Only the Watch-first queue offers them.
**How:** Reply with (a) or (b).
- (a) *Recommended:* stop suggesting them. Skip them when the Watch-first
  sweep writes suggestions, as the Active sweep already does, and leave
  existing ones out of the list and counts. This matches what already
  happens when an approval runs.
- (b) Treat "still emailing after an unsubscribe" as a reason to send the
  request again. This widens an irreversible verb (D58) and needs its own
  preview wording.
**Verifies by:** For (a), the list, counts and approve all exclude these
senders. For (b), approving one sends a request and writes an Activity row.
**Status:** Open
