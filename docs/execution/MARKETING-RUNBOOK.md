# DeclutrMail marketing runbook

**This is the operating queue.** Other files are voice, drafts, or archive.
Open this when you are confused. Do the next unchecked box. Do not re-read the
69-tactic catalog until a box in this file tells you to.

**If a skill, draft, or old checklist conflicts with this file, this file wins.**

Last updated: 2026-08-26 (Phase B attribution plumbing).

---

## 0. If you are overwhelmed, do this

You are a solo founder with zero customers and zero paid budget. The product
already has a landing page, how-tos, `/vs` pages, and `/inbox-simulator`.
**Reach is not blocked by more pages. It is blocked by (1) signups you cannot
attribute to a channel, (2) nothing posted, (3) you not being in comment
sections.**

Today:

1. Finish **Phase A handles** yourself (~30 minutes: brand + human accounts,
   bios, F5Bot). Coming Soon and HN seasoning are this-week work, not 30 minutes.
2. Tell Cursor: _"Follow MARKETING-RUNBOOK.md Phase B. Use the attribution skill."_
3. Every day, run **the community loop** even if launch is not booked.

Do not: re-edit the hero, install more marketing skills, start a Discord, buy ads,
or wait for SEO. Search Console (`sc-domain:declutrmail.com`, 24 May–21 Aug 2026)
showed how-tos getting impressions and **zero clicks**. Re-query before repeating
that sentence.

---

## 1. What each file is for

| File                                                       | Role                                              | Open it when                   |
| ---------------------------------------------------------- | ------------------------------------------------- | ------------------------------ |
| **This runbook**                                           | What to do, in order                              | Every marketing session        |
| `.agents/product-marketing.md`                             | Voice, claims, objections. Skills read this first | Writing any public sentence    |
| `~/.claude/skills/reddit-comments-declutrmail/SKILL.md`    | Drafts Reddit comments                            | You paste a Reddit URL         |
| `docs/execution/launch-content-drafts-2026-08-04.md`       | Raw launch posts — **not safe to post yet**       | Phase C rewrite                |
| `docs/adr/0030-positioning-preview-guarantee.md`           | Why we sell the preview, not "by sender"          | Positioning argument           |
| `docs/execution/marketing-outreach-playbook-2026-08-04.md` | Tactic archive (69 items, verdicts)               | You need a kill/keep rationale |
| `docs/execution/founder-launch-checklist.md`               | Infra (DNS, MX, secrets) — not acquisition        | Preflight before going live    |

Default dropped link everywhere: **https://declutrmail.com/inbox-simulator**
Homepage only when they asked for the company, not the product.

---

## 2. Locked facts (do not paraphrase upward)

| Thing     | Say this                                                                                            | Never say                                                                             |
| --------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Privacy   | **We never fetch or store full email contents.** + the generated storage list                       | `Full bodies fetched: 0`, `Bodies read: 0`, "privacy-first", "never reads your email" |
| Hero      | _For inboxes you gave up on._ **Clear thousands of emails by sender — and see exactly what moves.** | A new headline experiment                                                             |
| Verbs     | Keep · Archive · Unsubscribe · Later · Delete                                                       | "Screen" in UI or posts                                                               |
| Undo      | Archive / Later / Delete; 7-day Free/Plus, 30-day Pro                                               | "Every action is reversible" (unsubscribe cannot be recalled)                         |
| Autopilot | Plus _finds_, you approve. Pro can _act_ after you enable                                           | "auto-clean", "AI-powered", predicted categories                                      |
| Proof     | Founder mailbox only, labeled as yours, numbers re-queried at publish                               | Fake users, testimonials, MAU                                                         |
| CASA      | Google approved a verification (21 Apr 2026)                                                        | "Google certified us"                                                                 |
| Offer     | Founding Pro $129/yr, first 250, locked while active                                                | "X left" unless it reads live redemptions                                             |
| Free      | 50 actions/month, 1 inbox — untargeted copy must be true here                                       | Promising Plus/Pro-only features as the default                                       |

Do not list in AI-tool directories (category prediction is banned).

---

## 3. Accounts (brand vs you)

**Brand account `@declutrmail`** — product chrome: announcements, support, PH, directories, X originals.
**One human account** — Reddit loop, HN seasoning + Show HN comments, PH Maker, X replies.
Disclose "I built it" when the product is named. Legal name, employer, and visa status are not required.

Do **not** create a third "random user" account. No alt accounts, ever.

| Surface                 | Which account                   | Rule                                                                                                           |
| ----------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| r/gmail, r/productivity | Human                           | Native Gmail method first. Product only if they asked for a tool. Link in **bio**, almost never in the comment |
| r/digitalminimalism     | Human                           | Never the product, never a link                                                                                |
| r/SideProject           | Human                           | Simulator + one differentiator. Stop                                                                           |
| Show HN / Product Hunt  | Human as maker; brand may exist | First link = simulator. Answer _their_ question                                                                |
| X originals             | Brand                           | 1/day max. Preview GIF, founder-mailbox receipts                                                               |
| X replies               | Human                           | Product link ≤1 in 5. If named, say you made it                                                                |
| LinkedIn                | Company page                    | Story in the post, link in the first comment. Skip personal LinkedIn if that is the identity risk              |

H‑1B: a brand handle hides your name from casual search. It does **not** authorize the work. Get immigration counsel before Show HN. This runbook is not legal advice.

---

## 4. The community loop (start now)

Reddit + X is about **45 minutes on a weekday**. HN is **3 comments/week**, not
daily. Skills **draft**. You **click submit**.

**Reddit (15–30 min, ≤2 replies/day)**

1. F5Bot (or saved search) on: `unroll.me alternative`, `clean email safe`, `trimbox`, `mailstrom`, `sanebox`, `leave me alone app`, `gmail storage full`, `mass delete gmail`, `bulk unsubscribe`, `delete emails by sender`.
2. Paste the thread URL in Cursor: _"Draft a Reddit comment for this using the reddit-comments-declutrmail skill."_
3. Read the live thread. Rewrite anything that sounds like a template. Post from the human account.

Test: would this still be the best answer if DeclutrMail vanished? If the last paragraph is why you showed up, it is a pitch.

Native crib (teach without linking unless asked):

- Search `from:(the.real.address@example.com)`, sample before select-all.
- Archive frees **no** storage. Trash still counts against 15 GB until emptied. Drive and Photos share the quota. Space can take 48–72 hours to show.
- Delete ≠ unsubscribe. Do not unsubscribe phishing; report it.

One mod warning in a sub → bio-only there forever.

**X (20–30 min replies + at most 1 original)**

- Reply lane: people complaining about Gmail storage / newsletters. Useful-first.
- Original: one receipt (preview GIF or founder-mailbox numbers labeled as yours).

**HN (3 comments/week)**

- hn.algolia.com → "gmail" (past month). Comment only where you have first-hand knowledge. Zero product dump until Show HN.

---

## 5. Phases (do in order)

Checkboxes are the state. Do not skip B to "get users faster" — without B, you cannot tell which outreach worked.

### Phase A — Founder (this week)

Handles (~30 min):

- [ ] Reserve `@declutrmail` on X, Reddit, LinkedIn company, Bluesky, Product Hunt (D128)
- [ ] Create/keep **one** human handle. Bio on both: `https://declutrmail.com/inbox-simulator`
- [ ] F5Bot (or equivalent) on the 10 keywords above

This week, not the same half hour:

- [ ] Product Hunt Coming Soon collecting followers (the only launch-notification list the CAN-SPAM gate allows — no capture forms on content pages)
- [ ] Start HN seasoning: 3 comments this week, no product
- [ ] Immigration counsel before you book Show HN if H‑1B operating-authorization is still open. This runbook does not decide that.

### Phase B — Product plumbing so outreach is measurable (agent)

Tell Cursor: **"Follow MARKETING-RUNBOOK.md Phase B. Use the attribution skill."**

**Why this is first:** Google OAuth is a third-party domain (`accounts.google.com`).
If you only read the referrer after the callback, every signup looks like Google.
If a later `?ref=simulator` overwrites an earlier `?ref=hn`, Hacker News looks like
the demo. Then you cannot decide which comment section is worth another week.

**Source of truth for "how many":** the `users` (or workspace) row in Postgres.
PostHog explains journeys. It does not get to redefine the signup count. PostHog
"persons" are browsers, not people.

**Two signals, never summed** (first-touch tracked vs memorable self-report — they
disagree on purpose; the gap is the insight):

| Field                     | What it is                                                                           | Rule                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Tracked first-touch `ref` | `hn`, `ph`, `reddit`, `simulator`, `x`, `linkedin`, … captured on the marketing site | **Set-once.** Persist into OAuth state _before_ redirect to Google. Never overwrite with a later click           |
| Self-report               | "How did you first hear about us?" pick-list of those channels + free-text Other     | Ask immediately after first successful login, skippable. Stores in separate `signup_attribution_heard_*` columns |

Audit before building: if PostHog already `identify()`s at signup and `$initial_*`
survives the API/app hop, do not rebuild that. Close only the OAuth `ref` hole.

- [x] Capture `ref` on marketing CTAs and `/inbox-simulator`. Allowlist the values above
- [x] Thread `ref` through `oauthStartUrl()` → OAuth state in `apps/api/src/auth/google-oauth.controller.ts` → persist **set-once** on the user (`signup_attribution_ref`)
- [x] Exclude `accounts.google.com` (and our own hosts / localhost) from referrer classification — code never infers a channel from `Referer`; PostHog project filter is a founder follow-up
- [x] `posthog.identify` at signup with a stable id (audit first). Consent-gated; no mailbox content
- [x] Skippable self-report pick-list + Other, same session as first login — separate column, not a overwrite of `ref`
- [x] Copy both fields onto the first paid event (Founding Pro). Optimizing only for signups will lie about revenue
- [x] Simulator end-card: decision tally, "Do this on your real inbox", copyable link that sets `ref=simulator` **only if ref is still empty**

Do not build a referral program. Do not A/B test. Do not build multi-touch or MMM.
Under ~1,000 signups every variant is noise. Small-budget default: first-touch +
self-report side by side.

### Phase C — Copy that is safe to post (agent)

Tell Cursor: **"Follow MARKETING-RUNBOOK.md Phase C. Use copy-editing, then copywriting."**

- [ ] Sweep `.agents/product-marketing.md` and `launch-content-drafts-2026-08-04.md` for banned privacy counters
- [ ] Write the **12-answer crib** (HN/PH comments). Answer 1: restricted-scope / CASA (verification ≠ certification). Answer 2: why this exists vs Gmail Manage subscriptions → `/vs/gmail`. Every answer links a live proof page. First link = simulator
- [ ] Rewrite Show HN body, PH maker comment, X launch thread onto the locked headline

### Phase D — Evidence (founder + agent for charts)

The only social-proof you are allowed to publish.

- [ ] Query live founder-mailbox stats (message count, per-sender, unsubscribe-channel mix, size). Save CSVs. **Do not reuse ~121k**
- [ ] Publish "Anatomy of my inbox" on `/blog` with those numbers labeled as yours
- [ ] One real 50-sender unsubscribe session → start the 30-day "who actually stopped" observatory
- [ ] Film 20–30s **real** preview → confirm → undo. That file is the X pin and PH gallery lead. Do not generate fake Gmail UI

PH gallery (5 frames): (1) preview → confirm → undo, (2) preview modal with exact count + sample, (3) sender row with Keep / Archive / Unsubscribe / Later / Delete, (4) privacy badge + storage list, (5) pricing card.

### Phase E — Directories (after B is live)

Tell Cursor: **"Follow MARKETING-RUNBOOK.md Phase E. Use directory-submissions. Skip every AI-tool directory."**

- [ ] AlternativeTo + SaaSHub, destination `/vs` pages
- [ ] LinkedIn company + Crunchbase, byte-identical facts
- [ ] Do **not** submit G2/Capterra until real reviews exist
- [ ] Do **not** submit Futurepedia / TAAFT / "AI agent" lists

### Phase F — Launch week (only when gates are green)

**Do not book a slot until all of these are true:**

| Gate | What                                   | Status as of 2026-08-25                                      |
| ---- | -------------------------------------- | ------------------------------------------------------------ |
| G1   | Production hero matches `hero.tsx`     | Shipped in repo — confirm production HTML                    |
| G2   | `/vs/gmail` and `/vs/unroll-me` live   | Shipped in repo — confirm production                         |
| G3   | 12-answer crib, no banned privacy copy | OPEN (Phase C)                                               |
| G4   | Attribution through OAuth              | Shipped in repo 2026-08-26 — confirm production after deploy |
| G5   | PH Coming Soon collecting ≥1 week      | OPEN (Phase A)                                               |
| G6   | Anatomy blog post published            | OPEN (Phase D)                                               |
| G7   | Simulator OG unfurls on X/Slack        | Shipped in repo — confirm production unfurl                  |

Calendar (solo founder cannot staff two comment sections the same day):

| Day       | Move                                                                                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Day 1 Tue | **Show HN** 5:30–7:00pm IST. Title: `Show HN: DeclutrMail – Gmail cleanup that previews every change before it runs.` First link = simulator. You in comments all evening |
| Day 2–3   | Reply tail. Recycle top questions into `/answers`                                                                                                                         |
| Day 4     | If <10 points: second-chance email to hn@ycombinator.com. Finalize PH gallery from real questions                                                                         |
| Day 5–7   | Rest + community loop. Sleep-shift for PH                                                                                                                                 |
| Day 8 Tue | **Product Hunt** 12:01am PT = 12:31pm IST. Founding Pro stated as a fact. Ask for feedback, never votes                                                                   |
| Day 9     | r/SideProject: try the simulator, one question — "does the preview feel like enough to trust a bulk delete?"                                                              |

If HN <10 points: one retitled retry after 1–2 weeks, then stop. Mid-pack PH is acceptable. Never buy upvote pods.

### Phase G — After first users

- [ ] `customer-research` on the first 5 conversations. Replace persona hypotheses
- [ ] WOM tripwire (pre-committed, not a measured law): if ≥10% of the first 200 **self-reports** say friend/colleague, _then_ consider a referral program. Do not use tracked `ref` for this — friends do not show up as referrers
- [ ] Monthly 20-query AI-visibility audit (cited → mentioned → recommended)
- [ ] Roundup pitches, 3/week, week 3+ — the no-signup simulator is the asset

---

## 6. Which skill to invoke

Installed globally 2026-08-25 from [coreyhaines31/marketingskills](https://skills.sh/coreyhaines31/marketingskills).
Do **not** install the rest of the pack. Do **not** re-run the nine lenses — the playbook _is_ that run.

Reddit stays on the **custom** skill. Do not install a second Reddit automation skill.

| You want                           | Say this to Cursor                                                 | Skill                         | Constraint from this runbook                                                      |
| ---------------------------------- | ------------------------------------------------------------------ | ----------------------------- | --------------------------------------------------------------------------------- |
| Measure launch traffic             | "Phase B. Use the attribution skill."                              | `attribution`                 | Set-once first-touch `ref` + separate self-report. Never sum them. No multi-touch |
| Safer public copy                  | "Phase C. Use copy-editing."                                       | `copy-editing`                | Locked privacy headline                                                           |
| New HN/PH/X words                  | "Write the Show HN body. Use copywriting."                         | `copywriting`                 | Simulator first, no kicker copy on HN                                             |
| X or LinkedIn post                 | "Turn this cleanup session into one X post. Use the social skill." | `social`                      | 1 original/day, not 3–10. Link in LinkedIn first comment                          |
| Simulator / pricing convert better | "CRO the simulator end-card."                                      | `cro`                         | No A/B. Ship one version                                                          |
| AlternativeTo blurb                | "Directory copy for AlternativeTo. Skip AI directories."           | `directory-submissions`       | After Phase B                                                                     |
| First user interviews              | "Draft 5 interview prompts."                                       | `customer-research`           | After users exist                                                                 |
| Blog/social chrome                 | "Generate a blog hero. Not a fake Gmail screenshot."               | `image`                       | Real product shots via Playwright/simulator                                       |
| Shot list for the 20s clip         | "Shot list for preview→confirm→undo. Screen recording, no avatar." | `video`                       | Real capture. No talking-head                                                     |
| Reddit reply                       | Paste URL + "draft a comment"                                      | `reddit-comments-declutrmail` | You click submit. ≤2/day                                                          |

Every Haines skill reads `.agents/product-marketing.md` first. Keep that file honest.

---

## 7. Already shipped (do not rebuild)

- Hero in `apps/web/src/features/marketing/landing/hero.tsx`
- `/vs`: clean-email, trimbox, sanebox, leave-me-alone, gmail-filters, gmail, unroll-me
- 6 `/how-to` (including `gmail-storage-full`) + 5 `/answers` + hubs
- `/inbox-simulator` + OG card. `/demo` 308s here
- `/pricing.md`, `public/llms.txt`, FAQPage JSON-LD
- Pricing card says **Recommended**, not "Most popular"
- PrivacyBadge uses the plain-language headline

Use those URLs as comment destinations. Do not wait for them to rank.

---

## 8. Explicitly not channels (now)

- Owned email / newsletter on content pages (CAN-SPAM postal-address gate). Resend = transactional only
- Paid ads
- Discord / Slack community
- G2 / Capterra review pushes
- AI-tool directories
- Privacy-absolutist forums (a public rejection of a closed-source cloud Gmail tool becomes a durable cite; skip)
- Auto-posting, upvote pods, alt accounts

---

## 9. The 5 numbers that matter

One spreadsheet, weekly. No dashboard. **Never add PostHog + `ref` + self-report
and call it "total signups."** Postgres is the count. The other columns explain it.

Primary conversion (from `.agents/product-marketing.md`): connect Gmail and
complete the first previewed cleanup. Signup is the leading indicator, not the
goal.

1. New users this week (Postgres) split by **tracked `ref`** and, separately, by **self-report**. Large "direct" + empty `ref` is a measurement hole (stripped Reddit/HN referrers, OAuth overwrite), not a channel
2. Simulator funnel in PostHog: view → preview opened → decision confirmed → completed → CTA. Directional; persons ≠ people
3. Signup → first real preview→confirm within 24h (activation — the aha on a real mailbox)
4. Founding Pro seats claimed (of 250) + 30-day refund rate, **broken down by the same two attribution fields** copied at payment
5. Monthly AI-visibility rung on a fixed 20-query list (cited / mentioned / recommended / recommended-against)

Ignore until 100 users: PH rank, HN karma, followers, likes, pageviews, keyword rank, A/B, email metrics.

---

## 10. How to start the next Cursor session

Copy one line:

```
Read docs/execution/MARKETING-RUNBOOK.md. Do the next unchecked box in Phase B.
Use the attribution skill. Set-once ref through OAuth; separate self-report;
do not let simulator overwrite hn/ph. Do not re-edit the hero. Do not install more skills.
```

When B is checked:

```
Read docs/execution/MARKETING-RUNBOOK.md. Do Phase C.
Use copy-editing then copywriting. Sweep banned privacy counters.
```
