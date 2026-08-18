# Marketing Outreach Playbook — 2026-08-04

Synthesized from 9 lens-agent runs (69 tactics) grounded in the coreyhaines31/marketingskills
frameworks: positioning, pricing, landing pages, SEO, launch, lifecycle, social, community,
analytics. Journal: `wf_5501aefc-0e7`.

**Product facts this doc is bound to.** Gmail cleanup SaaS, prelaunch, site live at
declutrmail.com, zero customers. Free = full manual cleanup, 50 actions/month, 1 inbox.
Plus $9/mo or $90/yr = unlimited + Screener + Autopilot rules with per-batch approval.
Pro $19/mo or $190/yr = rules act unattended + Daily Brief + Quiet hours + Follow-ups +
3 inboxes + 30-day undo. Founding Pro $129/yr, first 250. Privacy wedge: "Full bodies
fetched: 0" + published storage list; preview before every mutation; undo. Ratified hero:
kicker "For inboxes you gave up on", H1 "Clear thousands of emails by sender — and see
exactly what moves." Solo founder, zero budget, founder-hours are the scarce resource.
**No fabricated numbers or testimonials, ever.**

**Repo state as of today (verified, load-bearing):** the ratified hero is NOT yet deployed —
`apps/web/src/features/marketing/landing/hero.tsx:25` still renders the old sender-first H1.
/vs has exactly five pages (clean-email, trimbox, sanebox, leave-me-alone, gmail-filters);
`/vs/gmail` and `/vs/unroll-me` do not exist. 5 /answers + 5 /how-to pages, /inbox-simulator,
/methodology, /compare, /blog, /pricing are live.

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
  live proof page (/methodology, the generated storage list, the simulator).
- **Nothing launches until the truth surfaces match the ratified positioning.** Deploy the
  new hero, ship /vs/gmail, kill the "Most popular" badge (fabricated popularity at zero
  customers), align one canonical product sentence everywhere.
- **The only sustainable recurring channel is a ~45 min/day community loop** (F5Bot-fed
  Reddit replies + X replies). Everything else is one-time code/content that compounds:
  FAQ schema, freshness dates, /pricing.md, Bing/Brave indexing, AlternativeTo, hub pages.
- **Attribution must be live before the first launch post.** Launch traffic arrives exactly
  once; the cross-domain OAuth jump loses the thread today. No attribution = every future
  channel decision is vibes.
- **Owned email marketing is closed** (CAN-SPAM postal-address gate; transactional only).
  Product Hunt's Coming Soon follower notification is the one compliant launch list.

Hard rules bounding every tactic below: D209 banned vocabulary applies to marketing copy
(never "never reads your email", never "every action is reversible" — state 7-day
Free/Plus and 30-day Pro undo windows; never "nuke/blast/destroy"; never "metadata only";
Screener is soft quarantine — "mail still arrives"). Untargeted copy must be true at Free
(50 actions/month). No upvote solicitation anywhere (HN voting-ring detection, PH pods).
No scarcity theater: "first 250" stated as a rule is fine; any counter must read the live
server-side count. Founder-mailbox screenshots must blur third-party addresses/subjects.
Every published stat is queried at publish time (standing never-fabricate rule).

---

## 2. Channel plan, ranked by expected ROI

Ranked for a solo prelaunch founder. Peak launch-fortnight load ~15–20 h/wk; steady state
~6–8 h/wk. If a week is tight, cut from the bottom.

| #   | Channel                                                                                        | What to do                                                                                                                                             | Cadence                                                                    | Founder h/wk            | Leading metric                                                                                          | Kill criterion                                                                                                      |
| --- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 1   | **Hacker News** (Show HN + seasoning)                                                          | 2–3 wks of substantive comments on email/OAuth/CASA/solo-founder threads, then one Show HN built around /inbox-simulator with the 12-answer crib sheet | Seasoning: 3 comments/wk. Launch: one Tue, founder in comments all evening | 2–3 pre; ~12 launch wk  | Simulator sessions + attributed signups within 48h of the thread                                        | One-shot. If <10 points: second-chance-pool email, one retitled retry after 1–2 wks, then done — no repost spam     |
| 2   | **Reddit comment loop** (r/gmail, r/productivity, competitor-rescue threads)                   | F5Bot on 10 buying-intent keywords; ≤2 replies/day, native-Gmail-method-first, "I built it" disclosure, URL in profile bio                             | 15–30 min/day triage + reply                                               | 2–3                     | Attributed visits/signups from bio + dropped links; removals = 0                                        | One mod warning in a sub → bio-only there. 4 straight weeks of zero attributed visits → halve cadence               |
| 3   | **Owned content + AEO/GEO** (121k data post, /vs/unroll-me, schema, freshness, hubs, indexing) | One-time builds that make LLMs and search describe the product correctly; monthly 20-query AI-visibility audit                                         | Build pre/post-launch; then ~2 h/mo verification ritual                    | ~20–25 one-time         | Monthly audit rung per query (cited → mentioned → recommended); Bing/Brave index coverage of all routes | No kill — compounding. Hard cap: no thin programmatic batches, five deep pages beat fifty thin ones                 |
| 4   | **Product Hunt** (Coming Soon now, launch Day 8)                                               | Coming Soon page collects the only compliant launch list; launch with Founding Pro as the offer, 5-frame gallery led by the preview modal              | One-shot + 3 wks account warm-up (few genuine comments/wk)                 | ~20–24 total, launch wk | Founding Pro redemptions + PH followers → signups. NOT rank                                             | One-shot. Never buy pods (brand-fatal). Mid-pack finish is acceptable; do not relaunch for rank                     |
| 5   | **X build-in-public**                                                                          | 1 original post/day max (preview-GIF receipts, founder-mailbox numbers, what-we-banned posts) + 20–30 min reply lane on a 20-account list              | Daily, sustained — not the skill's 3–10x/day (dead-account trap)           | 3–4                     | Profile → simulator clicks (attributed); ICP conversations in replies                                   | 8 wks post-launch with <5% of attributed signups → drop to launch-amplification + weekly receipt only               |
| 6   | **Directories / entity layer**                                                                 | AlternativeTo + SaaSHub (pre-launch wk), LinkedIn company page + Crunchbase; later DR-20+ micro-launch drip                                            | One-time + 20 min/listing drip post-PH                                     | ~6–8 one-time           | AlternativeTo referral visits; product appearing in LLM "alternative" answers (audit)                   | Skip anything pay-to-play or badge-swap; skip all 43 AI-tool directories (D209/D222 make "uses AI" copy impossible) |
| 7   | **LinkedIn**                                                                                   | Repost the X story posts; links in first comment only; storage-list carousel later                                                                     | 1/wk, 30 min                                                               | 0.5                     | Any ICP inbound at all                                                                                  | Zero engagement after 6 wks → keep the company page as an entity anchor, stop posting                               |

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

- G1 — Ratified hero deployed (`hero.tsx` still shows the old sender-first H1 today).
- G2 — /vs/gmail live and linked from /compare; concessions first, delta second.
- G3 — 12-answer crib sheet written; the restricted-scope/CASA answer first (it cannot be improvised).
- G4 — Attribution live through the OAuth flow (see §6).
- G5 — PH Coming Soon collecting followers for ≥1 week.
- G6 — "Anatomy of ~121k emails" data post published on /blog (the Show HN companion link).
- G7 — Simulator OG card + end-state upgrade deployed (it unfurls as the product, not the generic brand card).

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

**Reddit anti-spam approach (applies throughout):** r/gmail and r/productivity are
comment-only surfaces — both remove self-promo posts; answer with the free native-Gmail
method first, mention the product in one disclosed line only when the OP asks for tools or
hits a native limit. r/digitalminimalism: participation only, never links. Product posts only
in r/SideProject. Every mention carries "I built it." ≤2 replies/day, URL in profile bio so
most comments need no link, never reuse a comment verbatim, no alt accounts ever, the
comment skill drafts but a human reads the live thread and clicks submit.

---

## 4. The 69 tactics: deduplicated, grouped, verdicts

Verdicts: **KEEP-NOW** (build/run in the next ~6 weeks) · **LATER** (real, but after launch
or behind a stated gate) · **DROP** (fails the budget / fabrication / >5 h-wk recurring
filter, or duplicates a kept tactic). Merged duplicates share a row — 69 inputs, 6 merged
duplicate pairs, 63 unique tactics. Lens key: X=X/LinkedIn, R=Reddit/community, L=launch, C=content, D=directories,
A=AEO/GEO, P=psychology, T=free tools, F=referrals.

### Group 1 — Launch core (HN + PH + sequencing)

| Tactic (lens#)                                          | Verdict  | Reason                                                                                                                      |
| ------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------- |
| Show HN built around /inbox-simulator (L1 + D3, merged) | KEEP-NOW | Highest-leverage single event; the simulator satisfies "something people can try" where every Gmail tool hits an OAuth wall |
| Pre-write the 12 hard answers (L2)                      | KEEP-NOW | The launch is decided in comments; every answer links a live proof page instead of a promise                                |
| Gate launch on /vs/gmail + ratified hero (L3)           | KEEP-NOW | "Gmail added this in 2025 — why does this exist?" is the most predictable comment; answer it once, on a page                |
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

| Tactic (lens#)                                                    | Verdict  | Reason                                                                                                |
| ----------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------- |
| Fix the reddit-comments skill context bank (R1)                   | KEEP-NOW | 1h; every future comment inherits the wrong URL (.ai) and a stale lead until this lands               |
| F5Bot keyword pipeline → daily loop (R2)                          | KEEP-NOW | Bottom-funnel threads harvested at ~15–20 min/day; each answer is also a durable Google-indexed asset |
| Native-method-first posture in r/gmail (R3)                       | KEEP-NOW | The only stance that survives a support sub's mods and makes the preview contrast credible            |
| HN comment seasoning pre-Show-HN (R4)                             | KEEP-NOW | A zero-history account halves Show HN odds; comment only where the founder has first-hand expertise   |
| Competitor-rescue answers with named disclosure (R5)              | KEEP-NOW | Rides the same F5Bot feed; /vs pages already hold the researched comparisons                          |
| r/SideProject feedback post on the simulator (R7)                 | KEEP-NOW | Self-promo-allowed sub + no-signup demo; judge on feedback and Founding Pro candidates, not volume    |
| Answer bank pre-generated from live /answers + /how-to pages (R8) | KEEP-NOW | 3h that cuts per-comment cost from 20 min to 5 — decides whether the daily loop survives week two     |

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

| Tactic (lens#)                                                               | Verdict  | Reason                                                                                             |
| ---------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------- |
| Hub pages for /how-to and /answers + sitemap diff (C7)                       | KEEP-NOW | 3h; orphaned content is this site's demonstrated failure mode (/beta), fix before launch traffic   |
| Answers expansion mined from r/gmail phrasing (C4)                           | LATER    | Good roadmap method, but launch-window hours go to launch; recycle real HN/PH questions first (L8) |
| Unsubscribe failure-mode cluster (C5)                                        | LATER    | Low-competition compounding pages; slot in after the observatory publishes as their evidence       |
| Four missing head-term how-tos (mass-delete, storage-full, old, unread) (C6) | LATER    | Won't rank on a new domain in 60 days; build as Reddit link targets starting with mass-delete      |
| Capped sender directory with observed data (C8)                              | LATER    | 12h + thin-content risk; only as far as real founder-mailbox data supports, after launch           |

### Group 6 — AEO / GEO

| Tactic (lens#)                                                         | Verdict   | Reason                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Ship /vs/unroll-me, primary-sourced (A1)                               | KEEP-NOW* | Highest-intent query with no page — every LLM answer currently hands it to competitors. *Needs founder ratification first: reverses the parked redirect decision in legacy-domain-redirects.ts, and every Unroll.me claim must be primary-sourced (FTC 2019 consent order, NYT 2017) |
| Enter the third-party citation pool (A2)                               | KEEP-NOW  | Harvest the exact URLs engines cite today; that list targets the AlternativeTo/Reddit/roundup work — aims the launch at the retrieval pool                                                                                                                                           |
| Real freshness signals: dates in JSON-LD + visible "Last updated" (A3) | KEEP-NOW  | 4h code; dated beats undated across engines; never bump a date without re-verifying                                                                                                                                                                                                  |
| FAQPage schema on /answers + one storage-full how-to (A4)              | KEEP-NOW  | quickAnswer blocks are already the right shape, just invisible to parsers; storage-full is the category's #1 trigger event                                                                                                                                                           |
| /pricing.md for agent buyers (A5)                                      | KEEP-NOW  | 2h; four-tier matrix is exactly what agents mis-parse from rendered pages; drift test mandatory                                                                                                                                                                                      |
| One canonical sentence everywhere (A6)                                 | KEEP-NOW  | Three surfaces define the product three ways today; consistency is how a zero-authority domain gets its self-description adopted                                                                                                                                                     |
| Bing + Brave indexing (A7)                                             | KEEP-NOW  | 1.5h; Copilot cites only Bing's index, Claude only Brave's — absent pages cannot be cited                                                                                                                                                                                            |
| Monthly AI-visibility ladder audit, baseline this week (A8)            | KEEP-NOW  | The feedback loop for everything above; run pre-launch so launch effect is measurable against a true zero                                                                                                                                                                            |

### Group 7 — Directories / entity layer

| Tactic (lens#)                                           | Verdict  | Reason                                                                                                                                   |
| -------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Submission freeze until hero + launch kit ship (D1)      | KEEP-NOW | Directories fossilize copy; submitting the old sender-first H1 frames the product against a free Gmail feature forever                   |
| AlternativeTo + SaaSHub listings (D2)                    | KEEP-NOW | The one directory buyers AND LLMs consult at the exact purchase moment ("[competitor] alternative"); destination /vs pages already exist |
| LinkedIn company page + Crunchbase (D6a)                 | KEEP-NOW | ~1h; the entity facts LLM corpora ingest; byte-identical facts across both                                                               |
| Wikidata item (D6b)                                      | LATER    | Created before independent coverage exists → deleted for notability and the well is salted; strictly after launch coverage               |
| Micro-launch platform drip, DR-20+ only (D5)             | LATER    | Post-PH, one per 2–3 days, 20-min cap each; skip anything paid or badge-swap                                                             |
| G2 + Capterra claim-only (D7)                            | LATER    | Zero users; claim the profiles post-launch, point nothing at them until real reviews exist; review asks in-app only, never email         |
| Roundup listicle outreach targeting LLM-cited pages (D8) | LATER    | 3 pitches/wk from week 3; the no-signup simulator is the rare pitch asset; value compounds past the 60-day window                        |

### Group 8 — Pricing-page and persuasion mechanics (honest-persuasion set)

| Tactic (lens#)                                                   | Verdict  | Reason                                                                                                                                                                         |
| ---------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Founding Pro anchor chain $228 → $190 → $129 (P1)                | KEEP-NOW | All three numbers are real prices; verify the chain renders in BOTH the Paddle/USD and Razorpay/INR paths                                                                      |
| Kill the "Most popular" badge (P2)                               | KEEP-NOW | Popularity is an empirical claim that is false at zero customers — one fabricated badge on the money page discredits the real badge; 1h fix                                    |
| Demo end-card: mirror commitments + share link (P4 + F4, merged) | KEEP-NOW | The simulator's 7 micro-commitments currently dead-end in a generic CTA; add decision tally, "Do this on your real inbox →", and a ?ref=simulator copy link                    |
| Pratfall box: "What DeclutrMail won't do" (P7)                   | KEEP-NOW | Four true, documented limits placed where persuasion happens; makes "Full bodies fetched: 0" land as engineering fact                                                          |
| Refund copy in the product's own grammar (P8)                    | KEEP-NOW | 1h; binds the 30-day guarantee to the preview/undo mechanic; always exact windows, never "reversible"                                                                          |
| Real-scarcity seat counter (P6)                                  | LATER    | Rule stays ("availability confirmed at checkout"); build/surface the live counter only when ≥10 seats are truthfully claimed — a truthful counter that stalls, stalls publicly |
| Storage-loss framing from sizeBytes (P5)                         | LATER    | Real loss frame (Google One payments) but it's product-surface work under the design freeze; how-to page intent is covered by A4 meanwhile                                     |

### Group 9 — Free tools / engineering-as-marketing

| Tactic (lens#)                                        | Verdict  | Reason                                                                                                                                                                                 |
| ----------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Simulator as the default dropped link everywhere (T1) | KEEP-NOW | 1h; the only proof a stranger can verify in two minutes, and HN punishes signup walls                                                                                                  |
| Route-level OG card for /inbox-simulator (T2)         | KEEP-NOW | All 26 routes currently unfurl with one generic image; the demo's differentiator is invisible at the exact moment someone shares it; verify against the documented metadata merge trap |
| PostHog demo funnel from existing events (T8)         | KEEP-NOW | 1h pure configuration; decides whether further free-tool investment is justified; read as directional (persons = browsers)                                                             |
| Gmail storage math calculator (T4)                    | LATER    | Honest, externally-verifiable math; 10h that loses to launch-window priorities                                                                                                         |
| Unsubscribe-header inspector, paste-based (T7)        | LATER    | Credibility + internal-linking asset, low search demand; client-side parse-only, never fetch found URLs                                                                                |
| Gmail cleanup query builder (T3)                      | DROP     | 12h into a crowded cheat-sheet space; the live /how-to pages already carry the recipes, and the lens itself doubts it beats a static table                                             |

### Group 10 — Referral / attribution (verdict: no program yet — plumbing only)

| Tactic (lens#)                                           | Verdict  | Reason                                                                                                                                                                   |
| -------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Wire signup attribution through the OAuth flow (F1)      | KEEP-NOW | Launch traffic arrives exactly once and cannot be re-attributed; the cross-domain jump loses the thread today; includes the optional "How did you hear about us?" select |
| Written WOM tripwire; shelve the give-get blueprint (F5) | KEEP-NOW | 2h decision doc: ≥10% of first 200 attributed signups from "a friend or colleague" or ref-links → then and only then build the real program (Plus-months, in-app only)   |
| Shareable Activity receipt card (F2)                     | LATER    | Needs real users to matter; founder's card-zero need is covered by the data post's screenshots                                                                           |
| Founding Pro +1 invite (F3)                              | LATER    | 14h of billing-surface change + refund edge cases + every "first 250" copy touch — not during launch; real candidate after first seats sell                              |

**Verdict totals (in original-tactic units): 52 KEEP-NOW · 15 LATER · 2 DROP** (T3 query
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

## 6. Top 3 actions for THIS week

1. **Ship the truth gates: ratified hero + honesty sweep.**
   The playbook's every downstream step (directories, launch posts, LLM descriptions)
   fossilizes whatever is live.
   _First step:_ check whether an ADR-0030 hero PR already exists on a branch; if not, edit
   `apps/web/src/features/marketing/landing/hero.tsx` (lines 21–26 still render "Control
   Gmail by sender, not by email") to the ratified kicker/H1. Same pass: replace the "Most
   popular" badge string in `apps/web/src/features/marketing/pricing/tier-card.tsx`, and
   align the canonical sentence across `public/llms.txt`, the comparison hub intro, and
   `faq-content.ts`.

2. **Wire attribution before any launch traffic, and open the community accounts.**
   _First step (10 min):_ create the F5Bot account with the 10 buying-intent keywords
   ("unroll.me alternative", "clean email safe", "trimbox", "mailstrom", "sanebox",
   "leave me alone app", "gmail storage full", "mass delete gmail", "bulk unsubscribe",
   "delete emails by sender"). _Then:_ thread a `ref` param through
   `apps/api/src/auth/google-oauth.controller.ts` into the OAuth state blob and a
   `signup_attribution` jsonb column, plus the one optional skippable
   "How did you hear about us?" select. Same week: 3 substantive HN comments
   (hn.algolia.com → "gmail", past month), add declutrmail.com to the Reddit profile bio,
   create the PH Coming Soon page, and fix the reddit-comments skill (URL → .com,
   preview-first lead, "preset rules" not "auto-clean", 7-day undo at Free).

3. **Start the two evidence clocks on the founder mailbox.**
   The data post is the Show HN companion and the only proof asset the constraints allow;
   the observatory needs 30 days of runway to publish inside the launch window.
   _First step:_ run read-only SQL against the founder's synced mailbox — messages-per-sender,
   unsubscribe-channel distribution (one_click / mailto / link / none), size-by-sender —
   and save the raw CSVs as the post's source of truth (query, never approximate; re-verify
   the headline message count at publish time). _Then:_ run one real unsubscribe session
   across 50+ eligible senders and export the Activity ledger list with dates — that starts
   the 30-day observatory clock today.
