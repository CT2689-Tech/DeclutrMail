# Glossary content requests — WS2b Home

Deck revision: Home sentences are drop2-r8 (`ws2.json`). Meter sentences are
drop2-r7 (`ws1.json`). Report and confirm sentences are read from
`WS5_COPY` when those keys exist. The module is still `{}`, so Home
renders no report slot and no unsubscribe step until WS5 lands.

`packages/shared/src/copy/ui-glossary.yaml` and `glossary-baseline.json` are
not on this branch. They belong to WS2a. This file is the H0b request list
for Home. It is not a baseline and it does not allow a hit.

## Resolved in drop2-r8

These render the deck sentence.

| Key                       | Where                                                    |
| ------------------------- | -------------------------------------------------------- |
| `ws2.home.empty.title`    | Empty Home title                                         |
| `ws2.home.empty.body`     | Empty Home body                                          |
| `ws2.home.progress.hero`  | Progress label (`one` / `other`)                         |
| `ws2.home.link.activity`  | Activity link                                            |
| `ws2.home.failed.eyebrow` | Failed-scan eyebrow. Replaces “Mailbox needs attention”. |
| `ws2.home.queued.title`   | Queued empty title                                       |
| `ws2.home.queued.body`    | Queued empty body. Replaces “Your progress is saved…”.   |

## Held

| Key                            | Status                                                                                        |
| ------------------------------ | --------------------------------------------------------------------------------------------- |
| `ws2.home.next.largest.title`  | Renders only while `SENDER_SIZE_VIEW` is on. The flag is off, so the card is not on the page. |
| `ws2.home.next.largest.body`   | Same gate.                                                                                    |
| `ws2.home.next.largest.cta`    | Same gate. The link target is `/senders` until a size-sorted view exists.                     |
| `ws2.home.next.laterDue.title` | Not shipped.                                                                                  |
| `ws2.home.next.laterDue.body`  | Not shipped.                                                                                  |
| `ws2.home.next.laterDue.cta`   | Not shipped. The card is the screen name Later only. Count, body, and “Open Later” stay off.  |

## Not shipped

Content said these do not go on Home.

| Text                                                                                | Status                                                                                     |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Free plan                                                                           | Not rendered.                                                                              |
| Progress since you joined                                                           | Not rendered. The progress line still says “since {month}” from the recorded date.         |
| Your first scan is running                                                          | Not rendered.                                                                              |
| Senders appear as the scan finishes. You can close this tab.                        | Not rendered.                                                                              |
| See your senders                                                                    | Not rendered. The empty action stays Review senders.                                       |
| Nothing stands out right now. New senders and changes show up here after each scan. | Not rendered. The calm line is `ws5.report.fallback.zero` when the indexed count is known. |
| Open report                                                                         | Not rendered. `/inbox-report` is not on main. Reuse `ws5.report.home.cta` once WS5 lands.  |

## Mock lines with no deck key

Left off the page. Home does not invent a sentence for them.

| Mock line                                                    | Why it is absent                                                           |
| ------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Your first scan is running                                   | No deck key. A syncing mailbox shows the progress bar only.                |
| Senders appear as the scan finishes. You can close this tab. | No deck key.                                                               |
| Found {n} emails                                             | No deck key. A count needs the sentence that names it.                     |
| See your senders                                             | Not shipped. The empty action stays Review senders.                        |
| {n} emails archived or deleted                               | No deck key. Progress is one line: `{n}` plus `ws2.home.progress.hero`.    |
| {n} senders decided                                          | No deck key. The four-number grid is not rendered.                         |
| Progress since you joined                                    | Not shipped.                                                               |
| {n} senders come back from Later today                       | `ws2.home.next.laterDue.title` is held. The count is not rendered.         |
| Their email returns to your inbox at the time you picked.    | `ws2.home.next.laterDue.body` is held.                                     |
| Open Later                                                   | `ws2.home.next.laterDue.cta` is held. The card uses the screen name Later. |

## §P.1 swaps checked

Rendered Home strings were checked for the one-for-one swaps that keep a
sentence intact: sync, workspace, quota, sender-level, a bare Quiet, and a
bare Pass. None of those words appear in rendered Home copy. Identifiers
such as `sync-failed`, `useSyncStatus` and `workspaceId` are not copy.
