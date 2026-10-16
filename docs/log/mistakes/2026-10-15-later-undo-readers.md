# Later readers must participate in action and Undo refreshes

**Observed:** Sender counts updated, but the separate `snoozed` list/recovery cache did not. A warmed Later screen could omit newly moved mail or retain an undone row and warning until its periodic poll. Activity's direct action-only Undo had the same omission outside the shared status hook.

**Repair:** Include the canonical Later prefix in terminal-action reconciliation, confirmed global/report Undo refresh and Activity Undo settlement. Refetch active readers and stale inactive readers; preserve existing status, scope and polling semantics.

**Enforcement:** Four warmed-reader assertions fail before repair and pass after it, including real Later screen/alert output and Activity success/partial failure. Full page/pane/list lifecycle tests assert Inbox/archived counts and eligible controls without reload rather than manually invalidating cache. Independent review sweeps all completion readers, including transports that bypass the shared hook.
