# Pre-Launch Enhancements, Public Docs & SEO/AEO/GEO

> Snapshot: 2026-07-09. Companion to `prelaunch-ux-review-prompt.md`.
> Intent: what to ship / write / fix for best activation + retention odds
> before public launch — grounded in current code, D132/D219, and open
> FOUNDER-FOLLOWUPS.

---

## 1. Intent check (yes, understood)

You want three deliverables from an agent with full product context:

1. **A reusable Claude prompt** that reviews usability, comprehension
   friction (where users need more pointers), and feasibility of claims.
2. **A public-docs + SEO/AEO/GEO plan** for retention and discoverability.
3. **A pre-launch enhancement list** + an actual **smoke pass** of the product.

This document is (2) + (3)’s recommendations. The prompt is in
`docs/execution/prelaunch-ux-review-prompt.md`. Smoke results live in
`docs/execution/prelaunch-smoke-results.md` (filled by the smoke session).

---

## 2. Public-facing docs we should have

### Already shipped (audit for accuracy, don’t rebuild)

| Doc        | Route       | Retention job                    |
| ---------- | ----------- | -------------------------------- |
| Landing    | `/`         | Promise + trust + CTA            |
| Pricing    | `/pricing`  | Plan choice / waitlist honesty   |
| Help & FAQ | `/help`     | Self-serve answers (D219)        |
| Privacy    | `/privacy`  | Trust + compliance               |
| Security   | `/security` | OAuth / encryption / CASA claims |
| Terms      | `/terms`    | Contract                         |
| Refunds    | `/refunds`  | Purchase anxiety                 |
| Cookies    | `/cookies`  | Consent withdrawal               |
| Contact    | `/contact`  | Human escape hatch               |
| Beta       | `/beta`     | Expectation setting              |
| `llms.txt` | `/llms.txt` | Agent/GEO citation surface       |

**Keep these consistent.** Refunds are founder-confirmed 30-day money-back
on every paid plan (2026-07-08). Landing FAQ, `/help#refunds`, `/refunds`,
and `llms.txt` must stay identical on duration + scope.

### P0 — before paid / public traffic (gaps)

| Doc / surface                          | Why it retains users                                                          | Suggested home                                                                                  |
| -------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **Getting started (5 steps)**          | Cuts time-to-first-Archive; reduces “what now?” after sync                    | `/help#getting-started` first; promote later                                                    |
| **Verb semantics deep-link**           | Archive ≠ Delete ≠ Later — #1 support class for cleanup tools                 | Expand `/help#verbs-in-gmail-terms` + in-app first-use tip                                      |
| **Unsubscribe honesty card**           | One-click vs mailto-manual; “requested” vs “confirmed”                        | `/help#unsubscribe-flow` + Activity empty/help copy                                             |
| **Working support mailboxes**          | Dead `support@` / `privacy@` destroys trust on day 1                          | Founder: create aliases (open follow-up)                                                        |
| **Cookie consent (D147) live in prod** | Banner code exists (`features/consent/`); policy promises gate-before-PostHog | Keep `NEXT_PUBLIC_POSTHOG_KEY` unset in prod until banner is verified on the live apex/app host |
| **Billing honesty when dark**          | If `BILLING_ENABLED=false`, never imply live checkout                         | Already partially handled — verify copy on `/billing` + `/pricing` CTAs                         |
| **Status / beta limitations**          | Sets expectations; reduces churn from “broken” that is “deferred”             | Short section on `/beta` or `/help#beta-limits`                                                 |

### P1 — first 30 days (activation + retention)

| Doc                          | Job                                             | URL                                                                 |
| ---------------------------- | ----------------------------------------------- | ------------------------------------------------------------------- |
| Methodology                  | Prove “impact” math; cite-able trust page       | `/methodology` (D132 Tier 1)                                        |
| Disconnect / delete / export | Reduce fear of lock-in; GDPR/DPDP path          | `/help#disconnect-mailbox`, `#delete-account` + Settings deep links |
| Autopilot explained          | Observe vs Active is easy to fear               | `/help#autopilot-modes` + first Observe empty-state                 |
| Billing FAQ                  | Cancel, refund, plan change, Founding Pro       | `/help#pricing-tiers` + `/refunds` cross-links                      |
| Changelog                    | Build-in-public credibility; “product is alive” | `/changelog` (thin OK)                                              |
| In-app pointers              | Empty states + “Why this recommendation?”       | Feature empty-states → `/help#…`                                    |

### P2 — growth / SEO / AEO / GEO (D132)

Ship in waves; do not block private beta.

| Cluster     | Routes                                                                                                 | Notes                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| Comparisons | `/vs/clean-email`, `/vs/sanebox`, `/vs/leave-me-alone`, `/vs/trimbox`, `/vs/gmail-filters`, `/compare` | Honest “choose them if…” callouts (D142–145)                          |
| How-to SEO  | `/how-to/clean-gmail-by-sender`, bulk-delete, auto-archive, stop-promos, unsubscribe                   | Intent pages; link back to product ritual                             |
| AEO answers | `/answers/is-it-safe-to-connect-gmail-app`, metadata-only, undo, best-way-2026, sender-vs-message      | Question H1 + answer in first 2 sentences + JSON-LD                   |
| Demo        | `/inbox-simulator` (D133)                                                                              | No-signup trial of K/A/U/L/D — highest activation lever after privacy |
| Blog shell  | `/blog`                                                                                                | Empty index OK at launch                                              |

### In-product “docs” that matter more than a Help Center

Full Help Center is deferred (D219 → V2.1). Until then, retention is won by:

1. **Empty states that teach** (what to do + link to `/help#slug`).
2. **First successful action** within the first session (preview → Archive/Unsub → undo toast).
3. **Plain-language nav** default for new users (`use-labels` plain mode).
4. **Privacy badge** visible at connect + sync + settings (already wired in places — keep it).
5. **Activity honesty** for async unsubscribe (requested vs confirmed).

---

## 3. SEO / AEO / GEO — current standard checklist

### Shipped (good baseline)

- Per-page metadata + canonical + pinned `og:image` (`page-metadata.ts`)
- `sitemap.xml` / `robots.txt` (authed + onboarding disallowed)
- `llms.txt` for generative engines
- Organization + WebSite + SoftwareApplication JSON-LD
- FAQPage JSON-LD on landing + `/help` from single source arrays
- CSP / security headers middleware

### Gaps to close (priority order)

| Gap                                         | Why it matters                              | Action                                                          |
| ------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------- |
| Apex DNS still placeholder risk             | Crawlers + humans hit Squarespace 200s      | Founder DNS cutover; smoke must assert **content**, not status  |
| No `/methodology`                           | Trust + GEO citation page missing           | P1 content page quoting locked privacy module                   |
| No `/vs/*` / `/how-to/*` / `/answers/*`     | D132 growth IA empty                        | Wave content after beta; Claude SEO agent drafts, founder edits |
| FAQ overlap `/` vs `/help`                  | Thin/duplicate risk                         | Keep landing short; `/help` owns depth + slugs                  |
| `llms.txt` refund line soft                 | GEO agents under-informed                   | After surfaces agree, restore precise 30-day claim              |
| No HowTo schema on how-to pages             | AEO                                         | Add when Tier 3 ships                                           |
| No author/org sameAs links                  | Entity clarity for GEO                      | Add X/GitHub/Product Hunt when real                             |
| Core Web Vitals / Lighthouse CI             | Ranking + polish                            | Post-beta (audit listed it below cut line)                      |
| Internal links from app empty-states → help | Retention + crawl discovery of help anchors | P0 microcopy                                                    |

### AEO / GEO writing rules (use on every public answer page)

1. **Question as H1**; answer in the first 40–60 words.
2. **One source array** feeds visible copy + JSON-LD (already the pattern).
3. **Quote locked privacy/refund modules** — never paraphrase trust numbers.
4. **Gmail-only, metadata-only, preview-before-mutate** stated explicitly.
5. **Update `llms.txt` + sitemap together** (tests already reconcile paths).
6. **No fake social proof** at launch (D136) — methodology + demo carry trust.

---

## 4. Pre-launch enhancements (recommended)

### Block launch (private beta with real Gmail)

1. **Domain / OAuth redirect / cookie domain cutover** — founder hands.
2. **`support@` + `privacy@` accept mail** — founder hands.
3. **Verify D147 cookie consent on the live host before setting PostHog prod key** (banner code exists; prod key must stay unset until confirmed).
4. **Legal “Pending confirmation” markers gone** — governing law + any leftover refund drift.
5. **Gmail connect live in the environment users hit** (`GMAIL_CONNECT_ENABLED`).
6. **Smoke the no-active-mailbox → settings/billing escape hatch** on a real DB.
7. **Transactional email provider** (Resend) for sync-complete / deletion receipts — or explicitly document “email alerts not live yet” on `/beta`.

### Block paid conversion (public launch)

1. **`BILLING_ENABLED=true`** with Paddle/Razorpay catalog + webhooks + HMAC.
2. **Entitlement UX**: Free cap → upgrade modal copy matches `/pricing`.
3. **Refund + cancel paths** exercised end-to-end once.
4. **Tier gating honesty** on Screener / Brief / Followups / Autopilot.

### Block retention (first-week aha)

1. **Getting-started pointers** on post-sync empty Senders + Triage.
2. **Verb cheat-sheet** discoverable (Senders already has keyboard cheatsheet — surface once).
3. **Unsubscribe path explainer** in preview modal when method is mailto.
4. **Autopilot defaults to Observe** with a one-line “won’t act yet” — verify copy.
5. **Undo tray discoverability** (`Z` + visible control) on Triage + Senders.
6. **Mobile 375px** pass on topbar, senders, triage, secondary screens.

### High-leverage product enhancements (still pre- or early-launch)

| Enhancement                                             | Why                                                               |
| ------------------------------------------------------- | ----------------------------------------------------------------- |
| **Inbox simulator** (`/inbox-simulator`)                | Lets privacy-anxious users feel the ritual before OAuth           |
| **Methodology page**                                    | Answers “how do you know?” without reading the plan               |
| **Plain-language mode default for session 1**           | “People & lists” / “Today” beats jargon on day one                |
| **“Why this recommendation?”** one-liner on triage rows | Builds trust in the engine without category ML                    |
| **Stuck-sync reconciler for `syncing` rows**            | Onboarding progress bar wedge = instant churn                     |
| **Pub/Sub push subscription**                           | Autopilot/real-time freshness; otherwise 5–15 min drift           |
| **Account deletion execution**                          | Needs founder §9 approval — required before promising purge dates |

### Explicitly do NOT do before launch

- Category prediction / auto-protect (D222 banned)
- Auto-send mailto unsubscribes (D230)
- Skip action preview (D226)
- Fake testimonials (D136)
- Full Help Center (D219 deferred)
- Thin SEO spam pages with no unique answer

---

## 5. Suggested first content wave (post private-beta)

Week-by-week outline (effort, not calendar promises):

1. **Wave A:** `/methodology` + `/help#getting-started` + empty-state links.
2. **Wave B:** `/answers/is-it-safe-to-connect-gmail-app` +
   `/answers/what-is-metadata-only-email-analysis` + refresh `llms.txt`.
3. **Wave C:** `/how-to/unsubscribe-from-emails-gmail` +
   `/how-to/clean-gmail-by-sender`.
4. **Wave D:** `/vs/gmail-filters` + `/vs/sanebox` (honest callouts).
5. **Wave E:** `/inbox-simulator` + `/changelog` shell.

Each page: unique intent, JSON-LD where applicable, link to Connect CTA,
quote privacy module for any storage claim.

---

## 6. How to run the Claude review

1. Open Claude in this repo.
2. Paste `docs/execution/prelaunch-ux-review-prompt.md` (everything below the `---`).
3. Optionally attach this file + `CLAUDE.md`.
4. Ask for the seven-section output format at the bottom of the prompt.
5. For a live pass: `./scripts/dev-up.sh` (or `cloud-smoke.sh`) + the smoke
   checklist in the prompt.

---

## 7. Founder decisions still open (do not let agents invent these)

From FOUNDER-FOLLOWUPS (non-exhaustive):

- Live smoke of no-active-mailbox fix (needs real DB + OAuth).
- Cookie consent before PostHog prod key.
- `support@` / `privacy@` mailboxes.
- DNS / apex cutover off Squarespace.
- Account deletion execution build approval (§9).
- Pub/Sub push subscription completion.
- Whether private beta stays free-only before billing goes live.
