# Glossary content requests — WS2b Home

Deck revision: Home sentences are drop2-r10 (`ws2.json`). Meter sentences are
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

## Resolved in drop2-r9

| Key                                                | Where                                                                                  |
| -------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `ws2.home.syncing.title`                           | Syncing Home title: “Scanning your Gmail…”. The scan gate keeps “Reading your Gmail…”. |
| `ws2.home.syncing.body`                            | Syncing status until the status read names a stage. The stage line then replaces it.   |
| `ws2.home.syncing.stage.fetching_metadata`         | “Collecting sender details.” Shared with the scan screen.                              |
| `ws2.home.syncing.stage.building_sender_index`     | “Grouping email by sender.”                                                            |
| `ws2.home.syncing.stage.computing_recommendations` | “Preparing suggestions.” Replaces “Preparing recommendations.” on the scan screen too. |
| `ws2.home.syncing.stage.finalizing`                | “Finishing up.”                                                                        |

`ws2.home.syncing.cta` and `ws2.home.queued.cta` are “(no button)”. That is an instruction: neither state renders a button. Senders cannot be reviewed while a scan is in progress. The empty state that is not scanning still links to Review senders.

## Resolved in drop2-r10

| Key                           | Where                                                                  |
| ----------------------------- | ---------------------------------------------------------------------- |
| `ws2.home.next.later.title`   | Later card title.                                                      |
| `ws2.home.next.laterDue.body` | Later card body. No count in the sentence.                             |
| `ws2.home.next.laterDue.cta`  | Later card action, “Open Later”. Replaces a link whose name was Later. |

## Held

| Key                            | Status                                                                                        |
| ------------------------------ | --------------------------------------------------------------------------------------------- |
| `ws2.home.next.largest.title`  | Renders only while `SENDER_SIZE_VIEW` is on. The flag is off, so the card is not on the page. |
| `ws2.home.next.largest.body`   | Same gate.                                                                                    |
| `ws2.home.next.largest.cta`    | Same gate. The link target is `/senders` until a size-sorted view exists.                     |
| `ws2.home.next.laterDue.count` | Not rendered. The Later card has a title, body, and “Open Later”, and no count.               |
| `ws2.home.next.laterDue.title` | Not shipped. The title is `ws2.home.next.later.title`.                                        |

## Not shipped

Content said these do not go on Home.

| Text                                                                                | Status                                                                                                         |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Free plan                                                                           | Not rendered.                                                                                                  |
| Progress since you joined                                                           | Not rendered. The progress line still says “since {month}” from the recorded date.                             |
| Your first scan is running                                                          | Not rendered.                                                                                                  |
| Senders appear as the scan finishes. You can close this tab.                        | Not rendered.                                                                                                  |
| See your senders                                                                    | Not rendered. The empty action stays Review senders. Syncing and queued have no button.                        |
| Nothing stands out right now. New senders and changes show up here after each scan. | Not rendered. The calm line is `ws5.report.fallback.zero` when the indexed count is known.                     |
| Open report                                                                         | Rendered from `ws5.report.home.cta` once that key exists. It opens Senders. There is no `/inbox-report` route. |

## Mock lines with no deck key

Left off the page. Home does not invent a sentence for them.

| Mock line                                                    | Why it is absent                                                                                    |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Your first scan is running                                   | Replaced by `ws2.home.syncing.title`: “Scanning your Gmail…”.                                       |
| Senders appear as the scan finishes. You can close this tab. | Replaced by `ws2.home.syncing.body`, shown until a stage line replaces it.                          |
| Found {n} emails                                             | No deck key. A count needs the sentence that names it.                                              |
| See your senders                                             | `ws2.home.syncing.cta` and `ws2.home.queued.cta` are “(no button)”. Neither state renders a button. |
| {n} emails archived or deleted                               | No deck key. Progress is one line: `{n}` plus `ws2.home.progress.hero`.                             |
| {n} senders decided                                          | No deck key. The four-number grid is not rendered.                                                  |
| Progress since you joined                                    | Not shipped.                                                                                        |
| {n} senders come back from Later today                       | `ws2.home.next.laterDue.count` is held. The card renders no count.                                  |
| Their email returns to your inbox at the time you picked.    | Replaced by `ws2.home.next.laterDue.body`.                                                          |
| Open Later                                                   | `ws2.home.next.laterDue.cta`. The title is `ws2.home.next.later.title`.                             |

## §P.1 swaps checked

Rendered Home strings were checked for the one-for-one swaps that keep a
sentence intact: sync, workspace, quota, sender-level, a bare Quiet, and a
bare Pass. None of those words appear in rendered Home copy. Identifiers
such as `sync-failed`, `useSyncStatus` and `workspaceId` are not copy.
