# DeclutrMail Distribution Strategy

> **Status:** Draft for founder review. Not a D-decision — a GTM playbook.
> Distill product hooks into D-candidates where flagged.
>
> **Thesis:** Building DeclutrMail is the easy 20%. The other 80% is getting
> the right humans to connect their Gmail. This doc is how we do that without
> becoming "another app with no users."

---

## 0. Why most indie products get zero users (and how we avoid it)

The "10 apps, no users" failure mode has four root causes. We design against
each one explicitly:

| Failure mode | What it looks like | Our counter |
|---|---|---|
| **Built for everyone → reached no one** | "It's for anyone with email" | Pick ONE beachhead tribe (privacy-anxious newsletter-drowners) |
| **Distribution treated as a post-launch event** | Build for 6 months, then "do marketing" | Distribution is a co-equal workstream NOW, before launch |
| **Launch = spike, mistaken for a loop** | Product Hunt day, then silence | Build 1–2 *compounding* channels (SEO + product-led loops) |
| **Nothing remarkable enough to spread** | "It cleans your inbox" (so do 20 others) | A wedge people *repeat*: "the cleaner that can't read your email" |

**The one principle:** pick channels that **compound** (each unit of work
makes the next easier) over channels that **spike** (one-time bursts). Spikes
seed; loops sustain. We use spikes to fuel loops, never as the strategy.

---

## 1. The beachhead: who we win first

Do **not** market to "Gmail users." Win one tribe so completely they
evangelize, then expand.

**Beachhead: privacy-conscious professionals drowning in newsletters /
promos who actively distrust Unroll.me.**

Why this tribe:
- **Reachable** — they cluster in identifiable places (r/privacy,
  r/degoogle, HN, privacy newsletters, productivity Twitter).
- **Evangelism-prone** — privacy people *recruit* their friends; it's tribal.
- **Pre-sold on the pain** — they already know Unroll.me sold inbox data to
  Uber (Slice Intelligence, 2017). The wound in the category is real and
  permanent. We are the answer to a fear they already have.
- **Willing to pay** — privacy-motivated users convert better than
  free-tool-seekers; our $9/$19 premium positioning fits.

Expansion rings after beachhead: (2) general inbox-zero / productivity
seekers → (3) freelancers/consultants with newsletter overload → (4) Team.

---

## 2. The wedge: the one sentence people repeat

Distribution dies without a remarkable, repeatable claim. Ours:

> **"The inbox cleaner that can't read your email."**

Backed by the verifiable badge **"Full bodies fetched: 0"** + the explicit
storage list (D228). This is not marketing spin — it's an architectural fact
we can *prove*, which makes it credible AND press-worthy.

Every channel below leans on this wedge. It is the reason a Reddit comment
gets upvoted, a journalist replies, an HN thread hits the front page, and a
user tells a friend.

---

## 3. Channels, ranked for THIS product

Ranked by leverage for a solo founder + AI agents. **Go deep on the top two
before touching the rest.** Spreading across all of them is the trap.

### Tier 1 — Compounding (do these first, relentlessly)

#### 3.1 SEO: capture demand that already exists ⭐ highest leverage
The category has existing search volume — we *capture* demand, we don't have
to *create* it. Three content clusters:

1. **"Alternative to" pages** (highest intent, highest convert):
   - `unroll.me alternative` (huge — privacy refugees actively searching)
   - `clean email alternative`, `sanebox alternative`, `mailstrom alternative`,
     `leave me alone alternative`, `unlistr alternative`
   - Each page: honest comparison table, our privacy column glows, clear CTA.
2. **Privacy-anxiety queries** (our wedge converts these at outsized rates):
   - `is unroll.me safe`, `does clean email read your emails`,
     `can email cleaners see my emails`, `is it safe to give gmail access`
   - These searchers are *primed* for "the one that can't read your email."
3. **How-to / job-to-be-done** (top of funnel, builds authority):
   - `how to mass unsubscribe gmail`, `how to clean up gmail inbox`,
     `delete thousands of emails gmail`, `gmail storage full how to fix`,
     `how to unsubscribe from all emails at once`

> Why SEO is #1: it compounds (pages rank for years), it matches premium
> positioning (high-intent buyers, not freebie hunters), and a solo founder
> with AI can produce high-quality comparison/how-to content at volume.

#### 3.2 Free tools as SEO + top-of-funnel magnets
Ship a *free, no-signup-required* micro-tool that ranks AND demonstrates the
privacy posture:
- **"Gmail Storage Analyzer"** / **"Who emails you most?"** — read-only,
  shows the user their noisiest senders, ends with "want to act on this? →
  DeclutrMail." Proves "Full bodies fetched: 0" *in the act of using it.*
- These rank for high-volume queries AND are inherently shareable (people
  screenshot their "top 10 spammiest senders").
- **D-candidate:** a public, read-only "noise report" entry point.

#### 3.3 Product-led growth loops (build distribution INTO the product)
The cheapest user is the one your existing user brings. Bake loops in:
- **Shareable cleanup artifact:** after a cleanup, generate a clean,
  screenshot-ready stat card — *"I archived 12,400 emails and unsubscribed
  from 38 senders with DeclutrMail. Bodies it read: 0."* The "0" is the hook
  that makes people ask "wait, how?" → **D-candidate.**
- **Referral mechanic:** free users earn additional lifetime cleanup actions
  (beyond the 5 in D19) for each referral who connects Gmail. Costs us
  nothing, directly feeds the funnel → **D-candidate.**
- **Unsubscribe digest as a loop:** the weekly Brief (Pro) is naturally
  forwardable; add a tasteful "sent via DeclutrMail" footer the founder
  approves.

### Tier 2 — High-value but manual (start once Tier 1 is rolling)

#### 3.4 Reddit & privacy communities (where the pain is voiced out loud)
- Subreddits: r/gmail, r/productivity, r/digitalminimalism, r/privacy,
  r/degoogle, r/inboxzero, r/selfhosted (privacy-adjacent).
- **Rule: be genuinely useful first, promote second.** Answer "how do I
  clean my inbox" threads with real help; mention DeclutrMail only where it
  honestly fits. Reddit punishes spam and rewards usefulness with durable,
  Google-indexed threads (which also help SEO).
- The privacy angle is *built* for r/privacy and r/degoogle — this is where
  the wedge spreads fastest.

#### 3.5 Founder-led "building in public" / technical content
The privacy architecture is genuinely interesting engineering. Write it up:
- **"How we built a Gmail cleaner that never reads your emails"** — the OAuth
  scope choices, snippet-only storage, OIDC webhook auth. This is catnip for
  Hacker News and earns backlinks (which feed SEO §3.1).
- Document the journey (MRR, lessons) on X/LinkedIn/Indie Hackers. Builds an
  owned audience that compounds across every future launch.

### Tier 3 — Spikes (use to *seed* loops, never as the strategy)

#### 3.6 Launch platforms
- **Show HN** with the privacy-architecture angle (HN rewards technical
  honesty far more than "I built a SaaS"). Highest fit of any platform here.
- **Product Hunt** — coordinate for a launch-day spike; convert the spike
  into referral-loop seed users and email signups.
- **BetaList, microlaunch, Indie Hackers** — secondary seeding.
- Treat all of these as *fuel for the loops*, not a destination. A PH badge
  is not a growth strategy.

### Explicitly DEFERRED (don't waste time/money here yet)
- **Paid ads** — premium SaaS at $9/$19 rarely has CAC headroom before you
  have testimonials + a measured conversion funnel. Defer until §3.1/§3.3 are
  proven and you know LTV.
- **Influencer/sponsorships** — only after a measured funnel justifies CAC.
- **Cold outreach** — wrong fit for a self-serve consumer-prosumer product.

---

## 4. The compounding flywheel (how the pieces connect)

```
Privacy wedge ("can't read your email")
        │
        ▼
SEO + free tools ──► high-intent visitors ──► connect Gmail
        ▲                                          │
        │                                          ▼
   backlinks                              shareable cleanup card
        │                                          │
   HN/technical posts ◄── building in public       ▼
        ▲                                    referral loop ──► new users
        └──────────── more reach / authority ◄─────────┘
```

Each loop feeds the next. Spikes (HN/PH) inject energy; SEO + product loops
retain and compound it.

---

## 5. 90-day concrete plan (solo founder + AI agents)

**Pre-launch / weeks 0–4 — set the table:**
- [ ] Stand up the marketing site with the wedge as the hero + "Full bodies
      fetched: 0" badge (D228 copy, verbatim).
- [ ] Publish the first 5 SEO pages: the 5 top "X alternative" comparisons.
- [ ] Write the cornerstone "how we built a Gmail cleaner that can't read
      your email" post (hold for HN launch day).
- [ ] Ship ONE free read-only tool (Storage Analyzer / Noisiest Senders).
- [ ] Set up a waitlist + a simple "building in public" cadence (1 post/wk).

**Launch / weeks 4–8 — seed the loops:**
- [ ] Show HN with the architecture post → drive to waitlist/free tool.
- [ ] Product Hunt launch; funnel spike into referral loop.
- [ ] Start the Reddit cadence: 3 genuinely-helpful comments/week in target
      subs; zero spam.
- [ ] Ship the shareable cleanup stat card + referral mechanic (D-candidates).

**Compound / weeks 8–12 — pour fuel on what worked:**
- [ ] Publish 2 SEO pages/week (alternatives + how-to + privacy-anxiety).
- [ ] Double down on the single channel showing the best activation rate;
      cut the rest.
- [ ] Add 2–3 more free tools if the first drove signups.
- [ ] Collect testimonials (esp. privacy-motivated quotes) → feed comparison
      pages + future paid-ad headroom analysis.

---

## 6. What to measure (and what to ignore)

**Measure (the funnel that matters):**
- **Activation, not signups:** % of signups who **connect Gmail + complete
  first cleanup**. This is the only top-of-funnel number that predicts
  revenue. A signup who never connects Gmail is noise.
- **Channel → activation** (not channel → visits): which source produces
  *connectors*, not clickers.
- **Free → Plus** and **Plus → Pro** conversion vs. the D19 upgrade triggers.
- **Referral coefficient** (invites sent × accept rate) once the loop ships.
- **SEO compounding:** ranking pages and organic connectors/month trend.

**Ignore (vanity):**
- Raw pageviews, PH upvotes, X followers, "impressions." A Product Hunt
  #1 with no activated users is a loss. Optimize for connected mailboxes.

---

## 7. Hard rules so distribution never violates the product

The privacy wedge is the whole game — protect it in every channel:
- **Never overstate privacy.** Use **"Full bodies fetched: 0"** + the storage
  list (D228). The banned phrase **"Bodies read: 0 forever"** must not appear
  in any ad, post, comparison page, or tweet. Marketing copy is bound by the
  same microcopy rules as the app (CLAUDE.md §2.1).
- **Canonical verbs** (Keep · Archive · Unsubscribe · Later) in all
  marketing too — never the internal word "Screen" (D227).
- **No dark-pattern referral mechanics** — the privacy tribe will detect and
  punish them, destroying the wedge.
- **Comparison pages stay honest** — name competitors' real strengths;
  credibility is the conversion driver for this audience.

---

## 8. Product hooks to turn into D-candidates

These are where distribution and product overlap — surface to founder:
1. Public read-only "noise report" entry point (free SEO tool, §3.2).
2. Shareable post-cleanup stat card with the "Bodies read: 0" hook (§3.3).
3. Referral mechanic: earn extra lifetime cleanup actions for referrals (§3.3).
4. Tasteful "via DeclutrMail" footer on forwardable Brief digests (§3.3).
