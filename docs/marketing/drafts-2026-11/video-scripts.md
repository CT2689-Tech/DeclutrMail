# Screen-recording scripts (drafts, 2026-11-18)

Three scripts, 60–120 seconds each. Gmail's own method comes first, then DeclutrMail, in the same order as the guides. Nothing here has been recorded or uploaded.

**Sources for every Gmail step:** the guide text in `apps/web/src/features/marketing/learn/how-to-content.ts` (read 2026-11-18). Each guide cites Google Help. Do not add a Gmail step the guide does not have. If Gmail on screen differs from the guide, stop and tell the guide owner. Do not improvise a voiceover around it.

**Sources for every DeclutrMail line:** `llms-source.ts`, `privacy.ts`, `pricing.config.ts`, and the guide text. DeclutrMail screen labels marked **[SCREEN CHECK]** come from guide prose, not from the app. Confirm each label on screen before recording, and change the voiceover to match the screen, never the other way round.

## Recording checklist

- [ ] Use a **test Gmail account** filled with test mail. Never record the founder's own mailbox.
- [ ] Use made-up sender names only, like the guides' examples (`offers@example.com`, "Sale Signal"). No real brand, person, or address visible.
- [ ] Hide the account avatar, account email, bookmarks bar, other tabs, and browser extensions. Use a clean browser profile.
- [ ] Turn off notifications (OS and browser) for the whole take.
- [ ] Record Gmail **on a computer**. The guides say Google documents these steps for Gmail on a computer.
- [ ] Before recording, walk each Gmail step once and compare it word for word with the guide. Note the date checked in the description.
- [ ] In DeclutrMail, check every **[SCREEN CHECK]** label.
- [ ] Do not show pricing on screen unless the founder has re-read the live pricing page that day.
- [ ] Do not show counts or results that suggest a typical outcome. Any count on screen is from the test account, and the caption says so.
- [ ] Captions on. Burn in "Test account. Made-up senders." for the first 3 seconds of every DeclutrMail segment.
- [ ] Voice: `[PUBLIC NAME]` or no name at all. Never a real name until the founder decides.

---

## Video 1: Mass delete emails in Gmail

**Title:** How to mass delete emails in Gmail (select every conversation, not just 50)

**YouTube description:**

> Gmail can delete a whole view or a whole search at once. This video shows Gmail's own steps on a computer, then a per-sender route.
>
> Written guide with Google's sources: https://declutrmail.com/how-to/mass-delete-emails-gmail [live after the guides PR merges]
>
> 0:00 What a mass delete changes
> 0:15 Gmail's steps
> 0:45 Narrow the set with search
> 1:05 Deleting by sender with DeclutrMail
>
> Deleted email stays in Gmail Trash for up to 30 days. A delete does not unsubscribe you or stop future email.
>
> I make DeclutrMail. Recorded on a test account with made-up senders. Gmail steps checked on [DATE CHECKED].

**Hook (0:00–0:05):** "Gmail can delete everything in a search, not just one page. Here's the step most people miss."

| #   | On screen                                                                                                         | Voiceover                                                                                                                                                                                         |
| --- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Gmail Inbox, test account.                                                                                        | "Deleting in Gmail moves email to Trash. Google keeps it there for up to 30 days, then deletes it for good."                                                                                      |
| 2   | Left side: click a view such as Promotions or All Mail. Or type a search operator in the search bar.              | "First, choose what to delete from. Pick a view on the left, or enter a search."                                                                                                                  |
| 3   | Check the Select box, top left above the messages.                                                                | "Check the Select box. That only selects the messages on this page."                                                                                                                              |
| 4   | Zoom on the notification above the messages. Click its link.                                                      | "A notification above your messages links to the rest. Click it to select every conversation."                                                                                                    |
| 5   | Click Delete. Open Trash. Open two messages.                                                                      | "Click Delete. Then open Trash and check a few messages, to confirm it was the set you meant."                                                                                                    |
| 6   | Search bar: type `from:amy@example.com`, then `older_than:1y`, then `category:promotions`.                        | "Select all means all, including conversations you never scrolled to. Narrow it first. from: finds one address. older_than finds older email. category:promotions finds the Promotions category." |
| 7   | Title card: "When the pile comes from a few senders".                                                             | "Search only works if you know what to type. If the clutter comes from senders you can't name, there's a per-sender route."                                                                       |
| 8   | DeclutrMail: list of senders with volume and read rate. **[SCREEN CHECK: "Clean up" view name]**                  | "I make DeclutrMail. It groups your Gmail by sender, with volume and read rate for each."                                                                                                         |
| 9   | Open one sender. Show recent subject lines.                                                                       | "Open a sender and read its recent subjects. Open Gmail when a subject line isn't enough."                                                                                                        |
| 10  | Choose Delete. Preview: sender, count, How far back, Include archived email. **[SCREEN CHECK: all three labels]** | "Delete shows a preview with the sender and the count before anything moves."                                                                                                                     |
| 11  | Confirm. Open Activity.                                                                                           | "Afterwards, Activity records what moved. Archive, Later and Delete can be undone there for 30 days."                                                                                             |

**End card (5 s):** "Delete changes the email that exists now. Future email is a separate decision: unsubscribe, or add a Gmail filter." Link card to the guide.

Approx. 95 seconds.

---

## Video 2: Delete all emails from one sender in Gmail

**Title:** Delete all emails from one sender in Gmail

**YouTube description:**

> Gmail's own method for deleting every email from one sender, and a per-sender route with a preview.
>
> Written guide with Google's sources: https://declutrmail.com/how-to/bulk-delete-emails-from-one-sender
>
> 0:00 Check the address first
> 0:15 Gmail's steps
> 0:50 The same job in DeclutrMail
>
> Deleting moves email to Trash. It does not unsubscribe you or delete future email.
>
> I make DeclutrMail. Recorded on a test account with made-up senders. Gmail steps checked on [DATE CHECKED].

**Hook (0:00–0:05):** "Deleting every email from one sender takes one search. Checking the search first is the part that matters."

| #   | On screen                                                                                                             | Voiceover                                                                                                                         |
| --- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Open one test message. Zoom on the full From address.                                                                 | "A display name isn't a stable identity. Use the full From address."                                                              |
| 2   | Search bar: `from:(offers@example.com)`. Optionally add `older_than:1y`.                                              | "Search from, then the address in brackets. For a safer first pass, add older_than:1y."                                           |
| 3   | Open one recent and one old result.                                                                                   | "Open a sample. Look for receipts, password resets or account notices from the same address."                                     |
| 4   | Check the Select box for the current page.                                                                            | "Select the current page first."                                                                                                  |
| 5   | Click "Select all conversations that match this search".                                                              | "If Gmail offers to select all conversations that match, use it only when the search matches what you mean."                      |
| 6   | Click Delete. Open Trash.                                                                                             | "Click Delete, then open Trash and check a few messages. Gmail keeps them in Trash for up to about 30 days."                      |
| 7   | Title card: "Delete is not unsubscribe".                                                                              | "This changes only the messages matched now. It doesn't contact the sender or stop future email."                                 |
| 8   | DeclutrMail: open the sender. Recent subjects, current inbox count. **[SCREEN CHECK: "sender inspector" panel name]** | "I make DeclutrMail. It groups Gmail by sender. Open the sender and review its recent subjects and inbox count."                  |
| 9   | Choose Delete.                                                                                                        | "Delete is an explicit choice, separate from Keep, Archive, Unsubscribe and Later."                                               |
| 10  | Preview: How far back, Include archived email, count, sample. **[SCREEN CHECK]**                                      | "The preview names the sender and how many emails it found so far. Check How far back, and whether Include archived email is on." |
| 11  | Confirm. Activity.                                                                                                    | "Activity records the action, and Delete can be undone there for 30 days. Gmail Trash is a separate fallback."                    |

**End card (5 s):** "Deciding about future email is separate: Unsubscribe, or a Gmail filter." Link card to the guide.

Approx. 90 seconds.

---

## Video 3: Mass unsubscribe in Gmail

**Title:** Mass unsubscribe in Gmail: what Gmail does, and a review queue by sender

**YouTube description:**

> How to unsubscribe in Gmail, and how to work through many senders without losing track of which requests went out.
>
> Written guide with Google's sources: https://declutrmail.com/how-to/unsubscribe-from-emails-gmail
>
> 0:00 Only unsubscribe from senders you recognize
> 0:15 Gmail's steps
> 0:50 Many senders at once in DeclutrMail
>
> A sent unsubscribe request cannot be taken back. The sender decides whether and when their email stops.
>
> I make DeclutrMail. Recorded on a test account with made-up senders. Gmail steps checked on [DATE CHECKED].

**Hook (0:00–0:05):** "Unsubscribing stops future email. It doesn't touch the email you already have. Here's how to handle both."

| #   | On screen                                                                                                                                                                                      | Voiceover                                                                                                                                            |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Title card.                                                                                                                                                                                    | "Only unsubscribe from senders you recognize. For phishing or obvious spam, use Report spam instead."                                                |
| 2   | Open a recent message. Zoom on the From address.                                                                                                                                               | "Open a recent message. Confirm the From address and the organization, not just the display name."                                                   |
| 3   | Gmail's Unsubscribe control beside the sender name. Click it. Show the confirmation.                                                                                                           | "Gmail may show Unsubscribe beside the sender. Review the confirmation. Gmail either sends a request or takes you to the sender's preference page."  |
| 4   | Message footer, test sender only.                                                                                                                                                              | "No control? Use the sender's footer link only if you trust the sender. Never enter a password after an unexpected email link."                      |
| 5   | Title card: "Wait before escalating".                                                                                                                                                          | "Senders can take several days to process it. If email keeps coming after that, report it as spam."                                                  |
| 6   | Optional, only if the test account shows it: More, then Manage subscriptions. _(Source: the clean-up guide, which says Google is still rolling it out. Cut this shot if it is not on screen.)_ | "Gmail's Manage subscriptions page, under More, lists active subscriptions in one place, where it's available."                                      |
| 7   | DeclutrMail: select several senders. **[SCREEN CHECK: multi-select control]**                                                                                                                  | "I make DeclutrMail. You can select several senders and unsubscribe in one pass."                                                                    |
| 8   | Unsubscribe preview: one-click vs Gmail draft per sender, and the older-email option with How far back. **[SCREEN CHECK]**                                                                     | "Each sender keeps its own method. One-click requests are sent. Email-only senders get a Gmail draft that you send yourself."                        |
| 9   | Zoom on the older-email option.                                                                                                                                                                | "Unsubscribe on its own leaves older email where it is. In the preview you can also archive or delete it."                                           |
| 10  | Activity after confirm.                                                                                                                                                                        | "Activity shows what was sent. A sent unsubscribe request can't be taken back. An archive or delete of older email can be undone there for 30 days." |

**End card (5 s):** "Start with a small batch of obvious lists, then check the outcomes." Link card to the guide.

Approx. 100 seconds.

---

## Lines that must not appear in any take

"AI reads your email", any user count or testimonial, "trusted by", "most private", "risk-free", "everything is reversible", "honest", "one click" as a product claim, "Screen" as a verb, any sentence about another cleanup product, any claim that DeclutrMail selects by category, date or unread state, or that it frees storage. If the trust line is used, it is exactly: **"We never fetch or store full email contents."**
