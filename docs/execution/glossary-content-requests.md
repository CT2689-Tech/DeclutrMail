# Glossary content requests — WS2b Home

Deck revision: Home sentences are drop2-r8 (`ws2.json`). Meter sentences are
drop2-r7 (`ws1.json`). Report sentences quoted on Home are drop2-r7
(`ws5.json`); `WS5_COPY` is still empty, so those stay quoted in
`home-deck-copy.ts`.

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
| `ws2.home.next.laterDue.cta`   | Not shipped. The Later card stays a link labeled Later.                                       |

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

## §P.1 swaps checked

Rendered Home strings were checked for the one-for-one swaps that keep a
sentence intact: sync, workspace, quota, sender-level, a bare Quiet, and a
bare Pass. None of those words appear in rendered Home copy. Identifiers
such as `sync-failed`, `useSyncStatus` and `workspaceId` are not copy.
