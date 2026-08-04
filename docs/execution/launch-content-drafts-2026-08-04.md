# Launch content drafts — 2026-08-04

**Status:** drafts for founder review. Nothing here is posted; posting is a founder action.
**Before posting any asset:** fill every `[SLOT]`, delete the meta lines (Audience / Lead claim),
and re-read the draft against the constraint block below.

**Sources:** `docs/execution/packaging-2026-08-02.md` (ratified packaging, hero, Founding Pro),
`docs/adr/0030-positioning-preview-guarantee.md` (positioning rules),
`packages/shared/src/copy/privacy.ts` + `packages/shared/src/copy/action-safety.ts` (locked claims),
`apps/web/src/features/marketing/` (voice). Reddit drafts follow the
`reddit-comments-declutrmail` skill's voice rules.
**Domain note:** the canonical URL is **declutrmail.com** (D128 — the `.ai` site 301s to it). The
reddit skill's context bank still says `.ai`; that guidance is stale, use `.com` everywhere.

---

## Constraint set (binding on every asset)

**May claim (all verified against code/docs):**

- Hero: **"Clear thousands of emails by sender — and see exactly what moves."** Kicker: _For
  inboxes you gave up on._ Subhead names Plus for the "rules find it" clause.
- Preview: exact current count + samples + the precise Gmail changes before anything moves;
  re-checked at execution.
- Privacy: **"Full bodies fetched: 0"** + the published list of stored Gmail fields, generated
  from the typed registry the fetch code uses (contract-tested). Stored fields include sender,
  subject, the short snippet Gmail already shows in the inbox list ("Gmail Preview"), dates,
  labels, read state. Never: full bodies, HTML, attachments, inline images, raw MIME, headers
  beyond From/Subject/To/Cc/List-Unsubscribe.
- Per-sender activity ledger; undo from Activity for **Archive, Later, Delete** — 7 days
  Free/Plus, 30 days Pro. Delete also lands in Gmail Trash (~30 days, separate, ends early if
  Trash is emptied). **A delivered unsubscribe cannot be recalled** — say so wherever undo is
  mentioned.
- Screener **collects new senders for review (Plus)** — mail still arrives in Gmail
  (the ratified verb is _collects_, never a withholding verb).
- Autopilot: Plus = rules find matching mail, you approve every batch. Pro = approve the rule
  once, it runs on its own.
- Prices: $0 / $9/mo ($90/yr) / $19/mo ($190/yr). **Founding Pro $129/yr, first 250, locked
  while active** — no "X left" counter unless it reads real redemptions.
- Free = full manual workflow, 50 senders actionable/month. Bulk cap 1,000 senders per action.
- AI disclosure (if asked or preempting): recommendation explanations send Anthropic the sender
  identity, domain, and numerical engagement signals (all tiers); the Pro Daily Brief also sends
  sender, subject, and Gmail's snippet. Never bodies.
- Prelaunch, zero users, solo founder — say it plainly; honesty is the wedge.
- The 12,418-emails / 143-senders arithmetic **only when labeled illustrative**.

**Banned:** "clean" as a verb on the user's data (the noun "cleanup" is fine) · "never reads
your email" · "every action is reversible" · "blocks new senders" · "metadata only" as a
self-claim · "Bodies read: 0 forever" · any invented metric, user count, or testimonial ·
compressing the generated storage list into a paraphrase.

---

## 1. Show HN

**Audience:** HN — skeptical engineers, arriving-scared about OAuth; safety-adjacent value lands
here. **Lead claim:** the falsifiable privacy architecture (no body fetching, code-generated
storage list).

**Title (70 chars):**

```
Show HN: DeclutrMail – Gmail cleanup that never fetches a message body
```

Alt title (68 chars): `Show HN: Clear Gmail by sender, with a preview of exactly what moves`

**Body (≈290 words):**

```
I kept abandoning my inbox because the honest options were bad: process
thousands of emails by hand, or hand a third-party app the full text of a
decade of mail.

DeclutrMail is my attempt at a third option, built around one architectural
rule: the backend cannot fetch message bodies. The Gmail adapter requests an
allowlisted envelope — From, Subject, To, Cc, List-Unsubscribe headers,
labels, dates, and the short snippet Gmail already shows in your inbox list.
The trust badge reads "Full bodies fetched: 0", and the published list of
stored fields is generated from the same typed registry the fetch code uses,
with contract tests, so the marketing page can't quietly drift from the code.

The product: your inbox has thousands of emails from a few hundred senders,
so decisions happen per sender — Keep, Archive, Unsubscribe, Later, or
Delete. Before anything moves you see the exact current count, samples, and
the precise Gmail changes; it re-checks Gmail at execution. Every outcome
lands in a per-sender ledger. Archive, Later and Delete are undoable for 7
days (30 on Pro). A delivered unsubscribe can't be recalled, so the preview
marks it one-way.

Honest context: prelaunch, zero users, and Gmail shipped sender-ranked
Manage Subscriptions last July. My bet is the parts Gmail won't build are
the preview-before-mutation, the ledger, and a falsifiable data boundary.
The AI parts are disclosed: recommendation explanations send sender identity
and engagement numbers to Anthropic; the Pro daily brief also sends subject
and Gmail's snippet. Never bodies.

Free covers the full manual workflow (50 senders/month); Plus is $9/mo,
Pro $19/mo.

What I'd love feedback on: does a code-generated storage list actually earn
trust, or is Gmail OAuth to a third party a dealbreaker regardless? And
where would you expect this preview model to break?

https://declutrmail.com
```

---

## 2. Product Hunt

**Audience:** browsing early adopters — outcome first, trust second (ADR-0030: weaker surface
for safety-value, so the payoff leads). **Lead claim:** the hero outcome — clear by sender, see
exactly what moves.

**Tagline (50 chars):**

```
Clear Gmail by sender — and see exactly what moves
```

**Description:**

```
For inboxes you gave up on. DeclutrMail turns thousands of emails into a few
hundred sender decisions: Keep, Archive, Unsubscribe, Later, or Delete.
Before anything moves you see the exact count, samples, and the precise
Gmail changes — and every outcome lands in a ledger with an undo window for
Archive, Later, and Delete. It never fetches message bodies; the privacy
page lists exactly which Gmail fields it stores, generated from the code.
Free for 50 senders/month. On Plus, rules find matching mail and you approve
every batch; on Pro, approved rules run on their own.
```

**Maker first comment:**

```
Hi PH — solo founder here.

I built DeclutrMail because I declared email bankruptcy [SLOT: your real
count — "twice", "three times"] and every cleanup tool asked me to trade one
problem for another: give a stranger's server the full text of ten years of
email so it could tidy my inbox.

Two decisions shaped the whole product.

First, the unit. An inbox with thousands of emails only has a few hundred
senders behind it, and processing it email by email is why inbox zero
always lapses. So everything in DeclutrMail is per sender: one decision covers
everything that sender ever sent, and the queue is a few hundred decisions
long, not twelve thousand.

Second, a constraint I refused to break: the backend cannot fetch message
bodies. Not "we don't look" — the Gmail adapter is only able to request an
allowlisted set of fields (sender, subject, the short snippet Gmail already
shows you, dates, labels). The trust badge says "Full bodies fetched: 0",
and the published list of stored fields is generated from the same registry
the fetching code uses, so the claim is checkable rather than vibes.

The part I'm most attached to is the preview: before any action runs, you
see the exact current count, samples, and the precise Gmail changes. "Are
you sure?" is not a preview. A number you can hold me to is. Archive, Later
and Delete are undoable (7 days, 30 on Pro); a delivered unsubscribe isn't,
and the product says so instead of pretending everything is reversible.

Full honesty: this is a prelaunch product with zero users, so there are no
testimonials — you'd be among the first. Free tier covers the full manual
workflow. Plus ($9/mo) adds rules that find matching mail for your approval
plus a Screener that collects new senders for batch review (their mail
still arrives). Pro ($19/mo) is
where approved rules run on their own. Launch offer: Founding Pro at
$129/yr for the first 250, locked while your subscription stays active.

I'll be here all day — the more skeptical the question, the better.
```

---

## 3. X / Twitter

**Audience:** browsing builders/productivity crowd — outcome-led, one claim per tweet.
**Lead claim (thread):** the sender arithmetic + see-what-moves outcome. Each tweet ≤280 chars
(verified).

**Launch thread (7 tweets):**

```
1/ Your inbox has thousands of emails. They come from a few hundred
senders. Email-by-email cleanup fails because that N is unsustainable.

Today I'm launching DeclutrMail: one decision per sender — and you see
exactly what moves before it moves.

https://declutrmail.com
```

```
2/ The core guarantee: nothing moves blind.

Every action shows the exact current count, samples, and the precise Gmail
changes — "412 messages → All Mail" — then re-checks Gmail at execution.

"Are you sure?" is not a preview. A count you can hold me to is.
```

```
3/ Five verbs, one per sender: Keep, Archive, Unsubscribe, Later, Delete.

Archive, Later and Delete come with an undo window — 7 days, 30 on Pro.

A delivered unsubscribe can't be recalled, by any tool. So the preview
marks it one-way instead of pretending.
```

```
4/ The privacy claim is falsifiable, not vibes.

The badge reads "Full bodies fetched: 0", and the published list of Gmail
fields we store is generated from the same typed registry the fetch code
uses. The page can't drift from the code without tests failing.
```

```
5/ New senders: the Screener (Plus) collects them for review. They still
arrive in your Gmail — nothing is blocked.

You decide in one batch, on your schedule, instead of one interruption at
a time.
```

```
6/ Pricing is the same promise at three lengths.

Free — see what's noisy, fix some by hand (50 senders/mo).
Plus $9/mo — rules find it, you approve every batch.
Pro $19/mo — it just runs.

Launch offer: Founding Pro, $129/yr for the first 250, locked while you
keep it.
```

```
7/ There are no testimonials on the site because there are no users yet.

Launching at zero, in public, with claims you can check against the
product. If that's how you want email tools built, come break it:

https://declutrmail.com
```

**Standalone tweets (following week):**

```
Inbox arithmetic, from an illustrative sample inbox: 12,418 emails traces
back to 143 senders.

You don't have an email problem. You have a sender problem. One verdict
per sender covers everything they ever sent.
```

```
Our privacy page's list of stored Gmail fields isn't written by marketing.
It's generated from the typed registry the fetch code reads. Add a field
and the public list changes — or contract tests fail.

"Trust us" is a sentence. This is a mechanism.
```

```
Honest limitation: no tool can undo a delivered unsubscribe.

DeclutrMail marks it one-way in the preview, before you approve it. The
point of no return should look like one.
```

```
The Screener (Plus): new senders collect in one place for batch review.
They still arrive in your Gmail — nothing is blocked or hidden.

A stranger's newsletter shouldn't force a decision the moment it lands.
```

```
Founding Pro: $129/yr (list $190) for the first 250 people, locked while
your subscription stays active.

No countdown widget — it ends when 250 real people have it.
```

---

## 4. LinkedIn launch post

**Audience:** professional network — warm audience, personal-story angle carries it.
**Lead claim:** the founder story + see-what-moves outcome; honesty about launching at zero.

```
I've given up on my inbox more than once. [SLOT: one true personal line —
e.g. "At its worst it hit N unread." — use a real number or delete.]

Every cleanup attempt failed the same way. Not discipline — arithmetic. An
inbox with thousands of emails is thousands of decisions if you process it
email by email. Nobody sustains that. But those emails come from a few
hundred senders, and a sender usually needs exactly one decision.

So I spent [SLOT: real duration] building DeclutrMail as a solo founder,
around two rules:

You see exactly what moves, before it moves. Every action shows the exact
count, samples, and the precise Gmail changes — and lands in a ledger with
an undo window for Archive, Later, and Delete. (A delivered unsubscribe
can't be recalled, so the product says that too.)

It never fetches message bodies. The trust badge reads "Full bodies
fetched: 0", and the list of Gmail fields it does store is published —
generated from the code that does the fetching, not written by marketing.

Today it's live: https://declutrmail.com

Full transparency: it launches with zero users, so there are no
testimonials and no invented counters — just claims you can check against
the product. The free tier covers the full manual workflow for 50 senders
a month, no card.

If your inbox is the one you gave up on, I'd genuinely value you trying it
and telling me where it breaks.
```

---

## 5. Reddit

Both posts follow the skill's rules: value first, founder status disclosed, lowercase register,
no bold/bullets inside the draft, OAuth heads-up wherever the post invites trying it, and no
virtue-naming — the constraint is shown, not labeled. Never post the same text twice; retype
with variation if reusing the angle.

### 5a. r/productivity — the workflow (product mentioned once, at the end)

**Audience:** people drowning in email who distrust self-promo. **Lead claim:** the sender-first
method itself — works in plain Gmail without any tool.

**Title:**

```
inbox zero kept lapsing for me until i stopped deciding per email and started deciding per sender
```

**Body:**

```
every cleanup attempt i made failed the same way. i'd spend a sunday getting
to zero, feel great, and be back to thousands within a couple of months. the
problem wasn't discipline, it was arithmetic: if your inbox has thousands of
emails, processing it email by email is thousands of decisions. nobody
sustains that.

what stuck was changing the unit. those thousands of emails come from a few
hundred senders, and most senders only ever need one decision. so the ritual
is: work through senders, not messages.

you can do this in plain gmail today. search from:whoever@example.com, tick
select all, then "select all conversations that match this search", and
archive or delete the lot. add older_than:1y if you only want the backlog.
for the unsubscribe half, gmail's manage subscriptions screen (left nav,
rolled out last year) lists senders by volume with an unsubscribe button.
do your top 20 senders by volume and you've usually handled a huge share of
the pile. after that it's maintenance, not a project.

two honest warnings from doing this a lot. bulk moves in gmail show no
preview of what exactly is about to move, so a sloppy search can archive
something you cared about. and unsubscribe is one-way — no tool anywhere
can recall a delivered request, so read twice before you click.

disclosure: i ended up building a small tool for exactly this ritual
(declutrmail.com) because i wanted the missing pieces — a count-and-sample
preview before anything moves, an undo window, and a per-sender record of
what happened. i'm the founder, so weigh that accordingly. the manual
version above works fine without it, and heads up that the tool asks for
google oauth since it actually changes labels in your inbox.
```

### 5b. r/SideProject — the builder angle (the privacy constraint story)

**Audience:** builders — interested in the constraint and its costs, allergic to pitch decks.
**Lead claim:** the architectural constraint (backend cannot fetch bodies) and what it cost.

**Title:**

```
i'm launching a gmail cleanup saas where the backend can't fetch message bodies — the constraint shaped the whole product
```

**Body:**

```
solo founder, launching this week after [SLOT: real duration]. the product
is declutrmail.com — you clear gmail by sender instead of by email. but the
part that might interest builders is the constraint i started with: the
server is never allowed to fetch a message body. not policy, architecture.

the gmail adapter can only request an allowlisted set of fields — from,
subject, to, cc, list-unsubscribe headers, labels, dates, and the short
snippet gmail already shows in the inbox list. the privacy page shows "full
bodies fetched: 0" plus the list of stored fields, and that list is
generated from the same typed registry the fetching code reads. adding a
field means updating the registry, which changes the public list, or
contract tests fail. i wanted a privacy claim someone could actually
falsify instead of another "we take your privacy seriously".

what the constraint cost me: no content-based anything, so some features
were genuinely harder to build than they'd be with full text. what it
bought: a pitch i can defend line by line to the most skeptical reader,
which for a gmail oauth app is most readers.

the second rule was that nothing moves blind. every action shows the exact
current count and the precise gmail changes before it runs, then re-checks
gmail at execution. archive, later and delete get an undo window. a
delivered unsubscribe doesn't, and the ui says so instead of pretending
everything's reversible.

launching at zero users and saying so — no invented counters, no
testimonials, because there aren't any yet. free tier does the full manual
workflow, paid is $9/$19.

heads up if you try it: it asks for google oauth since it actually changes
labels in your inbox. would love builder eyes on two things — where does
the no-bodies constraint break down, and does a code-generated storage
list actually read as trustworthy or just as more marketing?
```

---

## 6. Cold outreach — newsletter authors / bloggers on email overload

**Audience:** writers who cover email overload, inbox management, digital minimalism, or
privacy — people pitched constantly. **Lead claim:** personalized to their beat — default is
the preview guarantee; swap to the storage list for privacy-beat writers.

**Usage rules (not part of the email):** send individually, never mail-merged. Fill the
`[REFERENCE]` slot only after actually reading their piece — if you can't, don't send. One
follow-up maximum, after a week, then stop. Target selection: authors who have written about
unsubscribe theater, inbox bankruptcy, Gmail storage, or app-permission risk in the last year.

**Subject options:**

```
re: [THEIR PIECE — short title] — a gmail tool that publishes its storage list
```

```
[FIRST NAME] — the preview your unsubscribe piece asked for
```

**Body:**

```
Hi [FIRST NAME],

[REFERENCE — one specific sentence proving you read their work, e.g. "Your
piece on unsubscribe theater made the point that cleanup tools ask for more
trust than they earn — that line stuck with me."]

I'm a solo founder launching DeclutrMail this week — Gmail cleanup that
works by sender instead of by email, one decision clearing everything a
sender ever sent. Two things make it relevant to [NEWSLETTER/BLOG NAME]
rather than another pitch:

Before anything moves, it shows the exact count, samples, and the precise
Gmail changes — and keeps a per-sender ledger with an undo window for
Archive, Later, and Delete. And it never fetches message bodies: the trust
badge reads "Full bodies fetched: 0", with the list of stored Gmail fields
published and generated from the code that does the fetching.

It's prelaunch with zero users, so I have no traction numbers to show you —
only claims you can check against the product. If it's useful for a future
issue, I'll set you up with Pro, no strings, and I'm happy to answer the
skeptical questions in writing. [OPTIONAL: and if you'd rather just look,
here's a 90-second walkthrough: LINK.]

If it's not a fit for [NEWSLETTER/BLOG NAME], no reply needed.

[NAME]
declutrmail.com
```

---

## 7. Boilerplate — "What is DeclutrMail" (directories/listings)

**Audience:** directory readers scanning many listings. **Lead claim:** the hero outcome, with
the privacy proof one sentence behind it.

```
DeclutrMail is a Gmail cleanup tool for inboxes you gave up on. Instead of
processing email by email, you make one decision per sender — Keep, Archive,
Unsubscribe, Later, or Delete — and clear thousands of emails at once.
Before anything moves, DeclutrMail shows the exact count, samples, and the
precise Gmail changes, and every outcome lands in a per-sender activity
ledger with an undo window for Archive, Later, and Delete (7 days; 30 on
Pro). It never fetches message bodies or attachments — the trust badge
reads "Full bodies fetched: 0", with a published list of stored Gmail
fields generated from the code. Free covers the full manual workflow for
50 senders a month. On Plus ($9/mo), rules find matching mail for your
approval and a Screener collects new senders for batch review; on Pro
($19/mo), approved rules run on their own. Built by a solo founder.
https://declutrmail.com
```
