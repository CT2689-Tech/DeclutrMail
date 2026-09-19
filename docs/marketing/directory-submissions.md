# Directory submissions — listing copy and tracker

Working file for the directory layer of the DeclutrMail launch. Paste from the copy blocks, tag
every link, update the Status column as you go.

- **Product facts last sourced from the repo:** 2026-09-19 (see [Sources](#sources)).
- **Directory cost and link-type facts last checked:** 2026-09-19, by fetching each directory's own
  page. Anything that could not be read from the directory's own site says
  `unknown — verify on the site`. Nothing here is from memory or from a third-party "best
  directories" list.
- If `packages/shared/src/entitlements/pricing.config.ts` changes, re-derive every number in this
  file before the next submission. That manifest wins over this document.

---

## 1. Rules for every listing

### 1.1 Claims you may make (each one traces to a file)

| Claim                                                                                                                                                                                                      | Source                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| The trust line, **verbatim**: "We never fetch or store full email contents."                                                                                                                               | `packages/shared/src/copy/privacy.ts` (`PRIVACY_BADGE_HEADLINE`) [S3]                                                   |
| Five sender decisions, exactly: **Keep · Archive · Unsubscribe · Later · Delete**                                                                                                                          | `CLAUDE.md` §2.2; `apps/web/public/llms.txt` [S1][S2]                                                                   |
| Manual Archive, Later, and Delete show the matching count, a sample when available, and the planned Gmail changes before you confirm. The final number can change if the inbox changed in between.         | `packages/shared/src/copy/action-safety.ts` (`ACTION_PREVIEW_CLAIM`) [S4]                                               |
| Archive, Later, and Delete can be undone from Activity for **30 days, on every plan**.                                                                                                                     | `pricing.config.ts` (`undoWindowDays: 30` on every tier); `undo-window.ts` (`UNIFORM_UNDO_WINDOW_DAYS`) [S5][S6]        |
| Deleted email also stays in Gmail Trash for up to 30 days unless Trash is emptied sooner.                                                                                                                  | `action-safety.ts` (`DELETE_RECOVERY_CLAIM`) [S4]                                                                       |
| **A sent unsubscribe request cannot be taken back.** (Say this whenever undo is mentioned near Unsubscribe.)                                                                                               | `action-safety.ts` (`ACTION_SAFETY_SUMMARY`) [S4]                                                                       |
| Manual actions do not create rules for future mail. Autopilot rules (Plus and Pro) are separate, previewed, and opt-in.                                                                                    | `action-safety.ts` (`MANUAL_ACTION_SCOPE_CLAIM`); `llms.txt` [S4][S2]                                                   |
| Gmail and Google Workspace only. A companion to Gmail, not a mail client. Not affiliated with Google.                                                                                                      | `comparison-data.ts` (`DECLUTR.providers`); `llms.txt`; `how-it-works/page.tsx` [S7][S2][S8]                            |
| What is stored: the generated list (sender name and address, subject line, Gmail preview snippet, date received, labels, read/unread state, and the rest of the list on `/security`).                      | `packages/shared/src/contracts/gmail-data-inventory.ts` (`GMAIL_MESSAGE_STORAGE_LABELS`); `security/page.tsx` [S9][S10] |
| Never fetched or stored: full email contents, email HTML, attachments, images embedded in emails, raw email source.                                                                                        | `privacy.ts` (`PRIVACY_NEVER_ITEMS`) [S3]                                                                               |
| One Gmail permission, `gmail.modify`, which is broader than what DeclutrMail uses; DeclutrMail never sends email as you.                                                                                   | `privacy.ts` (`OAUTH_SCOPE_DISCLOSURE`); `security/page.tsx` [S3][S10]                                                  |
| "Google approved DeclutrMail's OAuth verification on 21 April 2026 (CASA Tier 2)." The verb is **approved** — never "certified", "audited", or "Google-verified product".                                  | `privacy.ts` (`CASA_VERIFICATION_APPROVED_ON`) [S3]                                                                     |
| No ML category prediction. Gmail data is not used to train generalized AI models.                                                                                                                          | `security/page.tsx` (`#no-prediction`); `CLAUDE.md` §2.4 [S10][S1]                                                      |
| AI disclosure, if a directory asks: suggestion explanations may send Anthropic the sender and engagement numbers; Pro Brief may send sender, subject line, and preview snippet; never full email contents. | `action-safety.ts` (`RECOMMENDATION_AI_DISCLOSURE`, `BRIEF_AI_DISCLOSURE`) [S4]                                         |
| Pricing (see the table in 1.4).                                                                                                                                                                            | `pricing.config.ts` [S5]                                                                                                |
| 30-day money-back guarantee on paid plans.                                                                                                                                                                 | `apps/web/src/app/(marketing)/refunds/page.tsx` [S11]                                                                   |
| There is a no-sign-in demo at `/inbox-simulator` using made-up senders.                                                                                                                                    | `llms.txt`; `landing/hero.tsx` [S2][S12]                                                                                |
| Funding: subscriptions only; Gmail data is not sold or used for advertising.                                                                                                                               | `comparison-data.ts` (`DECLUTR.funding`), which cites the published privacy policy [S7]                                 |

### 1.2 Claims you may NOT make

- **Anything about a competitor.** Not in a description, not in a maker comment, not in a reply.
  Directories with an "alternative to X" field (AlternativeTo, SaaSHub) get the product **name
  only** in that field — no adjective, no comparison sentence. Source-backed comparisons live on
  `/vs/*` and `/compare`; link there if someone asks.
- **Anything that is not in the repo.** No founder backstory an agent wrote, no inbox statistics, no
  "saves N hours", no speed claims, no "most private".
- **No user counts, no testimonials, no ratings, no "loved by", no logos.** There are none. The
  landing page ships without testimonials for the same reason (`(marketing)/page.tsx` header
  comment, D136) [S13].
- **No "AI reads your inbox" framing in either direction** — do not describe DeclutrMail as AI that
  reads email, and do not describe any other tool that way to contrast with it (`llms.txt`, "Please
  do not describe DeclutrMail as") [S2].
- **No counter-style privacy claims**: never "0 bodies read", "Bodies read: 0", "Full bodies
  fetched: 0" (`CLAUDE.md` §2.1) [S1]. Do not compress the trust line into "metadata only" or "never
  reads your email" either — ADR-0030 calls those jargon or false, and the stored list includes
  subject lines and preview snippets [S14].
- **No blanket reversibility**: never "everything is reversible", "undo anything", "risk-free",
  "unlimited undo". Undo covers Archive, Later, Delete. Unsubscribe is one-way [S4][S2].
- **No "fully automatic" / "set and forget"** as the default description. Manual actions need an
  approved preview; an Autopilot rule acts on its own only after it is deliberately turned on [S2].
- **No category-sorting language**: never "auto-sorts newsletters", "detects promotions",
  "categorizes your email" [S1][S10].
- **No "certified" / "audited" / "Google partner"** [S3].
- **The word "Screen" is never a user-facing verb.** "Screener" is a feature name only [S1].
- **The name is `DeclutrMail`** — one word, capital D and M [S2].

### 1.3 Link tagging

The site's signup attribution accepts exactly six `ref` values: `hn`, `ph`, `reddit`, `simulator`,
`x`, `linkedin` (`packages/shared/src/contracts/signup-attribution-ref.ts`). Anything else is
dropped by `parseSignupAttributionRef`, so an invented `ref=betalist` records nothing [S15].

- **Directories:** `https://declutrmail.com/?utm_source=<directory-slug>&utm_medium=directory`
  - Slug is lowercase, hyphenated, and stable: use the one in the tracker's Tagged link column.
  - `utm_source` and `utm_medium` are on the analytics URL allowlist
    (`packages/shared/src/observability/scrubber.ts`; behaviour pinned in
    `apps/web/src/features/marketing/site-analytics.test.ts`), so they survive on recorded page
    URLs [S16]. They do **not** feed signup first-touch attribution — that is `ref` only. Directory
    traffic is therefore visible as visits by source, not as attributed signups. That is a known
    limit, not something to fix by inventing a `ref`.
- **Product Hunt:** `https://declutrmail.com/?ref=ph` (an allowlisted value — use it).
- **Show HN:** `?ref=hn` is allowlisted. Whether HN preserves a query string on a submitted URL is
  unknown — verify on the day.
- **Never put anything personal in a query string** (no email, no name).
- Some directories strip query strings or forbid tracking parameters. If a form rejects the tagged
  link, submit the bare `https://declutrmail.com/` and write "untagged" in Notes.

### 1.4 Pricing, exactly as the manifest has it

All figures from `packages/shared/src/entitlements/pricing.config.ts` [S5]. The machine-readable
copy of the same manifest is served at `https://declutrmail.com/pricing.md`.

| Plan         | Monthly (USD) | Annual (USD) | Monthly (INR) | Annual (INR) | Inboxes | Cleanup actions  | Activity Undo window |
| ------------ | ------------- | ------------ | ------------- | ------------ | ------- | ---------------- | -------------------- |
| Free         | $0            | —            | ₹0            | —            | 1       | 50 per month     | 30 days              |
| Plus         | $9            | $90          | ₹749          | ₹7,499       | 1       | No monthly limit | 30 days              |
| Pro          | $19           | $190         | ₹1,599        | ₹15,999      | 5       | No monthly limit | 30 days              |
| Founding Pro | —             | $129         | —             | ₹10,999      | 5       | No monthly limit | 30 days              |

- **Founding Pro:** $129/year, first 250 paying users (`maxRedemptions: 250`), grants Pro; the price
  stays locked while the subscription stays active. Do not state how many founding spots remain —
  no public source for a live count exists.
- **What each tier adds:** Free is the whole manual product (Senders, Sender Detail, Activity,
  Triage, Later, every cleanup action). Plus adds no monthly limit, the Screener, Autopilot rules,
  and Quiet hours. Pro adds the Daily Brief, Follow-ups, and 5 connected inboxes.
- Annual is described in the manifest as "2 months free vs monthly". $90 = 10 × $9 and $190 = 10 ×
  $19, so that phrasing is safe.
- Team and Enterprise are not purchasable. Do not list them as plans.
- Directories with a single "Pricing model" dropdown: choose **Freemium**. "Starting price": **$9 /
  month** (Plus monthly). "Free plan": **Yes**. "Free trial": **No** — there is a Free plan and a
  30-day money-back guarantee, which is not a trial.

---

## 2. Reusable copy blocks

Every block below was length-checked against its limit. Character counts are in brackets. If you
edit a block, recount it.

### T — Tagline (≤ 60 characters)

- **T1** [51] — `Clear years of Gmail clutter, one sender at a time.`
- **T2** [55] — `Gmail cleanup by sender. Preview before anything moves.`
- **T3** [52] — `See which emails will move before you clean up Gmail`

T1 is the landing headline [S12]. T2 leads with the preview guarantee, which is what ADR-0030 asks
every public surface to lead with [S14]. Product Hunt's tagline field has its own limit shown in the
form — confirm there.

### O — One-liner (≤ 120 characters)

- **O1** [114] —
  `Clean up Gmail by sender: preview which emails will move, confirm, and undo Archive, Later, or Delete for 30 days.`
- **O2** [109] —
  `One decision per sender — Keep, Archive, Unsubscribe, Later, or Delete — with a preview before Gmail changes.`
- **O3** [102] —
  `Gmail cleanup by sender. See the count and the planned changes before you confirm. Free plan, no card.`

### S — Short description (≤ 300 characters)

- **S1** [278] —
  `DeclutrMail groups your Gmail by sender so one decision — Keep, Archive, Unsubscribe, Later, or Delete — handles many emails at once. You see the matching count and the planned Gmail changes before you confirm. Archive, Later, and Delete can be undone from Activity for 30 days.`
- **S2** [285] —
  `A Gmail cleanup tool for inboxes you gave up on. Review senders, preview which emails will move, then confirm. We never fetch or store full email contents. Free covers every cleanup action, 50 a month; Plus is $9/month and Pro is $19/month. A sent unsubscribe request cannot be undone.`
- **S3 (AI-tool directories only)** [286] —
  `DeclutrMail is Gmail cleanup by sender, with a preview before anything moves. It does not predict email categories. AI is used narrowly: short explanations for suggestions, and the Pro Daily Brief, which may use the sender, subject line, and Gmail preview snippet — never full contents.`

Product Hunt's description field is shorter than this block (its help page says "within 260
characters", fetched 2026-09-19) — use **S-PH**:

- **S-PH** [255] —
  `DeclutrMail groups Gmail by sender so one decision — Keep, Archive, Unsubscribe, Later, or Delete — handles many emails at once. You see the count and the planned changes before you confirm. Archive, Later, and Delete can be undone for 30 days. Free plan.`

### L — Long description (≤ 900 characters)

**L1** [881]

```text
DeclutrMail is a Gmail cleanup tool for inboxes you gave up on. It groups email by sender, so one decision — Keep, Archive, Unsubscribe, Later, or Delete — can handle many emails at once.

Before a manual Archive, Later, or Delete runs, you see how many emails match, a sample when available, and exactly what will change in Gmail. The final number can shift if new mail arrives first. Archive, Later, and Delete can be undone from Activity for 30 days on every plan. A sent unsubscribe request cannot be taken back.

We never fetch or store full email contents. The Gmail details DeclutrMail does store are listed at declutrmail.com/security.

Gmail stays where you read and reply. Free includes every cleanup action, 50 a month, no card. Plus ($9/month) removes the limit and adds the Screener and Autopilot rules. Pro ($19/month) adds the Daily Brief, Follow-ups, and 5 inboxes.
```

**L2** [897]

```text
DeclutrMail ranks the senders in your Gmail and lets you decide once per sender: Keep, Archive, Unsubscribe, Later, or Delete. One decision can handle many emails at once.

Nothing moves until you confirm. Each manual Archive, Later, or Delete shows the matching count, a sample when available, and the planned Gmail changes first. These actions apply only to the email shown — they do not create rules for future mail. Ongoing automation is separate: Autopilot rules on Plus and Pro are previewed and only run after you deliberately turn one on.

Undo Archive, Later, or Delete from Activity for 30 days. Deleted email also stays in Gmail Trash for up to 30 days. Unsubscribe is one-way.

We never fetch or store full email contents. DeclutrMail requests one Gmail permission, gmail.modify, and never sends email as you. Works with Gmail and Google Workspace. Free plan; paid plans from $9/month.
```

### F — Five feature bullets

**F1 (what it does)**

1. Senders ranked in one view, with a focused Triage queue — on every plan.
2. Five decisions per sender: Keep, Archive, Unsubscribe, Later, Delete (keyboard: K / A / U / L /
   D).
3. A preview before every manual Archive, Later, or Delete: matching count, a sample when available,
   and the planned Gmail changes.
4. Activity keeps a record of what happened; undo Archive, Later, or Delete for 30 days on every
   plan.
5. Unsubscribe when the sender provides a method: one-click requests run directly, mailto requests
   need a manual step. A sent request cannot be taken back.

**F2 (trust and limits)**

1. We never fetch or store full email contents. The stored Gmail details are published at
   declutrmail.com/security.
2. One Gmail permission, `gmail.modify`; DeclutrMail never sends email as you.
3. Google approved DeclutrMail's OAuth verification on 21 April 2026 (CASA Tier 2).
4. No ML category prediction; automation follows preset rules you explicitly enable.
5. Free plan with every cleanup action (50 a month). Paid plans carry a 30-day money-back guarantee.

Sources for F1: [S7][S8][S4][S5]. For F2: [S3][S10][S11][S5].

### C — Categories and tags

Pick from the directory's own list; these are the fits, best first.

- **Primary category:** Email · Productivity · Email management
- **Secondary:** Gmail tools · Inbox cleanup · Unsubscribe · Privacy-focused tools · Google
  Workspace add-ons/companions (only if the directory's definition includes external web apps — it
  is not a Workspace Marketplace add-on)
- **Tags:** `gmail`, `email`, `inbox-cleanup`, `unsubscribe`, `email-management`, `productivity`,
  `privacy`, `saas`, `freemium`
- **Platform:** Web. There is no mobile app, browser extension, or desktop app to claim.
- **AI-tool directories:** use "Email assistant" / "Productivity" style categories with **S3**. Do
  not pick "AI email reader", "email summarizer", or "AI inbox sorter" — see 1.2. If the only
  available categories imply the product reads or sorts mail with AI, skip that directory.
- **"Alternative to" fields:** product names only, and only tools the repo already holds a
  source-backed page for: Clean Email, Trimbox, SaneBox, Leave Me Alone, Unroll.Me (`llms.txt`,
  Comparisons) [S2].

### M — Maker comment for Product Hunt

The `[FOUNDER: …]` line must be written by the founder. An agent must not invent a reason, an
anecdote, or a number for it.

**M1** (plain)

```text
Hi — I'm Chintan, and I built DeclutrMail on my own.

[FOUNDER: one or two sentences, in your words, on why you built it.]

What it does: it groups your Gmail by sender, and you make one decision per sender — Keep, Archive, Unsubscribe, Later, or Delete. Before a manual Archive, Later, or Delete runs, you see how many emails match and what will change in Gmail. Archive, Later, and Delete can be undone from Activity for 30 days, on every plan including Free.

What I want to be straight about:
- It is Gmail and Google Workspace only.
- A sent unsubscribe request can't be taken back, so that one isn't undoable.
- It asks for the gmail.modify permission, which is broader than what it uses. We never fetch or store full email contents, and the list of Gmail details it does store is published at declutrmail.com/security.
- Free is 50 cleanup actions a month. Plus is $9/month, Pro is $19/month.

If you don't want to connect Gmail yet, there's a demo with made-up senders at declutrmail.com/inbox-simulator — no sign-in.

I'd like to hear what's confusing, what feels unsafe, and what you'd want before trusting it with your inbox. I'll be here all day.
```

**M2** (shorter)

```text
Hi, I'm Chintan — solo founder of DeclutrMail.

[FOUNDER: one sentence on why you built it.]

It's Gmail cleanup by sender. One decision per sender — Keep, Archive, Unsubscribe, Later, or Delete — and you see the matching count and the planned Gmail changes before anything moves. Undo Archive, Later, or Delete for 30 days. Unsubscribe is one-way, and the preview says so.

We never fetch or store full email contents; what is stored is listed at declutrmail.com/security.

Gmail only for now. Free plan, no card. You can try the demo without signing in: declutrmail.com/inbox-simulator

Tell me where it's unclear or where it made you nervous — that's the feedback I need most.
```

### Q — FAQ answers

**Q1 — "What Gmail data do you store?"**

- **Q1-a (full)**

  ```text
  We never fetch or store full email contents. DeclutrMail stores these Gmail details: Gmail message and conversation IDs; sender name and email address; subject line; the Gmail preview snippet (the short text shown in your inbox list); date received; Gmail labels and your label names; read or unread state; whether a message was sent by you; recipient addresses from To and Cc on email you sent; unsubscribe links and whether one-click unsubscribe is supported; and Gmail's estimated message size. It never fetches or stores email HTML, attachments, images embedded in emails, or raw email source. The current list is generated from the code that does the fetching and is published at declutrmail.com/security. Account, preference, action, and billing records are covered in the privacy policy.
  ```

- **Q1-b (short)**

  ```text
  We never fetch or store full email contents. DeclutrMail stores a published list of Gmail details — sender, subject line, Gmail's preview snippet, date, labels, read state, and unsubscribe information among them — and never email HTML, attachments, embedded images, or raw source. The full list is at declutrmail.com/security.
  ```

  Before pasting Q1-a, open `/security` and check the list still matches: it is generated from
  `gmail-data-inventory.ts`, and this file is a hand copy made on 2026-09-19 [S9].

**Q2 — "Can I undo?"**

- **Q2-a (full)**

  ```text
  Archive, Later, and Delete: yes. You can undo them from Activity until the deadline shown there — 30 days on every plan, including Free. Deleted email also sits in Gmail Trash for up to 30 days unless you empty Trash sooner. Unsubscribe: no. A sent unsubscribe request cannot be taken back, and the preview tells you that before you confirm. Keep moves nothing, so there is nothing to undo.
  ```

- **Q2-b (short)**

  ```text
  Archive, Later, and Delete can be undone from Activity for 30 days on every plan. A sent unsubscribe request cannot be taken back.
  ```

Sources: Q1 [S3][S9][S10]; Q2 [S4][S5][S6].

---

## 3. Tracker

**How to read the Cost and Link type columns.** A value is filled in only where the directory's own
page said so when fetched on 2026-09-19; the Notes column says which page. Those fetches were read
through an automated summarizer, so treat a filled-in value as "stated on that page on that date" —
re-read the page before paying for anything. Everything else is `unknown — verify on the site`.
"Link type" means the `rel` attribute on the outbound link to declutrmail.com; where a directory
does not state it, the only way to know is to inspect a live listing.

Order: launch-day surfaces first, then free listings with lasting pages, then queue-based launch
boards, then review sites (slow, need real reviews later), then AI-tool directories (weakest fit —
see Notes), then the long tail.

| #   | Directory              | URL                                      | Type                                     | Cost                                                                                                                                                                                                             | Link type                                                                                                                             | Copy blocks                                            | Tagged link                                                                               | Status        | Notes                                                                                                                                                                                                                                                                                                                                            |
| --- | ---------------------- | ---------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Product Hunt           | https://www.producthunt.com              | startup                                  | Free — `producthunt.com/launch` states "It's 100% free to use."                                                                                                                                                  | unknown — verify on the site                                                                                                          | T2 or T1, S-PH, F1 for gallery captions, M1, Q1, Q2    | `https://declutrmail.com/?ref=ph`                                                         | Not submitted | See the checklist in section 4. Uses the allowlisted `ref=ph`, not a utm tag.                                                                                                                                                                                                                                                                    |
| 2   | Hacker News (Show HN)  | https://news.ycombinator.com/showhn.html | startup (community, **not a directory**) | Free (no paid placement is described on the rules page)                                                                                                                                                          | unknown — verify on the site                                                                                                          | None pasted. Write the post by hand; Q1/Q2 for replies | `https://declutrmail.com/inbox-simulator?ref=hn` (query-string handling on HN unverified) | Not submitted | Rules page (fetched 2026-09-19): must be something people can try; "sign-up pages" and landing pages do not qualify; make it easy to try "ideally without barriers such as signups"; "Please don't ask friends to upvote or comment." So submit the no-sign-in simulator, not the homepage. Title starts `Show HN:`. One shot — do not resubmit. |
| 3   | AlternativeTo          | https://alternativeto.net                | alternatives                             | Free to add; optional one-time $5 to move to the front of the queue (AlternativeTo FAQ)                                                                                                                          | unknown — verify on the site                                                                                                          | T2, S1 **with the URL removed**, C                     | `https://declutrmail.com/?utm_source=alternativeto&utm_medium=directory`                  | Not submitted | FAQ: descriptions "must not contain … email addresses and website links"; using a profile to advertise gets blocked; incentivizing upvotes is penalized. "Alternative to" field: names only (1.2).                                                                                                                                               |
| 4   | SaaSHub                | https://www.saashub.com                  | alternatives                             | unknown — verify on the site                                                                                                                                                                                     | unknown — verify on the site                                                                                                          | T2, S1, F1, C                                          | `https://declutrmail.com/?utm_source=saashub&utm_medium=directory`                        | Not submitted | `saashub.com/submit` is a different thing — a free list of other sites to submit to — and says nothing about SaaSHub's own listing cost. Alternatives field: names only.                                                                                                                                                                         |
| 5   | Indie Hackers products | https://www.indiehackers.com/products    | startup                                  | unknown — verify on the site (the products page says "Create a free account"; listing cost itself is not stated)                                                                                                 | unknown — verify on the site                                                                                                          | T1, S2, M2 adapted as the first update                 | `https://declutrmail.com/?utm_source=indiehackers&utm_medium=directory`                   | Not submitted | Do not post revenue or user numbers that are not real and current.                                                                                                                                                                                                                                                                               |
| 6   | BetaList               | https://betalist.com                     | startup                                  | **Paid** — BetaList FAQ: "All submissions are paid. There is no free submission option." Price is shown on the form; refunded if not selected                                                                    | **dofollow** — FAQ: the "Visit Site" button "does not use `rel=\"nofollow\"`" (via a 301 redirect)                                    | T1, S2, C                                              | `https://declutrmail.com/?utm_source=betalist&utm_medium=directory`                       | Not submitted | FAQ: features "pre-launch and recently launched startups"; needs its own domain. Check the price on the form before deciding; eligibility depends on how "recently launched" is read.                                                                                                                                                            |
| 7   | Uneed                  | https://www.uneed.best                   | startup                                  | Free queue ("Join the line", date assigned, up to 5 months out); Fast-track $14.99; Skip the Line $29.99 (`uneed.best/pricing`)                                                                                  | **dofollow, conditional** — pricing page: free tier needs an upvote score of 20 for the do-follow link; guaranteed with Skip the Line | T2, S1, F1                                             | `https://declutrmail.com/?utm_source=uneed&utm_medium=directory`                          | Not submitted | Free tier also needs a score of 10 to stay published, per the same page. Do not solicit votes to hit the threshold.                                                                                                                                                                                                                              |
| 8   | Peerlist (Launchpad)   | https://peerlist.io/launchpad            | startup                                  | unknown — verify on the site (fetch returned HTTP 403)                                                                                                                                                           | unknown — verify on the site                                                                                                          | T1, S1, M2                                             | `https://declutrmail.com/?utm_source=peerlist&utm_medium=directory`                       | Not submitted | Needs a founder profile first.                                                                                                                                                                                                                                                                                                                   |
| 9   | Fazier                 | https://fazier.com                       | startup                                  | Free tier ("Reviewed & listed within 30 days") **requires a backlink to Fazier on our homepage or footer**; paid tiers listed at $29 / $49 / a third tier whose price rendered ambiguously (`fazier.com/submit`) | Paid Premium/Super: "dofollow backlink (DR 82+)" stated. Free tier: unknown — verify on the site                                      | T2, S1, F1                                             | `https://declutrmail.com/?utm_source=fazier&utm_medium=directory`                         | Not submitted | The free tier's reciprocal-backlink condition is a site change — founder decision, not a paste job. Re-read the price list; the fetched figures were strikethrough pairs.                                                                                                                                                                        |
| 10  | TinyLaunch             | https://www.tinylaunch.com               | startup                                  | Free Standard Launch; Premium Launch $39 (`tinylaunch.com/pricing`)                                                                                                                                              | unknown — verify on the site (page says "High authority backlink" for top 3 and Premium, without stating dofollow)                    | T2, S1                                                 | `https://declutrmail.com/?utm_source=tinylaunch&utm_medium=directory`                     | Not submitted | The same page sells a $279 "submission service" — not needed; this file is that.                                                                                                                                                                                                                                                                 |
| 11  | Microlaunch            | https://microlaunch.net                  | startup                                  | unknown — verify on the site (`/pricing` returned 404; homepage shows a "Go Premium" option but no prices)                                                                                                       | unknown — verify on the site                                                                                                          | T2, S1, F1                                             | `https://declutrmail.com/?utm_source=microlaunch&utm_medium=directory`                    | Not submitted |                                                                                                                                                                                                                                                                                                                                                  |
| 12  | Launching Next         | https://www.launchingnext.com/submit/    | startup                                  | Free; optional $99 upgrade for consideration within 1 business day (submit page)                                                                                                                                 | unknown — verify on the site                                                                                                          | T1, S1, C                                              | `https://declutrmail.com/?utm_source=launchingnext&utm_medium=directory`                  | Not submitted |                                                                                                                                                                                                                                                                                                                                                  |
| 13  | 10words                | https://10words.io                       | startup                                  | Free — homepage says "submit it for free"; form at `app.10words.io/submit`                                                                                                                                       | unknown — verify on the site                                                                                                          | A 10-word line (see Notes)                             | `https://declutrmail.com/?utm_source=10words&utm_medium=directory`                        | Not submitted | Description must be 10 words or fewer. Use: `Clean Gmail by sender. Preview what moves before you confirm.` (10 words). Do not squeeze in a bare "undo" — without its verbs it is a blanket claim (1.2).                                                                                                                                         |
| 14  | G2                     | https://www.g2.com                       | review                                   | Free to claim a profile — `sell.g2.com/create-a-profile`: "You can claim your profile for free."                                                                                                                 | unknown — verify on the site                                                                                                          | T2, S1, L1, F1, F2, C, pricing table 1.4               | `https://declutrmail.com/?utm_source=g2&utm_medium=directory`                             | Not submitted | A review site with zero reviews is a thin page. Never seed, trade, or incentivize reviews. Create the profile; ask for reviews only from real users, later.                                                                                                                                                                                      |
| 15  | Capterra               | https://www.capterra.com/vendors/        | review                                   | unknown — verify on the site (vendor page fetched; no pricing stated on it)                                                                                                                                      | unknown — verify on the site                                                                                                          | T2, S1, L1, F1, C, pricing table 1.4                   | `https://declutrmail.com/?utm_source=capterra&utm_medium=directory`                       | Not submitted | Same review rule as G2.                                                                                                                                                                                                                                                                                                                          |
| 16  | GetApp                 | https://www.getapp.com                   | review                                   | unknown — verify on the site                                                                                                                                                                                     | unknown — verify on the site                                                                                                          | T2, S1, L1, F1, C                                      | `https://declutrmail.com/?utm_source=getapp&utm_medium=directory`                         | Not submitted | Whether one vendor account covers Capterra and GetApp together is unverified — check in the vendor portal before filling two forms.                                                                                                                                                                                                              |
| 17  | Crunchbase             | https://www.crunchbase.com               | startup (company profile)                | unknown — verify on the site (help article returned HTTP 403)                                                                                                                                                    | unknown — verify on the site                                                                                                          | O1, S2 (company description)                           | `https://declutrmail.com/?utm_source=crunchbase&utm_medium=directory`                     | Not submitted | Company facts only. Leave funding, employee count, and revenue fields empty rather than estimating.                                                                                                                                                                                                                                              |
| 18  | F6S                    | https://www.f6s.com                      | startup (company profile)                | unknown — verify on the site (fetch hit a bot-check page)                                                                                                                                                        | unknown — verify on the site                                                                                                          | O1, S2                                                 | `https://declutrmail.com/?utm_source=f6s&utm_medium=directory`                            | Not submitted |                                                                                                                                                                                                                                                                                                                                                  |
| 19  | StackShare             | https://stackshare.io                    | SaaS (tool profile)                      | unknown — verify on the site                                                                                                                                                                                     | unknown — verify on the site                                                                                                          | T2, S1                                                 | `https://declutrmail.com/?utm_source=stackshare&utm_medium=directory`                     | Not submitted | StackShare is developer-tool oriented; a consumer Gmail tool may not fit its categories. Check before spending time. Not fetched.                                                                                                                                                                                                                |
| 20  | Startup Stash          | https://startupstash.com/add-listing/    | SaaS                                     | unknown — verify on the site (add-listing page fetched; no price shown)                                                                                                                                          | unknown — verify on the site                                                                                                          | T2, S1, C                                              | `https://declutrmail.com/?utm_source=startupstash&utm_medium=directory`                   | Not submitted |                                                                                                                                                                                                                                                                                                                                                  |
| 21  | SideProjectors         | https://www.sideprojectors.com           | startup (marketplace + showcase)         | Homepage: "Basic project submissions and browsing are free"; premium features mentioned without prices                                                                                                           | unknown — verify on the site                                                                                                          | T1, S1                                                 | `https://declutrmail.com/?utm_source=sideprojectors&utm_medium=directory`                 | Not submitted | The site is primarily a buy/sell marketplace. List as a **showcase**, never "for sale".                                                                                                                                                                                                                                                          |
| 22  | Betapage               | https://betapage.co                      | startup                                  | unknown — verify on the site                                                                                                                                                                                     | unknown — verify on the site                                                                                                          | T2, S1                                                 | `https://declutrmail.com/?utm_source=betapage&utm_medium=directory`                       | Not submitted | On 2026-09-19 `betapage.co/submit-startup` 301-redirected to `pitchwall.co/submit-startup`, which returned 404. The directory may have rebranded or moved — confirm it still accepts submissions before anything else.                                                                                                                           |
| 23  | There's An AI For That | https://theresanaiforthat.com            | AI tool                                  | unknown — verify on the site (submit page returned HTTP 403)                                                                                                                                                     | unknown — verify on the site                                                                                                          | T2, **S3**, F2, C (AI note)                            | `https://declutrmail.com/?utm_source=taaft&utm_medium=directory`                          | Not submitted | Weak fit: DeclutrMail is not an AI product and must not be listed as one that reads or sorts mail (1.2). Submit only if a truthful category exists.                                                                                                                                                                                              |
| 24  | Futurepedia            | https://www.futurepedia.io/submit-tool   | AI tool                                  | **Paid** as fetched: Basic Listing $247 (shown "Sold Out"), Verified Listing $497 one-time; no free option shown on the page                                                                                     | unknown — verify on the site                                                                                                          | T2, **S3**, F2, C (AI note)                            | `https://declutrmail.com/?utm_source=futurepedia&utm_medium=directory`                    | Not submitted | Same weak-fit caveat as #23, and the only open tier on the page was $497. Likely a skip — founder's call.                                                                                                                                                                                                                                        |
| 25  | Toolify                | https://www.toolify.ai                   | AI tool                                  | unknown — verify on the site (both submit URLs tried returned HTTP 403)                                                                                                                                          | unknown — verify on the site                                                                                                          | T2, **S3**, F2, C (AI note)                            | `https://declutrmail.com/?utm_source=toolify&utm_medium=directory`                        | Not submitted | Same weak-fit caveat as #23.                                                                                                                                                                                                                                                                                                                     |

**Per-submission routine**

1. Re-read the directory's submission rules on the day. Rules and prices move.
2. Paste blocks as written. If a field is shorter than the block, cut whole sentences — never trim a
   qualifier (`when available`, `Archive, Later, and Delete`, `cannot be taken back`) to make it
   fit.
3. Use the tagged link from the row. If the form has a separate "pricing URL", use
   `https://declutrmail.com/pricing` with the same utm pair.
4. Do not accept a directory's terms, pay, or add a reciprocal badge/backlink to the site without
   deciding that on purpose — those are founder calls.
5. After it goes live: open the listing, check the name reads `DeclutrMail`, check the description
   was not rewritten by the directory into something in 1.2, record the listing URL and the link's
   `rel` value in Notes, and set Status.

---

## 4. Product Hunt launch checklist

Platform facts below were read from Product Hunt's own pages on 2026-09-19
(`producthunt.com/launch` and the "How to post a product" help article). Anything not on those
pages is marked as unverified.

### Assets

- [ ] **Thumbnail** — square; Product Hunt recommends 240×240. Source art:
      `apps/web/public/icons/` and `docs/brand/`.
- [ ] **Gallery images** — Product Hunt recommends 1270×760. Suggested set, each showing a real
      product screen, no mock numbers presented as real:
  1. Senders view (ranked senders).
  2. The action preview — count, sample, planned Gmail changes. This is the lead image; it is the
     claim.
  3. Activity with the Undo deadline visible.
  4. The published storage list from `/security` with the trust line.
  5. Pricing grid.
  - Use the dev test mailbox or the inbox simulator's made-up senders. **Never screenshot a real
    inbox** — subject lines and sender names are personal data.
  - Captions come from **F1**.
- [ ] **Tagline** — T2 (or T1). Confirm the character limit in the form; not verified by fetch.
- [ ] **Description** — S-PH (the help article says "within 260 characters").
- [ ] **Link** — `https://declutrmail.com/?ref=ph`.
- [ ] **Topics** — Email, Productivity, Privacy (pick from PH's list; see block C).
- [ ] **Pricing** — Freemium / free plan available (1.4).
- [ ] **First comment** — M1, with the `[FOUNDER: …]` line written by the founder.
- [ ] **Demo video (optional)** — a screen recording of one preview → confirm → undo loop in the
      simulator. Whether PH requires or favors video is unverified.
- [ ] **Promo code (optional)** — Founding Pro is already a public $129/year offer for the first 250
      paying users. Do not invent a separate PH discount unless it exists in
      `pricing.config.ts`.

### Timing

- [ ] Product Hunt's day runs on Pacific time; its launch guide names **12:01 am Pacific** as the
      time to launch for makers planning ahead. Schedule the post rather than publishing live.
- [ ] Pick a day the founder can be at the keyboard for the full 24 hours. Which weekday performs
      best is folklore — nothing on PH's own pages fetched here states it.
- [ ] Do not launch on the same day as Show HN. Each needs a full day of replies.
- [ ] Day before: confirm `/?ref=ph` loads, OAuth connect works, `/inbox-simulator` works signed
      out, `/pricing` matches 1.4, and billing checkout opens.

### On the day

- [ ] Post M1 as the first comment immediately after the launch goes live.
- [ ] Answer every comment, in first person, the same day. Use Q1 and Q2 for the two questions that
      will come up most. If someone asks something this file does not answer, check the repo or say
      "I don't know yet" — do not improvise a product fact.
- [ ] If someone asks how it compares to another tool, link the relevant `/vs/*` page and say
      nothing else about the other tool.
- [ ] Share the launch on X and LinkedIn with `?ref=x` / `?ref=linkedin` links to the site, and a
      plain link to the PH page. The ask is "take a look and tell me what's unclear".

### What NOT to do

- **Do not ask for upvotes.** Product Hunt's launch guide: "you cannot ask people directly to upvote
  your product. Instead, ask them to visit and comment." That applies to DMs, email, Slack groups,
  X posts, and the maker comment.
- Do not join or use upvote-exchange groups, pods, or paid upvote services.
- Do not ask friends to create accounts to vote.
- Do not email DeclutrMail users asking them to vote. (A plain "we launched, here's the page" note
  is a separate founder decision.)
- Do not offer discounts, credits, or Founding Pro spots in exchange for votes, comments, or
  reviews.
- Do not post testimonials, user counts, or "trusted by" lines. There are none.
- Do not name or characterize competitors in the listing, the maker comment, or replies.
- Do not claim "#1", "best", "most private", or "safest".
- Do not paste the listing copy into AI-directory "generate description" tools and accept the
  output — they reintroduce the phrases banned in 1.2.
- Do not relaunch or delete-and-repost if the day goes badly.

---

## Sources

Repo paths are relative to the repository root. Public URLs are the rendered form of the same
facts.

- **[S1]** `CLAUDE.md` §2.1 (privacy, trust-badge wording, banned counter-style claims), §2.2
  (canonical verbs), §2.4 (no category prediction).
- **[S2]** `apps/web/public/llms.txt` — canonical description, naming, "Please do not describe
  DeclutrMail as", page index. Public: https://declutrmail.com/llms.txt
- **[S3]** `packages/shared/src/copy/privacy.ts` — `PRIVACY_BADGE_HEADLINE`,
  `PRIVACY_NEVER_ITEMS`, `OAUTH_SCOPE_DISCLOSURE`, `CASA_VERIFICATION_APPROVED_ON`.
- **[S4]** `packages/shared/src/copy/action-safety.ts` — `ACTION_SAFETY_SUMMARY`,
  `ACTION_PREVIEW_CLAIM`, `DELETE_RECOVERY_CLAIM`, `MANUAL_ACTION_SCOPE_CLAIM`,
  `RECOMMENDATION_AI_DISCLOSURE`, `BRIEF_AI_DISCLOSURE`.
- **[S5]** `packages/shared/src/entitlements/pricing.config.ts` — `TIER_MANIFEST` (prices, inbox
  limits, `undoWindowDays`, `cleanupActionsPerMonth`, Founding Pro promo, capabilities per tier).
  Public: https://declutrmail.com/pricing and https://declutrmail.com/pricing.md
- **[S6]** `packages/shared/src/entitlements/undo-window.ts` — `UNIFORM_UNDO_WINDOW_DAYS`.
- **[S7]** `apps/web/src/features/marketing/comparison/comparison-data.ts` — the `DECLUTR` block
  (focus, providers, existingMail, futureMail, unsubscribe, preview, recovery, data, funding,
  price).
- **[S8]** `apps/web/src/app/(marketing)/how-it-works/page.tsx`. Public:
  https://declutrmail.com/how-it-works
- **[S9]** `packages/shared/src/contracts/gmail-data-inventory.ts` — entries with
  `showInMessageStorageList: true`, exported as `GMAIL_MESSAGE_STORAGE_LABELS`.
- **[S10]** `apps/web/src/app/(marketing)/security/page.tsx`. Public:
  https://declutrmail.com/security
- **[S11]** `apps/web/src/app/(marketing)/refunds/page.tsx`. Public: https://declutrmail.com/refunds
- **[S12]** `apps/web/src/features/marketing/landing/hero.tsx` — headline, sub, CTAs, trust strip.
- **[S13]** `apps/web/src/app/(marketing)/page.tsx` — landing metadata and the no-testimonials note.
- **[S14]** `docs/adr/0030-positioning-preview-guarantee.md` — lead with the preview guarantee;
  "never compress a generated claim".
- **[S15]** `packages/shared/src/contracts/signup-attribution-ref.ts` — `SIGNUP_ATTRIBUTION_REFS`,
  `parseSignupAttributionRef`.
- **[S16]** `packages/shared/src/observability/scrubber.ts` (utm allowlist) and
  `apps/web/src/features/marketing/site-analytics.test.ts` (behaviour).

**Directory pages fetched on 2026-09-19** (facts in section 3 are scoped to these pages on this
date):

- Product Hunt — https://www.producthunt.com/launch ;
  https://help.producthunt.com/en/articles/479557-how-to-post-a-product
- Hacker News — https://news.ycombinator.com/showhn.html
- AlternativeTo — https://alternativeto.net/faq/
- BetaList — https://betalist.com/faq
- Uneed — https://www.uneed.best/pricing
- Fazier — https://fazier.com/submit
- TinyLaunch — https://www.tinylaunch.com/pricing
- Launching Next — https://www.launchingnext.com/submit/
- 10words — https://10words.io/
- G2 — https://sell.g2.com/create-a-profile
- Futurepedia — https://www.futurepedia.io/submit-tool
- SideProjectors — https://www.sideprojectors.com/
- Indie Hackers — https://www.indiehackers.com/products (account is free; listing cost not stated)
- SaaSHub — https://www.saashub.com/submit (not the listing form; no listing cost stated)
- Fetched but uninformative, blocked, or missing: Capterra vendors page, Startup Stash add-listing,
  Microlaunch (`/pricing` 404), Peerlist (403), There's An AI For That (403), Toolify (403),
  Crunchbase help (403), F6S (bot check), Betapage (redirect to a 404).
- Not fetched: GetApp, StackShare.
