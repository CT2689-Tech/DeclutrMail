# Cleanup action feedback

The Senders cleanup screen shows senders with current inbound email in Inbox
or archived, including mail moved to Later. Trash, Spam, drafts, chats and
outbound-only mail do not keep a sender in this list. The API's explicit
`current_mail_only` filter leaves policy management and sender history available.
Historical received volume keeps its existing meaning; it is not a current-mail count.
No separate Trash view or permanent-delete action is introduced.

| State / transition                           | UI shows                                                                                     | Cache effect                                                       | Coverage                                |
| -------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------- |
| Action accepted, still running               | Existing progress notification; duplicate dispatch guarded                                   | No optimistic card removal                                         | Existing action lifecycle tests         |
| Delete completes; no current mail remains    | Sticky result with actual count, sender, Undo when available, Activity link; card disappears | Refresh list and counts                                            | Read-service and screen lifecycle tests |
| Archive or scoped Delete leaves current mail | Result confirms the affected count; sender stays                                             | Refresh list and counts                                            | Read-service test                       |
| Partial result / failed job                  | Partial or failed receipt; affected count retained                                           | Refresh even when a job fails, since some changes may have applied | Receipt and terminal-hook tests         |
| No matching mail                             | Nothing to change; no fake success or Undo                                                   | Refresh current counts and previews                                | Existing screen no-op test              |
| Undo finishes                                | Restored to previous locations; cleared sender returns when current mail exists              | Refresh Senders, Activity, Undo and previews                       | Read-service and screen lifecycle tests |
| New mail or external restore                 | Sender returns if it matches current filters                                                 | Existing mailbox sync invalidation                                 | Read-service test                       |
| Unsubscribe                                  | Preserve requested, accepted, unconfirmed and manual-handoff distinctions                    | Shared terminal refresh; existing specialized receipt              | Existing unsubscribe tests              |

All applicable actions need outcome feedback, not another confirmation dialog
after success. Existing previews remain before mutations. The sticky receipt
keeps completion and recovery visible without forcing a scroll or full reload.
The same shared terminal refresh applies to actions from Sender Detail, Triage,
Screener and the Undo tray. Their existing specialized feedback remains in place.

The sidebar uses `cleanupActiveSenders` from the summary endpoint so its badge
matches the active cleanup list. Historical `activeSenders` remains unchanged.

## Verification — September 6, 2026

- Real authenticated browser smoke against this checkout's API and web server:
  previewed and moved one existing email to Trash through the production label
  worker. Confirmed the completion receipt, card removal and updated counts.
- Reloaded and confirmed the sender stayed absent. Used Activity's Undo and
  confirmed the card returned. Read-only Gmail checks verified Trash during
  deletion and the exact original labels after Undo.
- Corrected a sidebar count mismatch found during smoke; verified sidebar,
  active filter and results all displayed 531 afterward. No browser errors.
- Regression suites: 864 web tests, 32 shell layout tests and 108 API tests passed;
  10 API tests skipped. Desktop and mobile receipt stories checked separately.
