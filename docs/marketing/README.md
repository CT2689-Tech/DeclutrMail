# Marketing hub

The one place for DeclutrMail marketing: what is true, what to do next, and where
every other marketing file lives. Start every marketing session here. If another
marketing doc disagrees with this one, this one wins; product facts (prices,
limits, privacy) are owned by code and win over both.

Last reviewed: 2026-11-19.

## Founder blockers

Only you can clear these. Each one holds back a channel.

1. **Business postal address** (`BUSINESS_POSTAL_ADDRESS`, empty). Until it is set,
   every commercial email is refused: newsletter signups, the sync reminder, the
   lapse re-engagement email and the weekly-value receipt. Steps:
   `docs/log/founder-followups/2026-11-17-set-business-postal-address.md`.
2. **Brand handles and Product Hunt Coming Soon** (Phase A below). Nothing launches
   without them.
3. **Official profiles for the site's structured data** (`ORGANIZATION_SAME_AS`),
   once the handles exist. SEO audit §1, decision 2.

## Where the truth lives

| What                                        | Source of truth                                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Prices, plans, limits, undo window          | `packages/shared/src/entitlements/pricing.config.ts` (live: https://declutrmail.com/pricing.md)  |
| Privacy sentence and storage list           | `packages/shared/src/contracts/gmail-data-inventory.ts`                                          |
| Homepage headline and launch copy           | `packages/shared/src/copy/launch` (`WS3_COPY['ws3.home.h1']`)                                    |
| Marketing pages                             | `apps/web/src/features/marketing/`; new content modules register in `content-registry.ts`       |
| Positioning: why we sell the preview        | `docs/adr/0030-positioning-preview-guarantee.md`                                                 |
| Voice, audience, competitors, objections    | `.agents/product-marketing.md` (marketing skills read this exact path)                           |
| Copy truth constraints (T1–T7)              | `repositioning-copy-spec-2026-08-01.md` §1; `.claude/hooks/check-microcopy.sh` enforces part     |
| Directory listing copy and tracker          | `directory-submissions.md`                                                                       |
| Blog publication (approval-gated)           | `content-pipeline.md`                                                                            |
| Search monitoring                           | `seo-engine.md`                                                                                  |
| Latest SEO audit and open opportunities     | `seo-skills-audit-2026-11-17.md` (raw evidence: `seo-skills-audit-2026-11-17-research.md`)       |
| Installed marketing skills                  | `skills.json`                                                                                    |
| Open founder actions                        | `docs/log/founder-followups/`                                                                    |

Never copy a price, limit or count into a doc. Link the source or read `/pricing.md`.

## Rules for anything public

- **Site copy is Tier 2: ship it** (CLAUDE.md §2.0, §2.7). The founder approves posts
  from the founder's own accounts, each blog publication and each directory submission.
- **Every claim has an openable source and a date.** No fake users, testimonials or
  user counts. Founder-mailbox numbers are labelled as yours and re-queried when you
  publish.
- **Paid marketing:** up to $200 a month in total (founder decision 2026-11-17). Log
  spend made outside the content pipeline; it cannot see it.
- **Default link:** https://declutrmail.com/inbox-simulator (no signup needed). The
  homepage only when someone asks about the company.

| Topic     | Say                                                                       | Never say                                                       |
| --------- | ------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Privacy   | **We never fetch or store full email contents.** + the storage list       | A zero counter of bodies read, "privacy-first", "never reads your email" |
| Verbs     | Keep · Archive · Unsubscribe · Later · Delete                             | "Screen"                                                        |
| Undo      | Archive, Later and Delete can be undone; Delete needs the mail in Trash   | "Every action is reversible" (an unsubscribe cannot be recalled) |
| Autopilot | Preview first, then Act now or Watch first                                | Predicted categories; Pro as buyable today                      |
| Google    | "Google approved a verification (21 Apr 2026)"                            | "Google certified us"                                           |
| Prices    | What `/pricing.md` says today                                             | Old monthly prices, Founding Pro, "50 actions"                  |
| Refunds   | Link https://declutrmail.com/refunds                                      | The old 30-day money-back promise                               |

Not channels: Discord or Slack communities, G2/Capterra review pushes before real
reviews exist, privacy-absolutist forums, auto-posting, upvote pods, alt accounts.

## Accounts

- **Brand `@declutrmail`:** announcements, support, Product Hunt, directories, X originals.
- **One human account:** Reddit, Hacker News, Product Hunt maker, X replies. Say "I built
  it" whenever you name the product. Never a second personal or "random user" account.

| Surface                    | Account | Rule                                                                         |
| -------------------------- | ------- | ---------------------------------------------------------------------------- |
| r/gmail, r/productivity    | Human   | Native Gmail answer first; product only if they asked for a tool; link in bio |
| r/digitalminimalism        | Human   | Never the product, never a link                                              |
| r/SideProject              | Human   | Simulator + one differentiator                                               |
| Show HN, Product Hunt      | Human   | First link is the simulator; answer their question                           |
| X originals / X replies    | Brand / Human | 1 original a day at most; product link in at most 1 reply in 5         |
| LinkedIn                   | Company | Story in the post, link in the first comment                                 |

One moderator warning in a subreddit means bio-only there for good.

## Daily loop (about 45 minutes on weekdays)

Agents draft; you post.

1. **Reddit (≤ 2 replies a day).** Watch (F5Bot or saved search): `unroll.me alternative`,
   `clean email safe`, `trimbox`, `mailstrom`, `sanebox`, `leave me alone app`,
   `gmail storage full`, `mass delete gmail`, `bulk unsubscribe`, `delete emails by sender`.
   Ask an agent: "Draft a Reddit comment for <url> with the ct-reddit skill." Rewrite
   anything that reads like a template. Test: is it still the best answer if
   DeclutrMail did not exist?
2. **X.** Replies to people stuck on Gmail storage or newsletters, useful first. At most
   one original: a preview clip or founder-mailbox numbers labelled as yours.
3. **Hacker News (3 comments a week).** hn.algolia.com → "gmail", past month. Only where
   you know first-hand. No product until Show HN.

Gmail facts worth teaching without a link: archive frees no storage; Trash counts
against the 15 GB until emptied; Drive and Photos share the quota; freed space can
take 48–72 hours to show; delete is not unsubscribe; report phishing, never
unsubscribe from it.

## Plan (tick boxes as you go)

### A. Handles — founder, about 30 minutes

- [ ] Reserve `@declutrmail` on X, Reddit, LinkedIn (company), Bluesky, Product Hunt
- [ ] One human handle; both bios link the simulator
- [ ] F5Bot (or a saved search) on the keywords above
- [ ] Product Hunt Coming Soon page collecting followers
- [ ] Hacker News: 3 comments this week, no product

### B. Attribution — built

First-touch `ref` survives Google sign-in, plus a separate "how did you hear about us"
answer (implemented 2026-08-26). Never add the two together. Still open: confirm it on
production (launch gate G4).

### C. Launch words — agent drafts, founder approves

- [ ] 12-answer crib for HN and Product Hunt comments. Answer 1: Google verification is
      not certification. Answer 2: why this vs Gmail's Manage subscriptions (`/vs/gmail`).
      Each answer links a live page; the first link is the simulator.
- [ ] Show HN body, Product Hunt maker comment, X launch thread — written fresh against
      the live homepage and `/pricing.md` (the August drafts were deleted as wrong).

### D. Proof — founder data, agent charts

- [ ] Query current founder-mailbox stats (messages, top senders, unsubscribe channels, size)
- [ ] Publish "Anatomy of my inbox" on `/blog` with those numbers labelled as yours
- [ ] One real 50-sender unsubscribe session, then a 30-day "who actually stopped" follow-up
- [ ] Film a real 20–30 s preview → confirm → undo clip (the X pin and Product Hunt lead).
      No generated Gmail screens.

### E. Directories — after B is confirmed on production

- [ ] AlternativeTo and SaaSHub, pointing at the `/vs` pages (copy: `directory-submissions.md`).
      The SEO audit found AlternativeTo, GetApp and Capterra filling the "alternative to X" searches.
- [ ] LinkedIn company page and Crunchbase, with identical facts
- [ ] GetApp, Capterra and G2 only once real reviews exist

### F. Launch week — only when every gate is green

| Gate | What                                     | State (2026-11-19)                  |
| ---- | ---------------------------------------- | ----------------------------------- |
| G1   | Production homepage matches the repo     | Built; confirm production HTML      |
| G2   | `/vs/gmail` and `/vs/unroll-me` live     | Built; confirm production           |
| G3   | 12-answer crib                           | Open (C)                            |
| G4   | Attribution survives Google sign-in      | Built; confirm production           |
| G5   | Product Hunt Coming Soon ≥ 1 week        | Open (A)                            |
| G6   | "Anatomy of my inbox" published          | Open (D)                            |
| G7   | Simulator link preview unfurls on X/Slack| Built; confirm production           |

Before booking a slot, on production: run `scripts/launch-preflight.sh` and keep the
output; open the public and signed-in pages on desktop and a narrow phone; check
canonical, sitemap, robots and link previews use the public origin; connect a real
test inbox and see first sync, reconnect and mailbox switch work; confirm that without
consent no optional analytics fire; query first-party data before stating any count.

| Day     | Move                                                                                     |
| ------- | ---------------------------------------------------------------------------------------- |
| Day 1   | Show HN on a Tuesday, early US morning (about 7–9 am Eastern). Title: `Show HN: DeclutrMail – Gmail cleanup that previews every change before it runs`. You in the comments all day |
| Day 2–3 | Reply to the tail; turn the top questions into `/answers` pages                          |
| Day 4   | Under 10 points: email hn@ycombinator.com for the second-chance pool                     |
| Day 8   | Product Hunt at its launch time. Ask for feedback, never votes                           |
| Day 9   | r/SideProject: "does the preview feel like enough to trust a bulk delete?"               |

Under 10 points on HN: one retitled retry after 1–2 weeks, then stop.

### G. After the first users

- [ ] Customer research on the first 5 conversations; replace the persona guesses in
      `.agents/product-marketing.md`
- [ ] Referral program only if ≥ 10 % of the first 200 self-reports say friend or colleague
- [ ] Monthly 20-prompt AI-visibility check (cited → mentioned → recommended)
- [ ] From week 3: pitch roundups, 3 a week; the no-signup simulator is the hook

### Search opportunities (from the 2026-11-17 SEO audit)

- [ ] New guides: sort Gmail by sender, Gmail storage full, delete Gmail by date, apply a
      filter to existing mail, why Gmail unsubscribe does not work
- [ ] "Is [tool] safe?" answered on each comparison page
- [ ] Phone (iPhone, Android, Gmail app) steps in the existing guides

## Measure: five numbers, weekly

Postgres is the count; the rest explain it. Never add PostHog, `ref` and self-report
together as "total signups".

1. New users (Postgres), split by tracked `ref` and, separately, by self-report
2. Simulator funnel: view → preview → decision → completed → CTA (directional)
3. Activation: signup → first real previewed cleanup within 24 h
4. Paid: Pass/Plus purchases, settled refunds, retained paid users, by the same two
   splits; complimentary grants excluded
5. Monthly AI-visibility rung on a fixed prompt list

Ignore until 100 users: Product Hunt rank, karma, followers, likes, pageviews,
keyword rank, A/B tests.

## Automation

A daily growth automation (outside the repo, 9 a.m. Pacific) runs the SEO engine
and the content pipeline. Their private state never enters Git.

```bash
node scripts/seo-engine.mjs run --state-dir /absolute/private/seo-engine-v1
node scripts/content-pipeline.mjs status --state-dir /absolute/private/content-pipeline
```

Neither can publish, post, send or spend; those need the founder's approval of the
exact content (`content-pipeline.md`).

## Start a marketing session

```
Read docs/marketing/README.md. Do the first unchecked item I can't do myself.
Draft anything public for my approval. Tick the box when it is done.
```

## History

Deleted 2026-11-19 as stale (all in Git history): the August outreach playbook (69
tactics, old prices), the August launch drafts, the October marketing plan and
creative drafts, the September founder launch checklist. Find them with
`git log --diff-filter=D --name-only -- docs/execution`.
