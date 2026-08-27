# Marketing Outreach Playbook

> **Do not start here.** The operating doc is
> [`MARKETING-RUNBOOK.md`](./MARKETING-RUNBOOK.md). This file is the 69-tactic
> archive and kill/keep rationale. If the two conflict, the runbook wins.

**Origin:** 2026-08-04 — 9 lens-agent runs (69 tactics) grounded in the
coreyhaines31/marketingskills frameworks (positioning, pricing, landing pages, SEO,
launch, lifecycle, social, community, analytics). Journal: `wf_5501aefc-0e7`.
**Last amended:** 2026-08-25 — operating doc extracted to `MARKETING-RUNBOOK.md`;
selected Haines skills installed globally. Prior amendment 2026-08-24 still
governs the tactic catalog below unless the runbook says otherwise.

Companion drafts (not yet posted; rewrite banned privacy copy before using):
`docs/execution/launch-content-drafts-2026-08-04.md`.
Positioning source: `docs/adr/0030-positioning-preview-guarantee.md`.
Public agent file: `.agents/product-marketing.md`.
Reddit operating skill: `~/.claude/skills/reddit-comments-declutrmail/SKILL.md`.

---

## A. Product facts (binding)

Gmail cleanup SaaS, prelaunch, canonical site **https://declutrmail.com** (D128; `.ai` 301s here).
Zero customers. Solo founder, zero paid budget; founder-hours are the scarce resource.
**No fabricated numbers or testimonials, ever.**

| Tier         | Price              | What it is (must stay true in untargeted copy)                                            |
| ------------ | ------------------ | ----------------------------------------------------------------------------------------- |
| Free         | $0                 | Full manual workflow, 50 actions/month, 1 inbox, 7-day Activity undo                      |
| Plus         | $9/mo or $90/yr    | Unlimited + Screener + Autopilot that _finds_; you approve every batch                    |
| Pro          | $19/mo or $190/yr  | Rules _act_ unattended + Daily Brief + Quiet hours + Follow-ups + 3 inboxes + 30-day undo |
| Founding Pro | $129/yr, first 250 | Real capped offer; no “X left” counter unless it reads live redemptions                   |

**Locked public claims** (import from code, do not paraphrase upward):

- Hero kicker: _For inboxes you gave up on._ H1: **Clear thousands of emails by sender — and see exactly what moves.** (`hero.tsx`)
- Privacy headline: **We never fetch or store full email contents.** + the generated storage list (`packages/shared/src/copy/privacy.ts`). **Banned in product and marketing copy:** counter-style claims including `Full bodies fetched: 0` and `Bodies read: 0 forever` (CLAUDE.md §2.1, `check-microcopy.sh --rule=privacy-badge`).
- Preview: exact current count + sample + planned Gmail changes, re-checked at execution. Mandatory (D226).
- Undo: Archive / Later / Delete, 7-day Free/Plus, 30-day Pro. A delivered unsubscribe cannot be recalled.
- Verbs: Keep · Archive · Unsubscribe · Later · Delete only (D227). Never user-facing “Screen.”
- Category prediction permanently banned (D222). Do not list in AI-tool directories.

---

## B. Repo and search state as of 2026-08-24

Verified against this checkout, not against production HTML.

**Shipped since the 4 August draft (do not re-do):**

- Ratified hero is in `apps/web/src/features/marketing/landing/hero.tsx`.
- `/vs` slugs: clean-email, trimbox, sanebox, leave-me-alone, gmail-filters, **gmail**, **unroll-me**.
- 5 `/answers` + **6** `/how-to` (added `gmail-storage-full`). Hubs at `/how-to` and `/answers`.
- `/inbox-simulator` + route-level OG card (`inbox-simulator/opengraph-image.tsx`). `/demo` 308s here.
- `/pricing.md` generated from the checkout manifest. `public/llms.txt` carries the canonical sentence.
- FAQPage JSON-LD on landing FAQ, `/answers`, and question-shaped how-tos.
- Pricing card says **Recommended**, not “Most popular.”
- PrivacyBadge locked to the plain-language headline, not the counter.

**Still open (blocks a measured launch):**

- OAuth start URL does not carry a `ref` / attribution blob (`oauthStartUrl()` is a bare `/api/auth/google/start`; `OAuthState` has no campaign field). Launch traffic still dies at the cross-domain jump.
- No “How did you hear about us?” capture.
- No founder-mailbox anatomy post (blog slugs are thesis essays only: senders, design-constraint, reversible).
- No shareable PII-free result card; simulator has no `?ref=simulator` copy link.
- `docs/execution/launch-content-drafts-2026-08-04.md` still drafts “Full bodies fetched: 0” — rewrite before posting.
- Community accounts (F5Bot, PH Coming Soon, HN seasoning, Reddit bio) are founder actions, not repo state.

**Search Console baseline** (`sc-domain:declutrmail.com`, 24 May–21 Aug 2026): how-tos are in the index and matching buyer language, with **zero clicks**. Top impression pages: `/how-to/auto-archive-future-emails-in-gmail` (80, avg pos ~42), `/how-to/bulk-delete-emails-from-one-sender` (65, ~44), `/compare` (12). Do not wait for SEO to become a channel. Use those URLs as crib-sheet destinations for HN/Reddit/PH. Brand query `declutr` still hits the `.ai` property (106 impressions, 0 clicks) — keep the 301 healthy.

---

## C. Skills, subagents, and social tools

Use these when drafting or reviewing any public sentence. Do not invent a second voice.

| Artifact                               | Role in marketing                                                                                                                                  | Status after this sweep                                                                                                                                                                                                                                |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `reddit-comments-declutrmail` skill    | Drafts Reddit comments. Classify thread first; native Gmail method first; URL in bio.                                                              | Context bank updated 2026-08-24: `.com`, locked privacy headline, preset rules not auto-clean, no category prediction, 7-day Free undo, simulator as the link.                                                                                         |
| `.agents/product-marketing.md`         | Positioning, personas, objections, banned vocabulary for any marketing surface.                                                                    | Privacy string aligned 2026-08-24. Still pre-customer; do not treat personas as validated.                                                                                                                                                             |
| `design-system-agent`                  | Gate: K/A/U/L/D, preview-before-mutation, Storybook.                                                                                               | Runs on `apps/web` / `packages/shared` PRs. Social copy that names a sixth verb will fail the hook even if it never ships in UI.                                                                                                                       |
| `privacy-auditor`                      | Gate: no body/attachment/non-allowlisted-header fetch or storage.                                                                                  | Public claims must match `gmail-data-inventory.ts`. Never upgrade CASA from “Google approved a verification.”                                                                                                                                          |
| `architecture-guardian`                | Gate: API envelope, workers, events.                                                                                                               | Irrelevant to posts unless a launch claim implies a backend behavior that is not there.                                                                                                                                                                |
| `flow-completeness-auditor`            | Advisory: mailbox/sync lifecycle.                                                                                                                  | Do not promise “instant cleanup after connect.” First-run wait is sync-to-ready.                                                                                                                                                                       |
| `saas-reviewer` skill                  | Distribution and monetization realism on specs.                                                                                                    | Use when a new channel implies a program (referrals, invite codes). Verdict so far: no program at zero customers.                                                                                                                                      |
| Gate agents that are **not** marketing | `schema-migration-reviewer`, `webhook-security-auditor`, `typescript-reviewer`, `silent-failure-hunter`, `type-design-analyzer`, caveman/cavecrew. | Do not route launch copy through them.                                                                                                                                                                                                                 |
| coreyhaines31/marketingskills          | Source of the 4 August 69-tactic catalog.                                                                                                          | **Installed globally 2026-08-25** (subset: copywriting, copy-editing, social, cro, attribution, directory-submissions, customer-research, image, video). Do not re-run the nine lenses; this file _is_ that run. Invoke via `MARKETING-RUNBOOK.md` §6. |
| Google Search Console MCP (`user-gsc`) | Queries and page impressions. Properties: `sc-domain:declutrmail.com` (canonical) and `sc-domain:declutrmail.ai`.                                  | Re-query before publishing any “we rank for…” sentence.                                                                                                                                                                                                |
| PostHog MCP                            | Funnel and event truth. Filter test accounts.                                                                                                      | Activation events were historically unobserved because the founder workspace is already onboarded — smoke onboarding via D206 before treating launch analytics as live. Consent-gated; no mailbox content in events.                                   |
| Resend                                 | Transactional email only.                                                                                                                          | Marketing capture on content pages stays closed (CAN-SPAM postal-address gate).                                                                                                                                                                        |
| GitHub / Vercel / Sentry MCP           | Launch-week incident response, not acquisition.                                                                                                    | —                                                                                                                                                                                                                                                      |

**Default dropped link in every channel:** `https://declutrmail.com/inbox-simulator` (OG card exists so it unfurls as the demo). Homepage only when the thread asked for the company, not the product.

---

## D. Useful-first social OS (Reddit, X, HN, LinkedIn)

The conversion path is **comment → username click → simulator**, and only for people who asked for a tool. Everyone else should leave with a working Gmail search.

**The only test:** would this still be the best answer if DeclutrMail disappeared tomorrow? If the last paragraph is why you showed up, it is a pitch.

| Surface                          | Product mention                                                                       | Link                                      | Disclosure                                      |
| -------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------- |
| r/gmail, r/productivity          | Only if they ask for tools, or native Gmail is not enough (dozens of unknown senders) | Profile bio. Almost never in the comment. | “I built it” in the same sentence as the name   |
| r/digitalminimalism              | Never                                                                                 | Never                                     | Participate as a person with an inbox           |
| r/SideProject, drop-your-product | Yes                                                                                   | Simulator                                 | One-liner + one differentiator. Stop.           |
| X replies                        | At most 1 in 5                                                                        | Simulator when asked                      | If named, say you made it                       |
| Show HN / Product Hunt           | The post is the product                                                               | Simulator first                           | Answer _their_ question, not the FAQ you wanted |
| LinkedIn                         | Story in the post                                                                     | First comment only                        | Founder-mailbox numbers, labeled as yours       |

**Tricks that work:** finish the native method (exact `from:(addr)`, sample before select-all); lead with the caveat Gmail’s help skips (archive frees no storage; Trash still counts against 15 GB; delete ≠ unsubscribe; do not unsubscribe phishing); rewrite every comment; cap 2 Reddit replies/day; reply to the wrong answer in the thread, not only to OP; season HN 2–3 weeks before Show HN.

**Tricks that look like this advice and are not:** “Not trying to sell, but…”; complete Gmail steps then a feature list; the same paste on 12 storage-full threads; “I had this exact problem” with no detail only you would know; upvote pods; alt accounts; dumping the homepage.

Native-method crib (already on `/how-to`, teach it in comments without linking unless asked):

- Copy the real From address, search `from:(address@example.com)`, add `newer_than:1y` / `older_than:1y` as needed.
- Storage panic: empty Spam then Trash, then `has:attachment larger:10M` (Drive and Photos share the 15 GB). Space can take 48–72 hours to show.
- Gmail Trash ~30 days unless emptied sooner.

Cadence: Reddit 15–30 min/day, ≤2 replies; X 20–30 min reply lane + 1 original/day max; HN 3 comments/week on topics you actually know. One mod warning in a sub → bio-only there forever.

---

## 1. One-page summary (the 80/20)

With zero customers, DeclutrMail owns exactly three provable assets, and every tactic that
works routes through them:

1. **The mandatory preview** (exact count + sample before anything moves) — the locked
   positioning and the only durable differentiator vs Gmail's own Manage subscriptions.
2. **/inbox-simulator** — the whole loop, no sign-in, nothing touches Gmail. The only demo
   in the category a skeptic can try without an OAuth wall. It is the default dropped link
   in every channel.
3. **The founder's own mailbox** (~121,070 messages per the lens research — re-query the
   live number before publishing anything) — the ONLY user numbers permitted anywhere,
   always labeled as the founder's.

The 80/20:

- **Two launch moments, one week apart, decide the first thousand visitors.** Show HN
  (Tue evening IST) then Product Hunt (following Tue). For a Gmail-access product the
  launch is won in the comment section — pre-write the 12 hard answers, each linking a
  live proof page (/methodology, the generated storage list, the simulator). Truth
  surfaces (hero, /vs/gmail, Recommended badge, llms.txt) are in the repo; do not wait
  on them. Do wait on attribution (still missing) and the anatomy post (still missing).
- **The only sustainable recurring channel is a ~45 min/day community loop** that is
  useful-first (section D): F5Bot-fed Reddit replies + X replies. Teach the native
  Gmail method; product only when they ask. Everything else is one-time code/content
  that compounds: FAQ schema, freshness dates, /pricing.md, Bing/Brave indexing,
  AlternativeTo, hub pages.
- **Attribution must be live before the first launch post.** Still open. Launch traffic
  arrives exactly once; the cross-domain OAuth jump loses the thread today. No
  attribution = every future channel decision is vibes.
- **Owned email marketing is closed** (CAN-SPAM postal-address gate; transactional only).
  Product Hunt's Coming Soon follower notification is the one compliant launch list.

Hard rules bounding every tactic below: D209 banned vocabulary applies to marketing copy
(never "never reads your email", never "every action is reversible" — state 7-day
Free/Plus and 30-day Pro undo windows; never "nuke/blast/destroy"; never "metadata only"
as a self-claim; never counter-style privacy headlines). Screener is soft quarantine —
"mail still arrives". Untargeted copy must be true at Free (50 actions/month). No upvote
solicitation anywhere (HN voting-ring detection, PH pods). No scarcity theater: "first
250" stated as a rule is fine; any counter must read the live server-side count.
Founder-mailbox screenshots must blur third-party addresses/subjects. Every published
stat is queried at publish time (standing never-fabricate rule). Never live-demo someone
else's mailbox.

---

## 2. Channel plan, ranked by expected ROI

Ranked for a solo prelaunch founder. Peak launch-fortnight load ~15–20 h/wk; steady state
~6–8 h/wk. If a week is tight, cut from the bottom.

| #   | Channel                                                                                                       | What to do                                                                                                                                                                                                                     | Cadence                                                                    | Founder h/wk            | Leading metric                                                                                          | Kill criterion                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 1   | **Hacker News** (Show HN + seasoning)                                                                         | 2–3 wks of substantive comments on email/OAuth/CASA/solo-founder threads, then one Show HN built around /inbox-simulator with the 12-answer crib sheet                                                                         | Seasoning: 3 comments/wk. Launch: one Tue, founder in comments all evening | 2–3 pre; ~12 launch wk  | Simulator sessions + attributed signups within 48h of the thread                                        | One-shot. If <10 points: second-chance-pool email, one retitled retry after 1–2 wks, then done — no repost spam     |
| 2   | **Reddit comment loop** (r/gmail, r/productivity, competitor-rescue threads)                                  | F5Bot on 10 buying-intent keywords; ≤2 replies/day; **useful-first** (section D): finish the native Gmail method, product only if they ask, "I built it" disclosure, simulator URL in profile bio, skill drafts + human submit | 15–30 min/day triage + reply                                               | 2–3                     | Attributed visits/signups from bio + dropped links; removals = 0                                        | One mod warning in a sub → bio-only there. 4 straight weeks of zero attributed visits → halve cadence               |
| 3   | **Owned content + AEO/GEO** (121k data post still unbuilt; /vs/unroll-me, schema, /pricing.md, hubs are live) | Remaining: anatomy post + monthly 20-query AI-visibility audit. Do not rebuild pages that already exist.                                                                                                                       | Build the anatomy post; then ~2 h/mo verification ritual                   | ~8 one-time left        | Monthly audit rung per query (cited → mentioned → recommended); Bing/Brave index coverage of all routes | No kill — compounding. Hard cap: no thin programmatic batches, five deep pages beat fifty thin ones                 |
| 4   | **Product Hunt** (Coming Soon now, launch Day 8)                                                              | Coming Soon page collects the only compliant launch list; launch with Founding Pro as the offer, 5-frame gallery led by the preview modal                                                                                      | One-shot + 3 wks account warm-up (few genuine comments/wk)                 | ~20–24 total, launch wk | Founding Pro redemptions + PH followers → signups. NOT rank                                             | One-shot. Never buy pods (brand-fatal). Mid-pack finish is acceptable; do not relaunch for rank                     |
| 5   | **X build-in-public**                                                                                         | 1 original post/day max (preview-GIF receipts, founder-mailbox numbers, what-we-banned posts) + 20–30 min reply lane on a 20-account list                                                                                      | Daily, sustained — not the skill's 3–10x/day (dead-account trap)           | 3–4                     | Profile → simulator clicks (attributed); ICP conversations in replies                                   | 8 wks post-launch with <5% of attributed signups → drop to launch-amplification + weekly receipt only               |
| 6   | **Directories / entity layer**                                                                                | AlternativeTo + SaaSHub (pre-launch wk), LinkedIn company page + Crunchbase; later DR-20+ micro-launch drip                                                                                                                    | One-time + 20 min/listing drip post-PH                                     | ~6–8 one-time           | AlternativeTo referral visits; product appearing in LLM "alternative" answers (audit)                   | Skip anything pay-to-play or badge-swap; skip all 43 AI-tool directories (D209/D222 make "uses AI" copy impossible) |
| 7   | **LinkedIn**                                                                                                  | Repost the X story posts; links in first comment only; storage-list carousel later                                                                                                                                             | 1/wk, 30 min                                                               | 0.5                     | Any ICP inbound at all                                                                                  | Zero engagement after 6 wks → keep the company page as an entity anchor, stop posting                               |

Explicitly not channels right now: owned email/newsletter (CAN-SPAM gate — no capture forms
on content pages), paid anything (zero budget), G2/Capterra review pushes (zero users),
privacy-absolutist communities (closed-source cloud service will be publicly rejected —
a permanent AI-citable artifact against the wedge).

---

## 3. Launch sequence (day-by-day)

**Product Hunt: YES** — but Day 8, never the same week as Show HN. Reasoning: (a) PH culture
expects a launch offer and Founding Pro $129/yr first-250 is real, compliant scarcity already
live on /pricing; (b) 12:01am PT = 12:31pm IST — the India-based founder is naturally awake
for the entire critical first window, a structural edge most launchers lack; (c) PH followers
are the only launch-notification list the CAN-SPAM gate permits; (d) a solo founder cannot
staff two comment sections at once, and for this product the comments ARE the launch. Goal:
offer redemptions + followers + a permanent citable page — not the badge. Expect mid-pack
with zero audience; that is fine.

**Hard gates before Day 1 (no slot booked until all green):**

- G1 — **SHIPPED in repo** (ratified hero in `hero.tsx`). Confirm production HTML before booking.
- G2 — **SHIPPED in repo** (`/vs/gmail` + `/vs/unroll-me` in `comparison-data.ts`, linked from `/compare`). Confirm production.
- G3 — OPEN. 12-answer crib sheet written; the restricted-scope/CASA answer first (it cannot be improvised). Rewrite any draft that still says `Full bodies fetched: 0`.
- G4 — OPEN. Attribution live through the OAuth flow (see §6 and F1).
- G5 — OPEN. PH Coming Soon collecting followers for ≥1 week.
- G6 — OPEN. "Anatomy of ~N emails" data post published on /blog (query live count at publish; the ~121k figure is stale until re-queried).
- G7 — **SHIPPED in repo** (simulator OG card). Confirm a Slack/X unfurl against production, not localhost.

| Day                   | Moves                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Day 1 (Tue)**       | **Show HN**, 5:30–7:00pm IST (8–9:30am ET). Title: "Show HN: DeclutrMail – Gmail cleanup that previews every change before it runs." Body: first-person, technical — founder's mailbox origin (labeled), allowlisted-header envelope, storage list generated from the fetching code, undo windows (7d/30d), honest limits (mailto unsubscribe is manual; Screener holds for review, mail still arrives). First link = /inbox-simulator. One factual pricing line at the end; no offer push, no kicker copy ("For inboxes you gave up on" is landing-page register, not HN register). Founder in comments all evening; keep a running file of every distinct question. X: after HN is live, post the launch story thread (mailbox origin → preview GIF → simulator link → Founding Pro stated plainly). LinkedIn: same story, link in first comment. Zero upvote asks anywhere. |
| **Day 2 (Wed)**       | HN reply tail (morning + evening IST). No new moments. Retype crib-sheet answers with each commenter's specifics — never paste.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Day 3 (Thu)**       | 48h recycle: fold the top ~5 actually-asked questions into /answers, update /vs/gmail with any objection that survived contact. X: honest recap post ("the hardest questions HN asked").                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Day 4 (Fri)**       | If the thread got <10 points: send the pre-drafted second-chance-pool email to hn@ycombinator.com. Publish the blog recap ("every hard question from HN, answered"), link from /methodology. Finalize PH gallery (5 frames: preview→confirm→undo capture; preview modal with exact count + sample; sender screen with Keep/Archive/Unsubscribe/Later/Delete; badge + storage list; pricing card) using HN learnings.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Day 5 (Sat)**       | Rest. Normal 30–45 min community loop only. Verify PH assets and the 12:01am PT Tue schedule.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Day 6 (Sun)**       | Pre-write PH-day replies from the crib sheet. Queue the X amplification thread. End-to-end sandbox check of the Founding Pro checkout path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Day 7 (Mon)**       | Quiet day, community loop only. Sleep-shift prep for the PH window.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Day 8 (Tue, wk 2)** | **Product Hunt launch**, 12:01am PT = 12:31pm IST. Maker comment: mailbox origin story, the preview guarantee, then the offer stated factually — "Founding Pro: $129/yr, first 250, price locked while active, 30-day money-back." Founder covers 12:31pm–~2am IST, sleeps the US-afternoon lull, resumes 6am. Respond to every comment; ask for feedback, never votes. "Discussed on Hacker News" + link is the maximum HN claim, and only if real discussion happened.                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Day 9 (Wed)**       | **r/SideProject feedback post** (self-promo allowed there): "try the whole flow on a fake inbox, no sign-in" + one focused question — "does the preview step feel like enough to trust a bulk delete?" Founding Pro only in 1:1 comment replies when asked. X recap thread with real screenshots. Then the 48h recycle again.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

**Reddit anti-spam approach (applies throughout):** section D is the operating system.
r/gmail and r/productivity are comment-only — both remove self-promo posts; answer with the free
native-Gmail method first, mention the product in one disclosed line only when the OP asks for
tools or hits a native limit. r/digitalminimalism: participation only, never links. Product posts
only in r/SideProject. Every mention carries "I built it." ≤2 replies/day, simulator URL in
profile bio so most comments need no link, never reuse a comment verbatim, no alt accounts ever.
The `reddit-comments-declutrmail` skill drafts; a human reads the live thread and clicks submit.

---

## 4. The 69 tactics: deduplicated, grouped, verdicts

Verdicts: **KEEP-NOW** (build/run before launch) · **SHIPPED** (in repo as of 2026-08-24; do not rebuild) · **LATER** (real, but after launch or behind a stated gate) · **DROP** (fails the budget / fabrication / >5 h-wk recurring filter, or duplicates a kept tactic). Merged duplicates share a row — 69 inputs, 6 merged
duplicate pairs, 63 unique tactics. Lens key: X=X/LinkedIn, R=Reddit/community, L=launch, C=content, D=directories,
A=AEO/GEO, P=psychology, T=free tools, F=referrals.

### Group 1 — Launch core (HN + PH + sequencing)

| Tactic (lens#)                                          | Verdict  | Reason                                                                                                                      |
| ------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------- |
| Show HN built around /inbox-simulator (L1 + D3, merged) | KEEP-NOW | Highest-leverage single event; the simulator satisfies "something people can try" where every Gmail tool hits an OAuth wall |
| Pre-write the 12 hard answers (L2)                      | KEEP-NOW | The launch is decided in comments; every answer links a live proof page instead of a promise                                |
| Gate launch on /vs/gmail + ratified hero (L3)           | SHIPPED  | Hero + `/vs/gmail` are in the repo. Confirm production HTML. The comment still needs the page.                              |
| PH Coming Soon as the legal launch list (L4)            | KEEP-NOW | The only launch-notification channel the CAN-SPAM gate permits; 2h                                                          |
| PH launch with Founding Pro offer (L5 + D4, merged)     | KEEP-NOW | Real capped offer + IST timezone advantage; goal is redemptions, not rank                                                   |
| One-moment-per-day launch calendar (L6)                 | KEEP-NOW | Solo founder's scarcest asset is comment-section presence; HN and PH physically collide if same-day                         |
| HN flop insurance protocol (L7)                         | KEEP-NOW | 30 min now prevents the two classic panic errors on a demoralizing day                                                      |
| Recycle threads into owned pages in 48h (L8)            | KEEP-NOW | Converts one-day spikes into permanent search/AI surface at marginal cost                                                   |
| Launch-week X amplification thread (X2)                 | KEEP-NOW | The one un-repeatable news moment; posts only after HN/PH assets are live                                                   |

### Group 2 — Founder-mailbox evidence engine (the only permitted proof)

| Tactic (lens#)                                                      | Verdict  | Reason                                                                                                                                                      |
| ------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Flagship data post "Anatomy of ~121k emails" (C1 + P3, merged)      | KEEP-NOW | The single strongest asset: turns the privacy badge and sender arithmetic into demonstrated fact; Show HN companion link; publish queries alongside numbers |
| Unsubscribe observatory — who actually stops sending (C2)           | KEEP-NOW | Start the 30-day clock this week (one real 50-sender session); nobody in the category publishes this with receipts                                          |
| Weekly receipt cadence: Cleanup Ledger + X series (C3 + X3, merged) | KEEP-NOW | ~90 min/entry; one real session generates the artifact for blog, X, and Reddit simultaneously                                                               |
| r/productivity identity post — digging out of 121k (R6)             | KEEP-NOW | Cheap distribution of C1 in practice-not-product framing; no link in post                                                                                   |
| Interactive founder-mailbox teardown page (T5)                      | DROP     | Duplicates C1 for +6h of interactivity; static charts carry the same proof                                                                                  |

### Group 3 — Community loops (Reddit + HN seasoning)

| Tactic (lens#)                                                    | Verdict  | Reason                                                                                                                                                            |
| ----------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fix the reddit-comments skill context bank (R1)                   | SHIPPED  | 2026-08-24: URL → .com, locked privacy headline, preset rules not auto-clean, no category prediction, 7-day Free undo, simulator as the link, how-to thread type. |
| F5Bot keyword pipeline → daily loop (R2)                          | KEEP-NOW | Bottom-funnel threads harvested at ~15–20 min/day; each answer is also a durable Google-indexed asset                                                             |
| Native-method-first posture in r/gmail (R3)                       | KEEP-NOW | Expanded 2026-08-24 as section D (useful-first OS). Skill now classifies how-to threads as native-only.                                                           |
| HN comment seasoning pre-Show-HN (R4)                             | KEEP-NOW | A zero-history account halves Show HN odds; comment only where the founder has first-hand expertise                                                               |
| Competitor-rescue answers with named disclosure (R5)              | KEEP-NOW | Rides the same F5Bot feed; /vs pages already hold the researched comparisons                                                                                      |
| r/SideProject feedback post on the simulator (R7)                 | KEEP-NOW | Self-promo-allowed sub + no-signup demo; judge on feedback and Founding Pro candidates, not volume                                                                |
| Answer bank pre-generated from live /answers + /how-to pages (R8) | KEEP-NOW | 3h that cuts per-comment cost from 20 min to 5 — decides whether the daily loop survives week two                                                                 |

### Group 4 — X / LinkedIn build-in-public

| Tactic (lens#)                                                       | Verdict  | Reason                                                                                                                              |
| -------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Preview-receipt GIF/video as the pinned format (X1 + T6, merged)     | KEEP-NOW | One 20–30s capture of preview→confirm→undo serves as X pin, PH gallery lead, and launch-post media                                  |
| "Google shipped my feature before I launched" story post (X4)        | KEEP-NOW | Converts the scariest fact into the positioning statement; verify current Gemini behavior the day before                            |
| Daily reply lane, 20-account list (X5)                               | KEEP-NOW | Capped at 20–30 min/day; replies are the only distribution a zero-follower account has. Product link ≤1 in 5 replies                |
| "What we banned" trust-boundary posts with enforcement receipts (X6) | KEEP-NOW | D209 list / D222 hook / generated badge are real, auditable receipts — the sharpest credibility signal for the HN-adjacent audience |
| AI-agents build-log from MISTAKES.md (X7)                            | LATER    | Real material, but "robots touch your mail" misread risk during the launch window; post-launch drip lane                            |
| LinkedIn storage-list carousel (X8)                                  | LATER    | Secondary channel; build after launch from the /methodology copy                                                                    |

### Group 5 — SEO / content expansion

| Tactic (lens#)                                                               | Verdict | Reason                                                                                             |
| ---------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------- |
| Hub pages for /how-to and /answers + sitemap diff (C7)                       | SHIPPED | `/how-to` and `/answers` index pages exist; 6 how-tos including storage-full.                      |
| Answers expansion mined from r/gmail phrasing (C4)                           | LATER   | Good roadmap method, but launch-window hours go to launch; recycle real HN/PH questions first (L8) |
| Unsubscribe failure-mode cluster (C5)                                        | LATER   | Low-competition compounding pages; slot in after the observatory publishes as their evidence       |
| Four missing head-term how-tos (mass-delete, storage-full, old, unread) (C6) | LATER   | Won't rank on a new domain in 60 days; build as Reddit link targets starting with mass-delete      |
| Capped sender directory with observed data (C8)                              | LATER   | 12h + thin-content risk; only as far as real founder-mailbox data supports, after launch           |

### Group 6 — AEO / GEO

| Tactic (lens#)                                                         | Verdict  | Reason                                                                                                                                                    |
| ---------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ship /vs/unroll-me, primary-sourced (A1)                               | SHIPPED* | Slug exists in `comparison-data.ts`. *Re-read FTC 2019 / NYT 2017 (or current vendor pages) before any Unroll.me sentence in a launch post; never accuse. |
| Enter the third-party citation pool (A2)                               | KEEP-NOW | Harvest the exact URLs engines cite today; that list targets the AlternativeTo/Reddit/roundup work — aims the launch at the retrieval pool                |
| Real freshness signals: dates in JSON-LD + visible "Last updated" (A3) | KEEP-NOW | 4h code; dated beats undated across engines; never bump a date without re-verifying                                                                       |
| FAQPage schema on /answers + one storage-full how-to (A4)              | SHIPPED  | FAQPage JSON-LD on landing, question-shaped answers, and how-tos. `/how-to/gmail-storage-full` is live and already collecting impressions (0 clicks).     |
| /pricing.md for agent buyers (A5)                                      | SHIPPED  | `apps/web/src/app/(marketing)/pricing.md/route.ts` + drift test.                                                                                          |
| One canonical sentence everywhere (A6)                                 | SHIPPED  | `llms.txt`, hero, and comparison intro aligned on preview-per-sender. Re-check any new surface against `llms.txt`.                                        |
| Bing + Brave indexing (A7)                                             | KEEP-NOW | 1.5h; Copilot cites only Bing's index, Claude only Brave's — absent pages cannot be cited                                                                 |
| Monthly AI-visibility ladder audit, baseline this week (A8)            | KEEP-NOW | The feedback loop for everything above; run pre-launch so launch effect is measurable against a true zero                                                 |

### Group 7 — Directories / entity layer

| Tactic (lens#)                                           | Verdict  | Reason                                                                                                                                                                         |
| -------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Submission freeze until hero + launch kit ship (D1)      | SHIPPED* | Hero is in repo so the freeze on _copy_ lifts. Still do not submit directories until G3 crib sheet + G4 attribution are green — listings fossilize whatever is live that week. |
| AlternativeTo + SaaSHub listings (D2)                    | KEEP-NOW | The one directory buyers AND LLMs consult at the exact purchase moment ("[competitor] alternative"); destination /vs pages already exist                                       |
| LinkedIn company page + Crunchbase (D6a)                 | KEEP-NOW | ~1h; the entity facts LLM corpora ingest; byte-identical facts across both                                                                                                     |
| Wikidata item (D6b)                                      | LATER    | Created before independent coverage exists → deleted for notability and the well is salted; strictly after launch coverage                                                     |
| Micro-launch platform drip, DR-20+ only (D5)             | LATER    | Post-PH, one per 2–3 days, 20-min cap each; skip anything paid or badge-swap                                                                                                   |
| G2 + Capterra claim-only (D7)                            | LATER    | Zero users; claim the profiles post-launch, point nothing at them until real reviews exist; review asks in-app only, never email                                               |
| Roundup listicle outreach targeting LLM-cited pages (D8) | LATER    | 3 pitches/wk from week 3; the no-signup simulator is the rare pitch asset; value compounds past the 60-day window                                                              |

### Group 8 — Pricing-page and persuasion mechanics (honest-persuasion set)

| Tactic (lens#)                                                   | Verdict  | Reason                                                                                                                                                                         |
| ---------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Founding Pro anchor chain $228 → $190 → $129 (P1)                | KEEP-NOW | All three numbers are real prices; verify the chain renders in BOTH the Paddle/USD and Razorpay/INR paths                                                                      |
| Kill the "Most popular" badge (P2)                               | SHIPPED  | Card now says "Recommended" — an opinion label, not an empirical claim.                                                                                                        |
| Demo end-card: mirror commitments + share link (P4 + F4, merged) | KEEP-NOW | The simulator's 7 micro-commitments currently dead-end in a generic CTA; add decision tally, "Do this on your real inbox →", and a ?ref=simulator copy link                    |
| Pratfall box: "What DeclutrMail won't do" (P7)                   | KEEP-NOW | Four true, documented limits where persuasion happens. Makes the locked privacy headline land as engineering fact, not a slogan. Never restore a counter-style badge.          |
| Refund copy in the product's own grammar (P8)                    | KEEP-NOW | 1h; binds the 30-day guarantee to the preview/undo mechanic; always exact windows, never "reversible"                                                                          |
| Real-scarcity seat counter (P6)                                  | LATER    | Rule stays ("availability confirmed at checkout"); build/surface the live counter only when ≥10 seats are truthfully claimed — a truthful counter that stalls, stalls publicly |
| Storage-loss framing from sizeBytes (P5)                         | LATER    | Real loss frame (Google One payments) but it's product-surface work under the design freeze; how-to page intent is covered by A4 meanwhile                                     |

### Group 9 — Free tools / engineering-as-marketing

| Tactic (lens#)                                        | Verdict  | Reason                                                                                                                                     |
| ----------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Simulator as the default dropped link everywhere (T1) | KEEP-NOW | 1h; the only proof a stranger can verify in two minutes, and HN punishes signup walls                                                      |
| Route-level OG card for /inbox-simulator (T2)         | SHIPPED  | `apps/web/src/app/(marketing)/inbox-simulator/opengraph-image.tsx`. Confirm production unfurl.                                             |
| PostHog demo funnel from existing events (T8)         | KEEP-NOW | 1h pure configuration; decides whether further free-tool investment is justified; read as directional (persons = browsers)                 |
| Gmail storage math calculator (T4)                    | LATER    | Honest, externally-verifiable math; 10h that loses to launch-window priorities                                                             |
| Unsubscribe-header inspector, paste-based (T7)        | LATER    | Credibility + internal-linking asset, low search demand; client-side parse-only, never fetch found URLs                                    |
| Gmail cleanup query builder (T3)                      | DROP     | 12h into a crowded cheat-sheet space; the live /how-to pages already carry the recipes, and the lens itself doubts it beats a static table |

### Group 10 — Referral / attribution (verdict: no program yet — plumbing only)

| Tactic (lens#)                                           | Verdict  | Reason                                                                                                                                                                   |
| -------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Wire signup attribution through the OAuth flow (F1)      | KEEP-NOW | Launch traffic arrives exactly once and cannot be re-attributed; the cross-domain jump loses the thread today; includes the optional "How did you hear about us?" select |
| Written WOM tripwire; shelve the give-get blueprint (F5) | KEEP-NOW | 2h decision doc: ≥10% of first 200 attributed signups from "a friend or colleague" or ref-links → then and only then build the real program (Plus-months, in-app only)   |
| Shareable Activity receipt card (F2)                     | LATER    | Needs real users to matter; founder's card-zero need is covered by the data post's screenshots                                                                           |
| Founding Pro +1 invite (F3)                              | LATER    | 14h of billing-surface change + refund edge cases + every "first 250" copy touch — not during launch; real candidate after first seats sell                              |

**Verdict totals (in original-tactic units, 2026-08-24):** ~10 **SHIPPED** in repo (L3, R1, C7, A1, A4, A5, A6, P2, T2, D1) · ~42 **KEEP-NOW** · 15 **LATER** · 2 **DROP** (T3 query
builder, T5 interactive teardown — plus the rewarded referral program itself, which the
referral lens already struck down at zero customers before it could become a tactic;
F1–F5 are its compliant residue). Most KEEP-NOW items are 1–6h one-time builds; the only
recurring commitments kept are the two community loops (≤45 min/day combined), the weekly
receipt entry (~90 min), and the monthly audits (~2h). Nothing in the 69
required budget; fabrication-dependent variants (seeded counters, "share your synthetic
results", sender-count estimator from invented curves) were pre-killed by the lens do-nots
and stay dead.

---

## 5. Measurement: pre-first-100-users

The whole apparatus is one 6-row weekly spreadsheet plus one saved PostHog funnel. Do not
build a dashboard.

**The 5 metrics that matter:**

1. **Attributed signups per week, by channel** (the F1 `signup_attribution` column + the
   optional how-did-you-hear select). The only number that decides where founder-hours go.
2. **Simulator funnel completion** (events: demo view → `demo_preview_opened` →
   `demo_decision_confirmed` → `demo_completed` → demo-placement CTA click → signup). Message-market
   resonance, readable within launch week.
3. **Signup → first real preview→confirm within 24h** (activation). The product's aha
   moment on a real mailbox; the number that says whether launch traffic was the right
   traffic.
4. **Founding Pro seats claimed (of 250) + 30-day refund rate.** The money truth, and the
   only "traction" number that may ever be spoken publicly — because it's real.
5. **AI-visibility rung, monthly** (the fixed 20-query × 4-engine audit: cited / mentioned /
   recommended / recommended-against). The only readable signal for the compounding
   channel; baseline runs pre-launch.

**What NOT to measure (pre-100):** PH rank and HN karma (one-day noise); follower counts,
impressions, likes (vanity); aggregate pageviews; PostHog "persons" as people (a person is
a browser — established in this repo's own analytics history); keyword rankings for head
terms (the domain is too new for the signal to exist); A/B tests of anything (under ~1,000
signups every variant is noise — pick one, read direction); time-on-page; email metrics
(there is no marketing email). Every hour spent staring at these is an hour not spent in a
comment section.

---

## 6. Top 3 actions for THIS week (as of 2026-08-24)

Truth gates in the repo are done. Do not spend this week re-editing the hero.

1. **Wire attribution before any launch traffic.**
   Thread a `ref` param through `apps/api/src/auth/google-oauth.controller.ts` into the OAuth
   state blob and persist `signup_attribution`, plus one skippable "How did you hear about us?"
   select. Without this, Show HN and PH cannot be scored. Same week (founder hands): F5Bot on
   the 10 buying-intent keywords (`unroll.me alternative`, `clean email safe`, `trimbox`,
   `mailstrom`, `sanebox`, `leave me alone app`, `gmail storage full`, `mass delete gmail`,
   `bulk unsubscribe`, `delete emails by sender`); Reddit profile bio →
   `https://declutrmail.com/inbox-simulator`; Product Hunt Coming Soon; 3 substantive HN
   comments (hn.algolia.com → "gmail", past month) with zero product dump.

2. **Start the two evidence clocks on the founder mailbox.**
   The anatomy post is still the Show HN companion and the only social-proof asset the
   constraints allow. Query live: messages-per-sender, unsubscribe-channel mix, size-by-sender.
   Save CSVs. Re-verify the headline count at publish — do not reuse ~121k. Then one real
   50-sender unsubscribe session to start the 30-day observatory clock. Film the 20–30s
   preview → confirm → undo capture in the same sitting; that file is the X pin and PH gallery
   lead.

3. **Rewrite launch drafts onto the locked privacy headline, then write the 12-answer crib.**
   `docs/execution/launch-content-drafts-2026-08-04.md` still says `Full bodies fetched: 0`.
   Every public sentence uses **We never fetch or store full email contents.** + the generated
   list. Crib-sheet answer 1 is restricted-scope / CASA (approved 21 April 2026 — Google
   approved a verification, it did not certify the product). Answer 2 is "Gmail already has
   Manage subscriptions — why this exists" → `/vs/gmail`. First link everywhere: the simulator.
