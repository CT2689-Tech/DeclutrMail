# Glossary content requests — WS2b Home

Deck revision: drop2-r6. Scope: `apps/web/src/features/home`.

`packages/shared/src/copy/ui-glossary.yaml` and `glossary-baseline.json` are
not on this branch. They belong to WS2a. This file is the H0b request list
for Home. It is not a baseline and it does not allow a hit.

## §P.1 swaps checked

Rendered Home strings were checked for the one-for-one swaps that keep a
sentence intact: sync, workspace, quota, sender-level, a bare Quiet, and a
bare Pass. None of those words appear in rendered Home copy. Identifiers
such as `sync-failed`, `useSyncStatus` and `workspaceId` are not copy.

## Sentences that need Content

These stay as they are. A rewrite would invent a sentence.

| File            | Current string                                                                               | Matched concern                           |
| --------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `home-view.tsx` | Nothing cleared yet.                                                                         | Shipped empty title. No deck replacement. |
| `home-state.ts` | emails cleared                                                                               | Progress label. No deck key.              |
| `home-view.tsx` | See your activity                                                                            | H4 names the link. Not a deck key.        |
| `home-view.tsx` | Mailbox needs attention                                                                      | Not in the §P.1 swap list.                |
| `home-view.tsx` | Start with the senders in your inbox. See their activity, then decide what deserves a place. | Shipped empty body. Not a deck key.       |
| `home-view.tsx` | Your progress is saved. We’ll resume scanning when your turn starts.                         | Shipped queued body. Not a deck key.      |

## Mock strings with no deck key

These were not added.

| Mock text                                                                           | What Home does instead                                                      |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Free plan                                                                           | Omitted until `planName()` returns a name.                                  |
| Progress since you joined                                                           | Not rendered.                                                               |
| Your first scan is running                                                          | Not rendered.                                                               |
| Senders appear as the scan finishes. You can close this tab.                        | Not rendered.                                                               |
| See your senders                                                                    | Existing link is Review senders.                                            |
| Nothing stands out right now. New senders and changes show up here after each scan. | Calm state uses `ws5.report.fallback.zero` when the indexed count is known. |
| {n} senders come back from Later today                                              | Later card is only the Later link.                                          |
| Their email returns to your inbox at the time you picked.                           | Not rendered.                                                               |
| Open Later                                                                          | The link label is Later.                                                    |
| See largest senders                                                                 | Not rendered. Largest filter waits on `SENDER_SIZE_VIEW`.                   |
| Open report                                                                         | Not rendered. `/inbox-report` is not on main.                               |
