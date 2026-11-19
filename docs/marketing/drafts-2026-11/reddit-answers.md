# Reddit answers (drafts, 2026-11-18)

Ten answers to question types that recur in the November 2026 search data (a Similarweb snapshot kept locally, not in the repo). Nothing has been posted.

Each answer solves the problem with Gmail's own method first. DeclutrMail appears in four of the ten, once each, with a disclosure, and only where a per-sender tool fits. The other six never mention it.

**Every Gmail step comes from the guides in `how-to-content.ts`**, which cite Google Help. Before posting, check each step in a test Gmail account. If Gmail on screen differs, fix the answer or skip the thread.

## Rules before posting

1. **Read the subreddit's rules first,** especially self-promotion and link rules. Record the rule and the date in the sub table in the outreach playbook (§1.2). If the sub bans self-promotion, post the answer **without** the DeclutrMail line and without a declutrmail.com link.
2. **Disclose every time** DeclutrMail is named: "I make DeclutrMail." Never name it without that line.
3. **No vote asks,** in the post, in DMs, or anywhere else. No asking friends to upvote.
4. **Never post the same text twice.** Rewrite the wording for each thread, and keep a log (playbook §6). Reddit and the subs treat repeated text as spam.
5. **Answer the question asked.** If they say they don't want to delete, don't suggest deleting.
6. **Threads under 24 hours old, at most 2 Reddit replies a day,** at most 2 links to declutrmail.com per community per week (playbook §1.2).
7. Links marked "(live after the guides PR merges)" go live only after that PR merges. Until then, post without the link or use a live guide. Fill `[ARCHIVE GUIDE URL]` and `[RECOVER GUIDE URL]` only once those guides are live.

**Finding threads.** Reddit's own search accepts `subreddit:` and `title:`, for example `title:"mass delete" subreddit:GMail`. Google accepts `site:reddit.com`. Check each operator once before relying on it. Sort by New and keep threads under 24 hours old.

---

## 1. Mass delete

**Search:** `title:"mass delete" gmail` · `site:reddit.com "mass delete" gmail` · `title:"delete all" gmail subreddit:GMail`

> On a computer: pick a view on the left (Inbox, Promotions, All Mail), or type a search in the search bar. Check the Select box above your messages. That only selects the current page. A notification then appears above the messages with a link to select every conversation. Click it, then click Delete.
>
> Narrow it first, because "select all" includes everything you never scrolled to. For example: `from:address`, `older_than:1y`, `category:promotions`, `is:unread`.
>
> Deleted mail stays in Trash for up to 30 days, so you can move it back. Deleting doesn't unsubscribe you or stop new mail.
>
> If most of the pile comes from recurring senders you can't name from memory: I make DeclutrMail, which groups Gmail by sender and shows the count before anything moves. Gmail's own method above works fine on its own.

Guide: https://declutrmail.com/how-to/mass-delete-emails-gmail (live after the guides PR merges)

## 2. Delete all email from one sender

**Search:** `title:"from one sender" gmail` · `site:reddit.com gmail delete all emails "one sender"`

> Search `from:(their@address.com)` using the full From address, not the display name. Open a few old and new results first, because the same address sometimes sends receipts or password resets too.
>
> Select the page, then click "Select all conversations that match this search" if Gmail offers it, and Delete. Check Trash afterwards. Gmail keeps it there for up to about 30 days.
>
> This doesn't stop future mail. Unsubscribe if it's a legitimate list, or make a Gmail filter on that address.
>
> I make DeclutrMail, which does this per sender with a preview of the count first, if you have many senders to get through.

Guide: https://declutrmail.com/how-to/bulk-delete-emails-from-one-sender

## 3. "It only deletes 50"

**Search:** `title:"50" gmail delete` · `site:reddit.com gmail "more than 50" delete`

> The Select box only selects the current page. After you check it, a notification above your messages shows how many are selected on the page and has a link to select all conversations in that view or search. Click that link, then Delete.
>
> A bigger page size won't fix it. Google says the web view shows up to 100 per screen, which is still one page.
>
> These are Google's steps for Gmail on a computer. Search first (`from:`, `older_than:1y`, `is:unread`) so every result is one you'd actually delete, then check Trash.

Guide: https://declutrmail.com/how-to/delete-more-than-50-emails-gmail (live after the guides PR merges)

## 4. Unsubscribe in bulk

**Search:** `title:"mass unsubscribe"` · `title:unsubscribe gmail "all at once"` · `site:reddit.com "mass unsubscribe" gmail`

> In Gmail: open a recent email, check the From address, then click Unsubscribe next to the sender's name if it's there. Gmail either sends the request or opens the sender's preference page. No button? Use the footer link only if you trust the sender. For spam or phishing, use Report spam instead, because unsubscribing can confirm your address is live.
>
> Google says it can take a few days to stop. Some accounts also have Manage subscriptions under More on the left, which Google says is still rolling out.
>
> Unsubscribing doesn't remove old mail. That's a separate delete or archive.
>
> I make DeclutrMail, which lets you select many senders at once. Each keeps its own unsubscribe method, and email-only ones become Gmail drafts you send yourself. A sent unsubscribe request can't be taken back.

Guide: https://declutrmail.com/how-to/unsubscribe-from-emails-gmail

## 5. Storage full

**Search:** `title:"storage full" gmail` · `title:"out of storage" gmail` · `site:reddit.com gmail "15 GB" full`

> The 15 GB is shared by Gmail, Drive and Photos, so check which one is actually full first. In Gmail, Spam and Trash count until they're emptied.
>
> 1. Empty Spam, then Trash. This is permanent.
> 2. Search `has:attachment larger:10M`, and `older_than:2y has:attachment`. Open a few results, delete what you don't need, then empty Trash again. Space only comes back when Trash is emptied.
> 3. Check Drive's Storage view, which lists files largest first.
>
> Archiving and unsubscribing free no space. Google says the storage figure can take 48–72 hours to update.
>
> Source: https://support.google.com/googleone/answer/9312312

Guide: https://declutrmail.com/how-to/gmail-storage-full

## 6. Delete all Promotions

**Search:** `title:promotions gmail delete` · `site:reddit.com "delete all promotions" gmail`

> On a computer, click Promotions on the left, check the Select box, click the link in the notification to select all conversations in the category, then Delete. Scroll a page or two first. Gmail decides what lands in Promotions, so wanted mail is sometimes in there.
>
> For part of it, search `category:promotions` plus a condition: `older_than:1y`, `is:unread`, or `from:address`.
>
> It refills unless you unsubscribe from the lists (the Unsubscribe link next to the sender's name) or add a filter. Deleted mail stays in Trash for up to 30 days.

Guide: https://declutrmail.com/how-to/delete-all-promotions-emails-gmail (live after the guides PR merges)

## 7. Delete all unread

**Search:** `title:unread gmail delete` · `site:reddit.com "unread emails" gmail delete all`

> Search `is:unread`, read the first pages, check the Select box, click the link in the notification to select all conversations, then Delete.
>
> Unread isn't the same as unwanted. Today's bill is unread too. Narrow it first: `is:unread older_than:6m`, `is:unread category:promotions`, or `is:unread -is:starred`. With a minus operator, Google notes a whole conversation can still show if any one message in it matches, so check before selecting all.
>
> Deleted mail stays in Trash for up to 30 days. To stop the pile growing back, unsubscribe from the lists behind it.

Guide: https://declutrmail.com/how-to/delete-all-unread-emails-gmail (live after the guides PR merges)

## 8. Where did my archived email go?

**Search:** `title:archived gmail` · `site:reddit.com "where do archived emails go" gmail`

> Archiving only takes the email out of your inbox. It isn't deleted. It's still under All Mail on the left, and Gmail search still finds it.
>
> If someone replies to an archived conversation, Gmail brings it back to your inbox.
>
> Archived mail also doesn't appear in category tabs like Promotions. Those show only what's still in the inbox.

Guide: [ARCHIVE GUIDE URL]. These facts come from the date, bulk-delete and Promotions guides. Once the archive guide is live, match its wording, especially where All Mail sits in the left-hand list.

## 9. Recover deleted email

**Search:** `title:recover deleted gmail` · `title:"deleted emails" gmail back` · `site:reddit.com "recover deleted emails" gmail`

> Open Trash on the left. Google keeps deleted messages there for up to 30 days. Check the box beside each message you want, click Move to, and choose where it should go.
>
> After 30 days, or after "Delete forever" or "Empty Trash now", Gmail deletes them permanently.

Guide: [RECOVER GUIDE URL]. Do not add anything about recovery after Trash is emptied until that guide covers it with a Google source.

## 10. Is it safe to connect a cleanup app?

**Search:** `title:safe gmail app access` · `site:reddit.com "gmail" "cleanup app" safe` · `title:"unroll.me" privacy`

> Things worth checking for any app, before you connect:
>
> - It signs in with Google OAuth, so it never sees your password.
> - Which Gmail permission it asks for, and why it needs it.
> - Whether it fetches full email contents, or a published list of details.
> - Whether it shows what will change before it moves email, and what can't be undone.
> - How to revoke access and delete your data.
>
> Don't rely on a slogan. Read the storage list and the permission.
>
> I make DeclutrMail, so weigh this accordingly. It asks for one permission, gmail.modify, which is broader than what it uses. Its line is "We never fetch or store full email contents.", and it does store sender, subject line and Gmail's preview snippet. Full list: https://declutrmail.com/security

Answer page: https://declutrmail.com/answers/is-it-safe-to-connect-gmail-app

Do not name or describe any other app in this answer, even if the thread asks about one (C1). Answer the checklist only.
