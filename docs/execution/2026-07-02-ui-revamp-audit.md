# UI Revamp + Growth Engine — Current-State Audit & Concept Directions

> 2026-07-02. Session deliverable for the design-and-growth push (workstreams D/E).
> Read-only audit: live app walk (dev login, desktop + 375px mobile), code-level
> surface audit, competitive teardown, plan/ADR digest. No production code written.

---

## 1. Corrections to the brief's premises (verified against code + live app)

The brief was written against a stale snapshot. Three of its premises changed:

| Brief claim                                               | Reality (verified)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tokens are "Geist Sans/Mono, cool/Vercel palette (D1–D2)" | Shipped identity is **warm-newsprint editorial**: Fraunces display serif + Inter + JetBrains Mono (`apps/web/src/app/layout.tsx:4`), warm paper `#FAFAF7` bg with literal SVG grain (`packages/shared/src/styles/tokens.css:57`), deep-teal accent, hover-lift motion, reduced-motion + focus-visible baked in. The senders-lab winner was hardened into the token layer (ADR-0016/0017 era). **Plan D1/D2 still say Geist/cool — this is plan-drift, surfaced as DQ14.**                                            |
| "Zero responsive usage; core product desktop-only"        | Responsive **shell** exists and works (sidebar→hamburger ≤900px, CSS-first: `tokens.css:163-183`). Senders is fluid-functional on 375px (cards collapse to 1-col, chips wrap, zero horizontal overflow). Triage is **broken at the decision level** on mobile (see §2). And **ADR-0018 already specs the full mobile dialect** (<600px row-list, swipe-right primary, long-press multi-select, bottom sheets) — tagged "Phase 4 post-launch", never built. Mobile work = implement an existing spec, not invent one. |
| "Look for /senders-lab"                                   | Route no longer exists — throwaway was removed after the founder pick was hardened. Precedent (build real variants → pick → harden) confirmed and reused in §5.                                                                                                                                                                                                                                                                                                                                                      |

Confirmed as stated: **no referral/share/testimonial/blog surface anywhere** (waitlist form only); no per-user OG image; landing/pricing/legal/onboarding live; privacy badge at 8 render sites.

## 2. Live-walk findings (dev login, both-mailbox workspace, desktop + mobile)

**Defects (would block "revamp done" claims, independent of direction):**

| #   | Finding                                                                                                                                                                                                                                 | Where                             | Severity      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------------- |
| W1  | **Mobile triage loses sender identity**: expanded row at 375px renders avatar + "Unsubscribe · 95%" chip only — sender name/email/stats line not rendered. You cannot see who you're deciding about.                                    | Triage expanded row, 375px        | HIGH          |
| W2  | **Disabled verb with no explanation**: Amazon.com row — engine chip says "Unsubscribe · 95% RECOMMENDED", but the Unsubscribe pill is `disabled` with no tooltip/reason. Recommendation contradicts affordance; dead end.               | `features/triage` action pills    | HIGH          |
| W3  | **Stat contradiction displayed side-by-side**: row header "Quiet 90d · 555 lifetime" while stat card says "LAST SEEN today" and reasoning says "zero messages in the past month". Trust-eroding on the trust-selling screen.            | Triage expanded row               | MED           |
| W4  | **Uniform "95%" confidence on every queue row** (12/12 rows, incl. HDFC Bank transactional alerts — the exact class #248/D29-damping targeted). Stored recommendations look stale post-fix; uniform numbers read as confidence theater. | Triage queue (data, not UI)       | MED           |
| W5  | **Triage queue has no EmptyState** — the inbox-zero moment (the product's emotional payoff and natural share trigger) renders nothing. D212 requires an EmptyState on every queue.                                                      | `features/triage`                 | MED           |
| W6  | Landing hero demo animation has a blank frame between cycles (panel renders empty for a beat).                                                                                                                                          | `features/marketing/landing/hero` | LOW           |
| W7  | Keyboard affordances (K·A·U·L header, kbd chips) render on touch viewports where they're meaningless.                                                                                                                                   | Triage mobile                     | LOW           |
| W8  | Pricing copy "Clean it yourself, unlimited" uses "clean" as a verb — on the D209 forbidden list. Needs a scope ruling (marketing register vs product UI), not a silent rewrite.                                                         | `(marketing)/pricing`             | RULING → DQ18 |

Zero console errors/warnings across the entire walk. Focus-visible ring, reduced-motion, and row aria-labels all present — a11y baseline is genuinely decent; full keyboard-only E2E still needs a real-keypress pass (synthetic events don't trigger the handlers; Playwright or hands).

**Also observed:** Brief narrative surfaced a bank balance ("account sits at $3,616") derived from an allowlisted snippet — not a §2.1 violation, but derived-sensitivity in generated copy deserves a copy-level guideline before launch.

## 3. Instrumentation audit (PostHog, D159)

Wrapper exists (`apps/web/src/lib/posthog.ts`, scrubbed at two boundaries). 72 event names defined, **28 wired**. Funnel coverage:

| Stage                | Wired                                           | Missing                                                                                 |
| -------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------- |
| Landing              | `page_viewed('landing')`, `landing_cta_clicked` | —                                                                                       |
| Signup/OAuth         | `beta_gate_denied`                              | OAuth grant started/completed                                                           |
| Onboarding           | `onboarding_step_viewed/completed`              | —                                                                                       |
| Sync                 | `sync_now_clicked`                              | **`sync_started`/`sync_completed`** (aha-moment timer unmeasurable)                     |
| **Triage core loop** | **nothing**                                     | `page_viewed('triage')`, `triage_action_taken`, `undo_clicked`, `unsubscribe_attempted` |
| Billing              | `checkout_started`, `upgrade_prompt_shown`      | billing success confirmation                                                            |

The activation funnel is dark exactly where the brief cares: connect → first-sync-done → first-triage-action. No server-side PostHog in `apps/api`.

## 4. Growth-surface gaps (all confirmed absent)

- **No aggregate stats endpoint.** Nothing computes "emails handled / senders unsubscribed / time saved" app-wide (`/api/activity` returns rows, Brief has per-section counts only). The share moment needs a small API aggregate first.
- No referral, no share card, no per-user OG image, no testimonial component (landing placeholder deferred per D136), no blog/changelog.
- Free-tier growth framing exists (pricing page + Founding Pro banner) and DQ11 (Free unlimited unsubscribe) is already queued.

## 5. Competitive teardown (agents' findings, compressed)

|                         | Clean Email                           | SaneBox                                    | Leave Me Alone                                                     | Unroll.me                  |
| ----------------------- | ------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------ | -------------------------- |
| Hook                    | "email Zen" stress relief             | AI + "3–4 hrs/week saved"                  | 1-click unsub + indie ethics                                       | free instant relief        |
| Pricing                 | $9.99/mo (1 acct) → $29.99/mo         | $7/$12/$36/mo, **no free tier**            | 10 free credits; $9/$16/mo                                         | free (data-funded)         |
| Privacy at OAuth moment | mid-homepage only                     | mid-page only                              | marketing-prominent, **but Rollups stores encrypted body content** | post-FTC disclosure portal |
| Register                | blue SaaS-generic                     | dated-professional                         | indie-warm, **no iOS app**                                         | consumer-mobile            |
| Growth                  | "5B emails cleaned yearly", affiliate | $5/$5 referral (buried)                    | affiliate closed; weak numbers ("2,000+ customers")                | free-ness itself           |
| First win               | indexing wait                         | **overnight** processing + 1–2 wk training | fast list                                                          | fastest (price = consent)  |

**Exploitable lanes:** (1) nobody answers "will you read my email?" _at the grant screen_ — unclaimed; (2) "never sell" is commoditized, **"never fetch" is one provable step further** — every paid rival touches bodies somewhere (LMA Rollups stores content, SaneBox takes full IMAP, Clean Email fetches on preview); (3) verbs-in-seconds vs SaneBox's weeks of training; (4) time-to-first-win stopwatch (sub-5-min connect→cleanup beats everyone not named Unroll.me); (5) share receipts + visible referral (rivals hide theirs); (6) mobile-quality gap at the privacy-first incumbent (LMA has no iOS).

**Unroll.me citable facts** (for objection-handling copy; stick to public record): NYT Apr 23 2017 (Lyft receipts sold to Uber via Slice); CEO "heartbreaking" post Apr 24 2017; FTC settlement 2019 — deception allegation, delete-data order, **no monetary fine** (never write "fined"); today owned by NielsenIQ, still monetizes commercial-email data, now disclosed. In this niche "Unroll.me alternative" is table stakes (LMA/Mailstrom/Clean Email all run the page) — differentiate with **architectural proof**, not accusation alone.

## 6. Identity references (what amplifies vs clashes)

Amplifies the shipped warm-editorial register: HEY's named-stages opinionation + manifesto voice (we already have Screener, Brief, Quiet — name the rest of the ritual); newspaper spot-illustration (not pop cartoons); Notion Mail's calm text-first restraint; Superhuman's _mechanics_ — shortcut-teaching UI and a 100ms latency budget — without its dark-cockpit urgency register. Clashes: HEY's loud yellow/purple, Shortwave's AI-chrome density, confetti gamification.

## 7. Scored current-state checklist (per surface, /10)

| Surface                       | Identity        | Conversion/Job                                                | Mobile                                  | Edge states | Instrumented |
| ----------------------------- | --------------- | ------------------------------------------------------------- | --------------------------------------- | ----------- | ------------ |
| Landing                       | 9               | 6 (mechanism-led headline; zero social proof; demo gap frame) | 8                                       | 7           | 6            |
| Pricing                       | 8               | 7 (clear tiers, Founding Pro; no proof elements)              | 8                                       | 7           | 7            |
| Onboarding                    | 8               | 7 (badge at pre-OAuth + sync gate = right placement)          | unverified                              | 8           | 7            |
| **Triage (centerpiece)**      | 9               | 7 desktop (rich reasoning; W2–W4 trust bugs)                  | **2** (W1)                              | **4** (W5)  | **0**        |
| Senders                       | 9               | 8                                                             | 6 (fluid, undesigned; ADR-0018 unbuilt) | 8           | ~5           |
| Brief                         | 8               | 8                                                             | untested                                | 8           | ~5           |
| Growth (share/referral/proof) | —               | **0 — does not exist**                                        | —                                       | —           | 0            |
| Dark mode                     | absent (0 hits) |                                                               |                                         |             |              |

## 8. Direction-independent foundation work (starts regardless of pick)

1. **W1 mobile-triage fix + ADR-0018 implementation** on Triage + Senders (row-list, bottom sheets, swipe w/ D226 preview intact, touch targets; kbd hints hidden on touch).
2. **Triage EmptyState = the inbox-zero moment** (D212) — also the natural share trigger.
3. **Instrument the core loop**: `page_viewed('triage')`, `triage_action_taken`, `undo_clicked`, `sync_started/completed`, billing success; plus new-surface events (`share_card_viewed/shared`, `referral_link_copied`, `inbox_zero_reached`).
4. **Stats aggregate endpoint** (counts: emails handled, unsubscribed senders, per-window) → powers share card, inbox-zero copy, and future landing counters.
5. **Testimonial/social-proof component** built placeholder-ready in `packages/shared` (content stays deferred per D136; D220 promotion + story required).
6. **W2 disabled-verb explanation** + W3 stat-copy reconciliation; W4 recommendation-staleness check (data fix, likely re-run engine post-#248).
7. **Storybook debt**: 9 shared components missing stories (D210).
8. Pre-OAuth trust-panel elevation (container/prominence only — copy locked): scope-by-scope "we request gmail.modify, which means we _cannot_ send mail"-class cannot-statements, revocation affordance, audit badge slot. LMA has **no live counter** — our "Full bodies fetched: 0" as a live counter is the unclaimed proof artifact.

## 9. Three concept directions (to be built as real lab variants — senders-lab precedent)

**A — Broadsheet** (double down on editorial). Landing as manifesto front page (masthead, numbered sections — already half-built), Brief as "your morning edition", triage rows as clippings with paper-settle motion, inbox-zero as full-bleed etching + "Nothing needs you." Share card = newspaper clipping. _Strongest differentiation, highest whimsy risk (relief ≠ quaint), illustration pipeline required._

**B — Ledger** (calm precision; receipts-for-relief). Keep surfaces, systematize proof: NumericDisplay everywhere, action receipts ("Archived 412 · UNDO 7 DAYS" as stamped ledger lines), Superhuman-style shortcut-teaching pills, 100ms interaction budget with D226 preview intact, trust badge as live counter. Share card = monospace cleanup receipt with teal stamp. Inbox-zero = "0 decisions waiting — balanced." _Cheapest to systematize (extends ADR-0016/0017/0019 reasoning), register matches "engineering-grade privacy"; least warm on its own._

**C — Companion** (warm guide). Newsprint-style spot illustrations, guided first-run, calm celebration states ("quiet inbox" weather metaphor), softer marketing type. Share card = "Clear skies: 1,847 cleared." _Most directly aimed at anxiety relief; fights D209/ADR-0011 copy constraints hardest; illustration dependency; risks cute-vs-credible for a paid privacy tool._

**Recommendation: B as chassis + A's manifesto voice on marketing hero/empty states** (exactly where ADR-0011 permits editorial framing). Confidence 80. A remains a legitimate founder pick from the lab; C is the risk-heaviest.

**Lab plan:** throwaway `/revamp-lab` route (auth-exempt, desktop+mobile), 3 variants × 2 surfaces each (landing hero + live triage-row interaction w/ preview→undo mock). Founder picks; winner hardens via token/component layer, then surface-by-surface with `redesign` label + design-system-agent gate + full §8 smoke per PR.

## 10. Founder decisions raised (appended to decision-queue.md)

DQ14 D1/D2 plan-drift ratification · DQ15 direction pick (after lab) · DQ16 share/referral mechanic = new D-decision · DQ17 dark-mode scope · DQ18 D209 "clean (verb)" marketing-register ruling.
