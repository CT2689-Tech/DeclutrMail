# DeclutrMail — CPO / UX / growth / staff-engineering audit

**Date:** 2026-07-25 · **Basis:** repo at `bdec1530` (main), full local run against
the founder's real 121,070-message mailbox, live production probes, and current
primary sources on Gmail's AI programme.

Everything asserted here was probed. Where a claim is second-hand (an existing
followup, an unread runbook) it says so.

> **Status update — 2026-07-26.** Rows are marked ✅ inline as they close, with
> the PR that closed them. Since the 07-25 pass: **A1, A4, A5, B8, B9 closed**
> (infra), **A2, B3, B4 landed in #388** (they had been written but left
> uncommitted — the doc was asserting them as done while only a working tree
> could back it), and **CASA confirmed approved 21 Apr 2026**.
>
> **Remaining launch blockers: A3** (free-tier / pricing — founder's call, and
> the largest single change here) and **A6** (billing card asserts two plans).
> Every other ❌ in §7 is now green.

---

## 1. Executive verdict

**The software is launch-grade. The business model and the positioning are not.**

What is genuinely good, and rarer than the founder probably thinks:

- The privacy architecture is real, not marketing. `mailbox_accounts` has no
  email column; the storage list on the landing page is _generated_ from
  `gmail-data-inventory.ts`; the "Full bodies fetched: 0" badge is a claim the
  schema can back. Most competitors cannot say this and two of the best known
  ones (Unroll.me, Cleanfox) are famous for the opposite.
- The safety machinery is complete: mandatory preview → mutation → undo journal
  → activity ledger, with one-way actions (delivered unsubscribes) explicitly
  marked as non-recallable.
- Infra is in better shape than the followups log implies. `launch-preflight.sh`
  reports **46 pass / 2 real fail / 2 warn** today. Production `/api/readyz`
  returns `{"status":"ok","checks":{"database":"ok","redis":"ok"}}` right now —
  the Upstash suspension recorded in `FOUNDER-FOLLOWUPS.md` this morning is not
  currently firing.
- Test suites are green after this session's changes: **api 1,199 passed / 12
  skipped, web 998, shared 327** — 2,524 tests, zero failures.

**Would I launch it today for money? No.** Three things block it, and only one
is a code problem:

1. ~~**Nothing pages anyone when a dependency dies.**~~ **CLOSED 2026-07-26.**
   The `/readyz` uptime check and the "API not ready" alert policy now exist
   and are enabled, with a **VERIFIED** notification channel. Nine further
   guardrail defects were found and fixed while closing this (#380–#385), all
   of one shape: a check that could not tell _checked-and-clean_ from
   _never-checked_.
2. **The free tier cannot activate anyone and Plus cannot retain anyone.**
   Free is **5 cleanup actions for life** against a 7,892-sender list, with the
   core ritual (Triage) paywalled. Plus ($9) sells a one-time cleanup; every
   recurring mechanism — Autopilot, Brief, Screener — is Pro-only. That is a
   subscription business whose entry paid tier has no reason to renew.
3. **The headline positioning is now a description of a Gmail feature.**
   "Control Gmail by sender, not by email" is, almost word for word, what
   Gmail's _Manage subscriptions_ hub has done since 8 July 2025: senders ranked
   by volume, with one-click unsubscribe.

**Strongest opportunity:** the one thing Gmail structurally will not build —
**auditable, reversible bulk mutation**. Gemini's inbox cleanup is a chat command
with no scope preview, no per-sender ledger, no undo window, no cross-account
view, and no receipt. DeclutrMail already has all five and doesn't say so.

**Largest risk:** shipping Plus at all. It monetises a one-time event and
attaches a 30-day refund window to it.

---

## 2. Product definition (recommended)

| Field                      | Recommendation                                                                                                                                                                                                                                                                                                        |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Primary customer**       | The long-tenure personal Gmail owner with 20k–150k messages and 1k+ distinct senders, who has abandoned inbox-zero at least once and will not let software delete mail they haven't seen. (The founder's own mailbox is the archetype: 121,070 messages, 7,892 senders, 6,743 dormant, 2,316 with unsubscribe links.) |
| **Painful problem**        | Not "too much email." **"I cannot act in bulk safely."** Gmail makes bulk selection trivial and bulk _review_ impossible: no scope preview, no undo beyond a few seconds, no record of what you did. So people do nothing, forever.                                                                                   |
| **Core promise**           | **Clear thousands of emails by sender — see exactly what will change before it happens, and undo it after.**                                                                                                                                                                                                          |
| **Recurring paid outcome** | The inbox _stays_ clear without you: new senders are handled by rules you personally approved, and you get a monthly receipt of what was handled and what it saved you.                                                                                                                                               |
| **Positioning line**       | **"The safe way to bulk-clean Gmail."** Not "AI cleans your inbox" — that sentence now belongs to Google.                                                                                                                                                                                                             |

The current positioning sells the _unit of work_ (senders). The unit of work is
not defensible; Gmail copied it. **Sell the guarantee, not the unit.**

---

## 3. Gmail AI Inbox response

### What Google actually shipped

| Feature                                                                                                                   | Status                                                         | Date                                            |
| ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------- |
| **Manage subscriptions** — all senders listed, 3-week volume per sender, one-click unsubscribe/block, sorted by frequency | GA, consumer + Workspace                                       | Web 8 Jul 2025; Android 14 Jul; iOS 21 Jul 2025 |
| **AI Overviews** (thread summaries)                                                                                       | Rolling out to everyone, free                                  | 8 Jan 2026                                      |
| **Ask your inbox** (natural-language Q&A)                                                                                 | Google AI Pro / Ultra                                          | 8 Jan 2026                                      |
| **Suggested replies**, **Help Me Write**                                                                                  | Everyone, free                                                 | 8 Jan 2026                                      |
| **Proofread**                                                                                                             | AI Pro / Ultra                                                 | 8 Jan 2026                                      |
| **AI Inbox** — priority section above the inbox, to-dos, catch-up topics                                                  | Trusted testers; "more broadly available in the coming months" | 8 Jan 2026                                      |
| **Inbox cleanup with Gemini** — "delete all my unread emails from _company_ last year"                                    | Announced, Workspace subscribers                               | 2026                                            |

Sources: [Google — Gmail is entering the Gemini era (8 Jan 2026)](https://blog.google/products-and-platforms/products/gmail/gmail-is-entering-the-gemini-era/) ·
[Gmail's Manage Subscriptions hub](https://emailexpert.com/gmails-manage-subscriptions-hub-decluttering-inboxes-and-challenging-marketers/) ·
[How to manage subscriptions in Gmail (2026)](https://fluentcrm.com/blog/gmail-manage-subscriptions-feature/)

### Overlap, honestly

| DeclutrMail capability                                 | Gmail status                                    | Verdict                                                                                                                       |
| ------------------------------------------------------ | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Sender list ranked by volume                           | **Shipped** (Manage subscriptions)              | **Dead differentiator.** Stop leading with it.                                                                                |
| One-click unsubscribe per sender                       | **Shipped**                                     | Parity at best. Google also _mandates_ one-click unsubscribe from bulk senders, so the underlying capability is commoditised. |
| Bulk delete/archive by sender + query                  | **Shipping** via Gemini cleanup                 | Gmail wins on reach and cost (free/bundled).                                                                                  |
| Ranking "what matters"                                 | **Shipping** (AI Inbox)                         | Google has signals we cannot see. Do not compete here.                                                                        |
| Summaries, drafting, Q&A over content                  | **Shipped**                                     | Out of scope — and precluded by the no-body-storage guarantee.                                                                |
| **Scope preview before the mutation**                  | **Not offered**                                 | **Durable.**                                                                                                                  |
| **Undo window measured in days, per action**           | **Not offered** (Gmail undo is seconds)         | **Durable.**                                                                                                                  |
| **A permanent, auditable ledger of every bulk change** | **Not offered**                                 | **Durable.**                                                                                                                  |
| **Rules you approve, in Observe mode first**           | Gemini acts on command; no observe-then-promote | **Durable.**                                                                                                                  |
| **Metadata-only processing, provable**                 | Opposite by design — Gemini reads content       | **Durable, and structurally unavailable to Google.**                                                                          |
| **One control surface across several Gmail accounts**  | Not offered                                     | **Durable** (and the one feature people with 2+ accounts will pay for).                                                       |

### Recommended stance

**Complement Gmail; specialise in irreversibility.** Concretely:

- Rewrite the hero from _what it organises_ to _what it guarantees_: preview,
  undo, receipt.
- Add an explicit "Gmail already does X — here's what it doesn't" section
  instead of the current `/vs` competitor pages, which fight the wrong enemy.
- Make **multi-account** a first-class promise, not a Pro line item. Gemini is
  per-account by construction; a person with work + personal + a defunct startup
  address has no product at all today.
- **Do not** build summarisation, reply drafting, or priority prediction. All
  three are Google-owned, all three are cheap for them and expensive for us, and
  category prediction is already permanently banned (D222).

**Answer to "why pay you when Gmail has AI?"**
_Because Gemini will delete 4,000 emails when you ask it to, and you will never
be able to see what it took or get it back. DeclutrMail shows you the exact
scope first, keeps every change reversible for up to 30 days, and hands you a
record afterwards — across every Gmail account you own, without ever reading a
message body._

That sentence is true today. It is not what the site says.

---

## 4. Customer journey audit

| Stage            | What happens now                                                                      | Friction / trust problem                                                                                                                                                                                                                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Discovery        | 26 marketing routes incl. `/vs/[competitor]`, `/how-to/*`, `/answers/*`               | SEO surface is strong, but the competitive set is 2024's (Clean Email, Unroll.me). The actual competitor is a Gmail sidebar item.                                                                                                                                                                                                      |
| Landing          | Eight numbered chapters, ~2,400 words, storage list rendered twice                    | Excellent prose, wrong order. The proof-of-safety fine print outweighs the payoff. A first-time reader learns _what we don't store_ before they learn _what they get_.                                                                                                                                                                 |
| Signup / OAuth   | Promise → Connect pre-auth (good — consent screen isn't the first thing)              | Fine. This is well built.                                                                                                                                                                                                                                                                                                              |
| Sync             | D109/D224 sync gate with real stage + percentage                                      | Fine. No fake progress.                                                                                                                                                                                                                                                                                                                |
| **First value**  | Lands on `/senders`: **7,892 rows**, default sort "Most emails ever"                  | **The core failure.** The landing page promises "143 decisions"; the product opens with 7,892. The segmentation exists (`active 582 · quiet 567 · dormant 6,743`) but is a filter chip, not the default.                                                                                                                               |
| **First action** | Free = **5 lifetime** cleanup actions                                                 | 5 of 7,892 is a demo, not a free tier. The "aha" is _one decision moving 412 emails_; five of them cannot build a habit, and the cap is permanent, so there is no second visit.                                                                                                                                                        |
| Core ritual      | `/triage` → Plus paywall                                                              | The thing the entire landing page is about is not in the free product.                                                                                                                                                                                                                                                                 |
| Mobile           | Verified at 375px                                                                     | Topbar rendered the literal string **"o wir"** — a mid-word clip of the trust strip — on every authenticated screen. **Fixed this session.** The first mobile screen is ~90% explanatory card, 0% senders.                                                                                                                             |
| Recurring use    | Brief (Pro) empty until the snapshot worker runs; Autopilot rules ship Off in Observe | A Pro user's daily habit surface can be empty on day 1 with only "refresh in a few minutes" to explain it.                                                                                                                                                                                                                             |
| **Automation**   | Autopilot pending suggestions                                                         | **All 6,244 pending suggestions predated the index they claimed to describe** — the 2026-07-24 rebuild re-created every `senders` row, so 25 of the first 50 named nobody at all and the rest carried confidence and reasoning computed from purged mail. **Fixed this session** (rebuild clears them; read layer refuses stale ones). |
| Upgrade          | `/billing` + plan modal                                                               | Copy contradicts itself whenever entitlement tier and subscription tier diverge: _"CURRENT PLAN: Pro … Your Plus subscription is paused … your workspace is on Pro."_                                                                                                                                                                  |
| Billing edge     | Two live subscription rows (Paddle + Razorpay) existed on one workspace in the dev DB | Application guard (`SUBSCRIPTION_EXISTS`) is global and correct; there is **no DB uniqueness**, and the UI renders provider-specific copy for whichever row it picks.                                                                                                                                                                  |
| Cancellation     | 30-day money-back, consistent across `/refunds`, FAQ, JSON-LD, cancel modal           | Genuinely good. Verified consistent.                                                                                                                                                                                                                                                                                                   |
| Support          | `support@` / `privacy@` on `.com`; MX → Google Workspace verified                     | Preflight green. Whether a human reads it is unprovable from here.                                                                                                                                                                                                                                                                     |

---

## 5. Ranked recommendations

Effort: S ≤ ½ day · M ≤ 2 days · L ≤ 1 week · XL > 1 week.

### A — Launch blockers

| #   | Problem (evidence)                                                                                                                                                                                                                                                                                                      | Customer      | Impact                                                                             | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Effort | Risk                                 | Metric                                            |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------ | ------------------------------------------------- |
| A1  | **No dependency-outage detection.** `launch-preflight.sh monitoring` → 2 FAIL: readyz uptime check + not-ready alert policy missing. A suspended prod Redis ran 46 days unseen.                                                                                                                                         | All           | Silent total outage; jobs stop, users see nothing                                  | ✅ **Done 2026-07-26** — founder ran `setup-uptime-monitoring.sh`; `/readyz` uptime check + "API not ready" alert policy both exist and are enabled, notification channel **VERIFIED**                                                                                                                                                                                                                                                                                                    | S      | none                                 | preflight `monitoring` = 4 PASS                   |
| A2  | **Autopilot offered approvable mutations built on deleted evidence.** The initial-sync rebuild tears down and re-inserts `senders`, but pending matches survived: of 6,244 on the founder's mailbox, 32 named senders that existed nowhere and **5,978 named rows the rebuild had re-created** — only 234 were current. | Pro           | Approving a Gmail change whose preview rests on purged mail; direct D226 violation | ✅ **Done this session** — the rebuild deletes every UNEXECUTED match (pending + approved-not-yet-applied) in the same transaction; the API read layer and the action worker both require `senders.created_at <= matched_at`, so a stale row can be neither approved nor executed; FE falls back to the address                                                                                                                                                                           | M      | covered by 46 API + 34 worker specs  | 0 stale rows offered; `pendingTotal` matches list |
| A3  | **Free tier cannot produce activation.** 5 lifetime actions, Triage paywalled (`manifest.ts`).                                                                                                                                                                                                                          | All new users | No habit, no upgrade trigger, no second session                                    | Free = **50 sender decisions/month** + Triage included (see §6)                                                                                                                                                                                                                                                                                                                                                                                                                           | M      | revenue-model change, founder's call | D1 activation ≥ 40%                               |
| A4  | **Upstash budget suspension will recur.** Currently healthy, but the $20 budget that caused it is unchanged.                                                                                                                                                                                                            | All           | Same 46-day class of outage                                                        | ✅ **Done 2026-07-26** — founder moved Upstash to a **Fixed plan**, so the suspend-on-budget kill switch is gone. Watchdog: `🟢 OK — $8.39 spent, projecting $10.28 against a $30.00 cap`                                                                                                                                                                                                                                                                                                 | S      | cost                                 | `/readyz` stays 200 for 30 days                   |
| A5  | **Vendor watchdog red** — 6 of last 8 runs fail on a stale Razorpay key; GCP budget checks report UNCONFIGURED. `infra-snapshot` red 8 runs straight.                                                                                                                                                                   | Founder       | Dead guardrails; red CI trains you to ignore CI                                    | ✅ **Done 2026-07-26** — all 9 vendors report 🟢. Razorpay key rotated (2 webhooks active); `GCP_BILLING_ACCOUNT_ID` set + `roles/billing.viewer` granted on the **billing account** (first-ever green budget read). `infra-snapshot` fixed rather than disabled — it was **4 stacked bugs**, not one (#380–#384), and the first honest run immediately exposed that the CI SA could never read Secret Manager or the API SA's IAM policy, both of which had been serialised as `[]`/`{}` | S      | none                                 | both workflows green                              |
| A6  | **Billing state copy self-contradicts** when tier ≠ subscription tier (verified live).                                                                                                                                                                                                                                  | Paying users  | "Did my payment work?" support load, refund requests                               | One derived state machine; never assert two plans in one card                                                                                                                                                                                                                                                                                                                                                                                                                             | M      | design-freeze surface                | 0 support tickets of this class                   |

### B — High-impact launch improvements

| #   | Problem                                                                                                               | Impact                                                    | Fix                                                                                                                                                                                  | Effort | Metric                       |
| --- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ---------------------------- |
| B1  | Landing sells the _unit_ (senders), which Gmail shipped in Jul 2025                                                   | Whole acquisition funnel argues a settled point           | Rewrite hero around preview + undo + receipt; add "what Gmail's AI won't do"                                                                                                         | M      | landing → connect rate       |
| B2  | `/senders` opens on 7,892 rows sorted by lifetime volume                                                              | Contradicts the "we shrink N" promise at the first screen | Default to **active senders only**, sorted by 30-day volume; make dormant an explicit filter                                                                                         | S      | time-to-first-action         |
| B3  | Mobile topbar painted garbage ("o wir") at 375px                                                                      | Trust surface corrupted on the most-scrutinised viewport  | ✅ **Landed 2026-07-26 in #388** — strip hidden below 600px; both claims stay reachable via drawer nav. CI caught that this broke 5 a11y assertions, now asserted in both directions | S      | visual check at 375/620/1280 |
| B4  | Autopilot rule card claimed "4768 actions" for an Off rule that performed none                                        | Core truth violation in the automation surface            | ✅ **Landed 2026-07-26 in #388** — reads "4768 matched"                                                                                                                              | S      | —                            |
| B5  | 10 left-nav destinations (Senders, Triage, Screener, Autopilot, Quiet, Brief, Follow-ups, Later, Activity, + account) | New users cannot form a mental model                      | Collapse to 4: **Senders · Triage · Automation · Activity**; Quiet/Later/Follow-ups/Screener become views                                                                            | M      | nav depth per session        |
| B6  | Brief's empty state says "refresh in a few minutes" indefinitely                                                      | Pro's daily habit surface can be blank on day 1           | Generate the first Brief at end of sync; otherwise state the real next run time                                                                                                      | M      | Brief opens/week             |
| B7  | No DB uniqueness on live subscriptions per workspace                                                                  | Double-charge is one app-guard bug away                   | Partial unique index on `workspace_id where status in (active,past_due,paused)`                                                                                                      | S      | duplicate rows = 0           |
| B8  | `RATE_LIMIT_ENABLED=false` in the prod deploy manifest                                                                | A Redis-less prod boots fail-open instead of refusing     | ✅ **Done 2026-07-26 in #380** — removed from both API and worker deploys; verified ABSENT on both live Cloud Run services, `/readyz` still ok                                       | S      | preflight green              |
| B9  | Preflight's sitemap check is flaky (15s timeout → false FAIL)                                                         | A red gate that is wrong is worse than no gate            | ✅ **Fixed 2026-07-26 in #380** — `fetch()` retries once on an empty body. Shipped; the 10-clean-run metric is not yet measured                                                      | S      | 10 consecutive clean runs    |

### C — Post-launch experiments (validate first)

| #   | Bet                                                                                                 | Why it might work                                                      | Kill criterion                         |
| --- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------- |
| C1  | **Monthly receipt email** — "we handled 412 emails from 9 senders; 3 need you"                      | Turns a cleanup tool into a subscription with visible recurring output | <25% open by week 4                    |
| C2  | **Multi-account as the paid wedge** (not a Pro line item)                                           | Gemini is per-account by construction                                  | <15% of paid users connect a 2nd inbox |
| C3  | Autopilot rule **suggested from your own decisions** ("you archived 8 like this — make it a rule?") | Converts manual work into retention                                    | <10% acceptance                        |
| C4  | "Undo insurance" framing in the upgrade moment (30-day window as the Pro reason)                    | Sells the guarantee, not the feature                                   | no lift in upgrade rate                |

### D — Later

D247 brand grouping (partly landed) · Screener bulk-decide + quiet "Release now" halves · custom Autopilot rules (D234 currently rejects them) · real-time webhook triggering · Team tier · `subscription_events` monotonic arrival column · cancellation-provenance column.

### E — Do not build

| Item                                             | Why not                                                                                                                                           |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Summaries / reply drafting / "ask your inbox"    | Google shipped all three free on 8 Jan 2026, and every one requires reading bodies — the exact thing the product's credibility rests on refusing. |
| Priority / importance prediction                 | AI Inbox territory, using signals we cannot see. Also already banned (D222).                                                                      |
| More `/vs/[competitor]` pages                    | They argue against 2024's competitors. The competitor is a Gmail sidebar item.                                                                    |
| A replacement inbox / reader UI                  | "Gmail stays home" is correct — hold that line.                                                                                                   |
| Custom rule builder (D103's full form) at launch | Presets already cover the demonstrated need; the builder is the classic pre-PMF sink.                                                             |

---

## 6. Recommended production release

**One customer:** the overloaded personal Gmail owner with 20k+ messages.
**One promise:** _Clear thousands of emails by sender — preview every change, undo it for 30 days._
**Three bets, no more:** (1) sender-level bulk action with a real preview,
(2) rules you approve in Observe mode, (3) an auditable ledger + receipt.

### Ship

Senders · Triage · Autopilot presets (Observe→Active) · Activity + undo ·
Billing · the privacy/legal surface · the marketing site with a rewritten hero.

### Simplify

- Nav → 4 destinations (B5).
- `/senders` defaults to active senders (B2).
- Landing: payoff first, fine print second.

### Change (the commercial one)

The current ladder sells the ritual at $9 and the retention at $19. Invert it.

|                  | Now                                                  | Recommended                                                                                       |
| ---------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Free             | 5 actions **for life**, no Triage                    | **50 sender decisions/month**, Triage included, 1 inbox, 7-day undo                               |
| Plus $9          | unlimited actions + Triage                           | **removed**                                                                                       |
| Pro $19 / $190yr | + Autopilot, Brief, Screener, 2 inboxes, 30-day undo | **$9/mo · $90/yr** — everything above + Autopilot + Brief + receipt + **3 inboxes** + 30-day undo |

Three reasons:

1. **Five lifetime actions cannot create the "aha".** The aha is one decision
   moving 412 emails. A monthly quota lets a user feel it, run out, and come
   back — which is what an upgrade trigger _is_.
2. **Plus is a churn machine.** It sells the one-time cleanup and withholds
   every mechanism that makes month 2 worth paying for.
3. **$190/yr has no market.** Mailstrom anchors this category at $9/mo or
   ~$59.95/yr; Gmail's own version is free. $90/yr for automation + multi-account
   - a 30-day undo guarantee is defensible; $190/yr for the same is not.

Founding Pro at $129/yr should stay — but as a founding-supporter offer, not a
discount off a price no one will pay.

### Defer

D247 finish · Screener/quiet deferred halves · custom rules · Team tier ·
real-time webhooks · everything in D.

### Stop-building threshold

When §7 is all green and A1–A6 are closed, **launch**. Do not wait for D247,
the verify-d backlog, or the 80-odd open followups.

---

## 7. Launch checklist (go / no-go)

| Area        | Criterion                                                                       | Today                                  |
| ----------- | ------------------------------------------------------------------------------- | -------------------------------------- |
| Product     | A new mailbox reaches a first executed action in < 10 min with preview + undo   | ⬜ retest after A3                     |
| Product     | Free tier permits enough action to feel the payoff                              | ❌ 5 lifetime                          |
| UX          | 375 / 620 / 1280 clean on Senders, Triage, Activity, Billing                    | ✅ after this session's fix            |
| UX          | No surface asserts a number or state it cannot know                             | ⬜ 2 fixed; billing card (A6) open     |
| Security    | Gmail Pub/Sub unauth → 401; Resend unsigned → 401; billing webhooks fail closed | ✅ preflight                           |
| Security    | No service account with project-wide secret read                                | ⚠️ 2 warns — worker shares the API SA  |
| Privacy     | Storage list generated from the registry; PostHog consent-gated                 | ✅                                     |
| Privacy     | CASA Tier 2 assessment current (annual recertification)                         | ✅ approved 21 Apr 2026; recert Apr 27 |
| Performance | Senders first paint on a 7.9k-sender mailbox with no console errors             | ✅ verified locally                    |
| Reliability | `/readyz` uptime check + not-ready alert exist and page the founder             | ✅ 2026-07-26 — channel VERIFIED       |
| Reliability | Redis budget cannot suspend production                                          | ✅ 2026-07-26 — Upstash Fixed plan     |
| Reliability | `vendor-limits-watchdog` and `infra-snapshot` green                             | ✅ 2026-07-26 — all 9 vendors 🟢       |
| Billing     | One real purchase + one real refund, end to end                                 | ⬜ founder's hands                     |
| Billing     | `/billing` never shows two plans at once                                        | ❌ **A6**                              |
| Support     | Mail to `support@` / `privacy@` reaches a human                                 | ⬜ MX verified; human unverified       |
| Legal       | Privacy, terms, refunds, cookies live and mutually consistent                   | ✅                                     |
| Monitoring  | Sentry alert rules fire on a test error                                         | ⬜ founder                             |

---

## 8. Retention & measurement plan

Counts and ids only — never subjects, addresses, or message content. PostHog is
already gated on explicit consent, and that gate is verified fail-closed.

**Activation event (the one that matters):**
_first sender action executed successfully after a rendered preview, within 24 h
of the first sync completing._ Not signup. Not connect. Not "viewed senders."

| Layer                                 | Metric                                                     | Target                                               |
| ------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------- |
| Acquisition                           | landing → Google consent start                             | ≥ 8%                                                 |
| Onboarding                            | consent start → sync complete                              | ≥ 85%                                                |
| **Activation**                        | sync complete → first executed action (24 h)               | **≥ 40%**                                            |
| Depth                                 | senders decided in week 1                                  | median ≥ 15                                          |
| **Habit (leading renewal indicator)** | week-2 return **and** ≥ 1 action                           | ≥ 30%                                                |
| Automation                            | % of paid users with ≥ 1 Autopilot rule promoted to Active | ≥ 35%                                                |
| Value proof                           | emails handled per paying user per month                   | ≥ 300                                                |
| Conversion                            | free-quota exhausted → checkout started                    | ≥ 20%                                                |
| Churn signal                          | **undo rate per action type**                              | < 3% — a rising undo rate means the preview is lying |
| Failure                               | sync failure rate; action failure rate; dead-letter count  | < 1%                                                 |
| Failure                               | suggestions dismissed / suggestions shown                  | < 40%                                                |

Renewal leading indicators, in order of predictive value: (1) an Active
Autopilot rule, (2) a second connected inbox, (3) week-4 return with ≥ 1 action.
If none of the three is present by day 21, that subscription is already lost.

---

## 9. First 30 days after launch

**Recruit (target 50 activated users):** r/gmail, r/productivity,
r/digitalminimalism, Hacker News "Show HN", and the existing beta list. Screen
for one thing only: **an inbox over 20,000 messages.** Someone with 800 emails
is not the customer and their feedback will mislead.

**Collect:**

- The activation funnel above, per user, for the first 7 days.
- One question at day 3: _"What did you expect to happen that didn't?"_
- Every undo, with the action type. Undos are the highest-signal event in the
  product — each one is a preview that failed to communicate.
- Every dismissed Autopilot suggestion, with the rule.

**Run:**

1. Hero A/B — "Control Gmail by sender" vs "The safe way to bulk-clean Gmail."
2. Free quota 50/month vs 100/month → effect on activation _and_ conversion.
3. Receipt email on/off for cohort halves (C1).

**Evidence that justifies building more:**

- ≥ 40% activation and ≥ 30% week-2 return → build C2 (multi-account wedge).
- ≥ 35% of paid users promote a rule to Active → automation is the retention
  engine; invest in the rule surface (custom rules become worth building).
- < 20% activation → the problem is positioning, not features. Stop building and
  re-run §2 and §3.

---

## 10. Implementation plan (ordered, dependency-aware)

**Done in this session** (see the diff):

1. `packages/workers/src/initial-sync.worker.ts` — the rebuild transaction now
   deletes every **unexecuted** `rule_match_log` row (`pending`, plus `approved`
   that has not yet been applied) alongside the `senders` teardown. The approved
   half is the dangerous one: those rows are already queued for
   `AutopilotActionWorker` and would have mutated Gmail on deleted evidence.
   Dismissed rows (the user's decision) and executed rows (referenced by
   activity + undo) survive. + 1 spec, 34 passing.
2. `packages/workers/src/autopilot-action.worker.ts` — `loadEligibleMatches`
   excludes matches whose sender row postdates them. The pre-existing
   `skippedMissingSender` guard could not catch a _re-created_ row (it exists,
   it is just newer). Deliberately does not touch the null-sender case, which is
   the `building_sender_index` race that retries. `flipMatchApplied` now logs
   `autopilot.match_vanished_before_flip` when its UPDATE matches nothing —
   Gmail was already mutated, so that is an audit-linkage gap that must not pass
   silently. The stale-evidence race is then CLOSED at the claim: the worker
   already writes a durable `action_jobs` row (key `autopilot-<matchId>`) before
   mutating, so that write now happens inside a transaction holding the
   sender-index lock together with the currency re-check, and the rebuild's
   cleanup skips any match carrying a claim. Either the claim commits first and
   the rebuild respects it, or the rebuild commits first and the check fails
   BEFORE Gmail is touched. Unsubscribe — one-way, so the least recoverable —
   gets the same treatment inside its existing single transaction. One shared
   `MATCH_EVIDENCE_CURRENT` predicate drives both the load and the re-check.
   Exempting claimed rows from the cleanup needed a matching terminal path: when
   a rebuild has happened and the sender did not come back, the match is retired
   as a no-op and the claim flips to `failed`, so an exempted row cannot be
   retried forever — but ONLY when it provably never mutated Gmail
   (`status='queued'`, no resolved ids). A claim past that point may already
   have moved mail, so it completes instead, keeping its Activity row and undo
   token. That in-flight check runs FIRST in the per-match loop, above every
   start-gating guard (rule paused, Protect re-check, daily cap, missing
   sender) — each of those could otherwise strand or retire a mutation that had
   already run. The two SWEEP-level gates (entitlement downgrade, quiet window)
   likewise no longer return early: they record a reason and fall through to a
   completion-only pass, because a downgraded workspace never sweeps again. The
   in-flight flags for a sweep come from ONE batched (chunked) lookup, not a
   query per match — `loadEligibleMatches` is unbounded, so the per-match form
   was an N+1 in front of every sweep. - 10 specs, 33 passing.
3. `packages/workers/src/autopilot-apply.worker.ts` +
   `sender-index-lock.ts` (new) — the sweep fingerprints the sender index
   (`min(senders.created_at)`, which only a rebuild moves) before reading
   signals, then re-checks it and INSERTs inside ONE transaction holding a
   per-mailbox `pg_advisory_xact_lock` that the rebuild also takes. The
   comparison alone was check-then-act: the rebuild could commit between the
   check and the insert. The pass is abandoned with
   `autopilot.sweep_aborted_index_rebuilt` when the fingerprint moved. Without this the
   invalidation had a hole: a concurrent sweep re-inserts matches from a
   pre-rebuild snapshot, and because their `matched_at` is later than the fresh
   `created_at` they pass every downstream guard. `perMailboxPolicy` declares
   one job per mailbox but the consumer does not enforce it
   (`apps/api/src/worker.ts:805`), so this has to be correct at the DB layer.
   - 2 specs, 13 passing.
4. `apps/api/src/autopilot/autopilot.read-service.ts` —
   `SENDER_INDEXED_AT_MATCH_TIME` (`senders.created_at <= matched_at`) applied to
   the pending list, the observe digest's `pendingTotal`, `approveMatches`, and
   `approveAllForRule`. Guards mailboxes rebuilt _before_ the worker fix ships:
   a stale match can no longer be seen, counted, approved, **or resurrected when
   its sender is re-indexed**. + 2 specs, 46 passing.
5. `apps/web/src/features/autopilot/sender-label.ts` (new) + row / preview panel
   / approve-confirm modal — address fallback when the `From` header carried no
   display name; "still syncing" only when no identity exists. + 9 specs.
6. `apps/web/src/features/autopilot/rule-card.tsx` — "N actions" → "N matched".
7. `packages/shared/src/shell/app-shell.tsx` + `styles/tokens.css` — trust strip
   hidden below 600px instead of clipping mid-word.

**Next, in order:**

| Step | Change                                                                                           | Where                                                                                                    | Depends on                                     |
| ---- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| 1    | Run `setup-uptime-monitoring.sh`; prove the alert lands (**A1**)                                 | founder + GCP                                                                                            | —                                              |
| 2    | Upstash plan/budget (**A4**); rotate Razorpay repo secret, set `GCP_BILLING_ACCOUNT_ID` (**A5**) | founder                                                                                                  | —                                              |
| 3    | Remove `RATE_LIMIT_ENABLED=false` (**B8**)                                                       | `.github/workflows/deploy-cloud-run.yml`                                                                 | founder approval (prod manifest)               |
| 4    | Free-tier quota → 50/month + Triage in Free (**A3**)                                             | `packages/shared/src/entitlements/manifest.ts`, `entitlements.service.ts`, quota reset job, pricing copy | founder pricing decision                       |
| 5    | Collapse the ladder to Free + Pro $9 (§6)                                                        | manifest + Paddle/Razorpay catalog + `/pricing` + `/billing`                                             | step 4, and a catalog change in both providers |
| 6    | Billing card single state machine (**A6**)                                                       | `apps/web/src/features/billing/**`                                                                       | `redesign` label                               |
| 7    | Partial unique index on live subscriptions (**B7**)                                              | `packages/db/migrations`                                                                                 | schema-migration-reviewer                      |
| 8    | `/senders` defaults to active (**B2**)                                                           | `apps/web/src/features/senders/**`                                                                       | —                                              |
| 9    | Nav → 4 destinations (**B5**)                                                                    | `packages/shared/src/shell/sidebar.tsx`                                                                  | `redesign` label                               |
| 10   | Hero rewrite + "what Gmail's AI won't do" (**B1**)                                               | `apps/web/src/features/marketing/**`                                                                     | §2 sign-off                                    |
| 11   | Brief first-run generation (**B6**)                                                              | `packages/workers/src/brief-snapshot.worker.ts`                                                          | —                                              |
| 12   | Preflight sitemap retry (**B9**)                                                                 | `scripts/launch-preflight.sh`                                                                            | —                                              |

Steps 4, 5, 9 and 10 are founder decisions, not engineering ones. Everything
else can be executed without further input.

---

## Appendix — what was probed

- Full local stack (`dev-up.sh`) against the founder's real mailbox: 121,070
  messages, 8,285 sender rows; active mailbox 7,892 senders.
- Browser walk at 375 / 620 / 1280 px: landing, `/senders`, `/triage` (paywall),
  `/brief`, `/autopilot`, `/billing`.
- Tier flipped free→pro→free by SQL to exercise gated surfaces; **restored**.
- `psql` cross-checks: entitlement tiers, subscription rows and constraints,
  `rule_match_log` vs `senders` divergence — 867 blank display names, and of
  6,244 pending matches 32 orphaned + 5,978 whose sender row was re-created by
  the 2026-07-24 rebuild, leaving 234 current.
- Live production: `/api/healthz`, `/api/readyz`, apex, sitemap.
- `./scripts/launch-preflight.sh` (all groups): 46 pass / 2 real fail / 2 warn.
  The third reported failure did not reproduce — a 15 s fetch timeout (**B9**).
- Test suites after the changes: api 1,199 ✅ (12 skipped, 89 files), web 998 ✅,
  shared 327 ✅, `pnpm typecheck` ✅, prettier ✅.
- No Gmail-mutating action was executed at any point.
