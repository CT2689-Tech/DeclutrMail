# Packaging decision — Autopilot becomes a behaviour, not a tier

**Date:** 2026-08-02 · **Status:** design approved by founder, not yet implemented
**Supersedes:** the D251 portion of `repositioning-copy-spec-2026-08-01.md` (which scoped
D251 as "Screener moves to Plus" only)
**Decides:** D251 (expanded) · new capability split on Autopilot

---

## The decision in one paragraph

Plus today grants nothing Free doesn't — it only lifts a usage cap, so a customer who
finishes their cleanup has no reason to renew. Rather than move whole features down a
tier (irreversible) or leave Plus thin (churns), **Autopilot splits along what it does
rather than whether you have it**: both paid tiers get rules that _find_ matching mail;
Pro is where the rules also _act_ on it. Prices, checkout products and inbox limits are
untouched.

## What each tier is for

|                            |                                          |
| -------------------------- | ---------------------------------------- |
| **Free — $0**              | See what's noisy, fix some of it by hand |
| **Plus — $9/mo · $90/yr**  | Rules find it, you approve it            |
| **Pro — $19/mo · $190/yr** | It just runs                             |

The same promise at three lengths, which is also the landing headline: at Plus you
approve every batch; at Pro you approved the rule once.

---

## Full feature map

### Seeing your mail

| Feature       | What it is                                              | Free | Plus | Pro |
| ------------- | ------------------------------------------------------- | :--: | :--: | :-: |
| Sender list   | Everyone who mails you, ranked by volume and engagement |  ✅  |  ✅  | ✅  |
| Sender detail | One sender's history, volume trend, engagement signals  |  ✅  |  ✅  | ✅  |

### Acting on mail

| Feature                       | What it is                                                | Free | Plus | Pro |
| ----------------------------- | --------------------------------------------------------- | :--: | :--: | :-: |
| The five actions              | Keep · Archive · Unsubscribe · Later · Delete, per sender |  ✅  |  ✅  | ✅  |
| Preview before anything moves | Exact count, sample, precise Gmail changes — every time   |  ✅  |  ✅  | ✅  |
| Triage                        | Focused queue, one sender at a time, keyboard shortcuts   |  ✅  |  ✅  | ✅  |
| Bulk by hand                  | Pick many senders at once, up to 1,000 per action         |  ✅  |  ✅  | ✅  |
| Bulk by filter                | Act on everyone matching a rule without hand-picking      |  ❌  |  ❌  | ✅  |
| Later queue                   | Park a sender's mail; it returns at a time you choose     |  ✅  |  ✅  | ✅  |

### Automation

| Feature                            | What it is                                                                                                                                                                                                                                                              | Free |     Plus     | Pro |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--: | :----------: | :-: |
| **Screener**                       | New senders collected for review. They still arrive in Gmail — this is where you decide in a batch                                                                                                                                                                      |  ❌  | ✅ **moves** | ✅  |
| **Autopilot — finds, you approve** | Rules gather matching mail; you approve each batch before anything moves                                                                                                                                                                                                |  ❌  | ✅ **moves** | ✅  |
| **Autopilot — runs on its own**    | Approve the rule once; it acts on future mail without asking                                                                                                                                                                                                            |  ❌  |      ❌      | ✅  |
| Quiet hours                        | A window where automatic actions hold off and run after. Manual actions are never deferred. **Open design question:** an approved Plus batch enqueues the same worker sweep that defers on quiet state, so "Pro-only" may need a check before this becomes pricing copy |  ❌  |      ❌      | ✅  |

### Knowing what happened

| Feature            | What it is                                                                                                                                           | Free |    Plus    | Pro |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | :--: | :--------: | :-: |
| Activity ledger    | Every action taken, what it affected, undo where reversible                                                                                          |  ✅  |     ✅     | ✅  |
| **Weekly receipt** | What rules found, what you approved, how many senders wait in the Screener. In-app card at launch; the email is opt-in and default-off (amends D189) |  ❌  | ✅ **new** | ✅  |
| Daily Brief        | Written digest of what's arriving now — reply / FYI / noise                                                                                          |  ❌  |     ❌     | ✅  |
| Follow-ups         | Mail **you sent** that nobody replied to, grouped by age, mark-as-resolved                                                                           |  ❌  |     ❌     | ✅  |

### Safety

| Feature                | What it is                                                                               |  Free  |  Plus  |   Pro   |
| ---------------------- | ---------------------------------------------------------------------------------------- | :----: | :----: | :-----: |
| Undo from Activity     | Put back Archive, Later, Delete                                                          | 7 days | 7 days | 30 days |
| Gmail Trash fallback   | Delete also lands in Trash — normally ~30 days, separate, ends early if Trash is emptied |   ✅   |   ✅   |   ✅    |
| Protected senders      | Excluded from bulk and automatic actions entirely                                        |   ✅   |   ✅   |   ✅    |
| Unsubscribe is one-way | A delivered request cannot be recalled; the preview is the point of no return            |   ✅   |   ✅   |   ✅    |

### Limits, privacy, price

|                              | Free                                                                      | Plus          | Pro                                                               |
| ---------------------------- | ------------------------------------------------------------------------- | ------------- | ----------------------------------------------------------------- |
| Senders actionable           | 50/month                                                                  | Unlimited     | Unlimited                                                         |
| Connected Gmail accounts     | 1                                                                         | 1             | 3                                                                 |
| Bulk cap per action          | 1,000 senders                                                             | 1,000         | 1,000                                                             |
| Bodies/attachments fetched   | Never                                                                     | Never         | Never                                                             |
| Gmail data sent to Anthropic | Recommendation explanations — sender identity, domain, engagement signals | Same as Free  | Same, **plus** the Daily Brief — sender, subject, Gmail's snippet |
| Price USD                    | $0                                                                        | $9 · $90/yr   | $19 · $190/yr                                                     |
| Price INR                    | ₹0                                                                        | ₹749 · ₹7,499 | ₹1,599 · ₹15,999                                                  |
| Founding Pro                 | —                                                                         | —             | $129/yr, first 250, locked while active                           |

> **Corrected 2026-08-02 after review.** An earlier draft of this table read
> `Data sent outside DeclutrMail | None | None | Daily Brief only`. **That was false on every
> tier and must never reach public copy.** The D24 recommendation-explanation path sends sender
> identity, domain and engagement signals to Anthropic regardless of tier — `worker.ts` wires the
> Anthropic adapter whenever `ANTHROPIC_API_KEY` is set, `deploy-cloud-run.yml` mounts that secret
> on both the API and the worker in production, and neither the scoring worker nor the triage
> service consults `hasCapability`. The repo's own locked string says so:
> `RECOMMENDATION_AI_DISCLOSURE` in `packages/shared/src/copy/action-safety.ts`.
>
> The row is also scoped to **Gmail data** deliberately. Telemetry (Sentry, PostHog), transactional
> email (Resend) and billing (Paddle, Razorpay) are separate processors covered by the privacy
> policy; collapsing them into a single "none" was the compressed-generated-claim failure ADR-0030
> exists to prevent. Any public version of this row must render from the registry, not from prose.

---

## What actually moves from today

|                                | Today                                 | Proposed                                                           |
| ------------------------------ | ------------------------------------- | ------------------------------------------------------------------ |
| Screener                       | Pro                                   | **Plus**                                                           |
| Autopilot — finds, you approve | Pro                                   | **Plus**                                                           |
| Weekly receipt                 | Specified Pro-only and unbuilt (D189) | **Plus and Pro** — in-app card at launch, email opt-in default-off |

Autopilot-that-acts-alone, Brief, Quiet hours, Follow-ups, bulk-by-filter, 3 inboxes and
the 30-day undo window all stay at Pro. **Nothing leaves Pro that anyone is paying for**
— there are no customers, but the principle holds for the design.

## Why "Plus gets everything, Pro gets inboxes" was rejected

`hasCapability` is a pure function of the tier enum and there is **no grandfathering or
per-workspace capability-override machinery anywhere in the repo** (verified by grep;
`founding_member` locks a price, never a capability set). So moving a capability _down_
later is a one-line edit customers read as a gift, while moving one _up_ later silently
stops paying customers' rules at the next worker tick, past the refund window.

At zero customers, take the option that preserves the direction you can still travel.
The founder ratified this same principle on 2026-07-26
(`a3-pricing-rework-plan.md:59-61`).

Secondary: the stated persona is a _personal_ Gmail owner with one mailbox, so fencing
Pro on inbox count draws a wall around an empty room.

---

## What gets built

| #   | Work                                                                                                                        | Size                                                                                                                                                                                                                                                                                                                  |
| --- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Add a second capability** — `autopilot` (observe + approve) to Plus, new `autopilot-active` (acts unattended) to Pro only | Bigger than first written. Splitting the route guard alone is **unsafe**: `autopilot-action.worker.ts:452` gates unattended execution on `autopilot`, so granting Plus that capability lets Plus rules act unattended, and `PATCH rules/:id` has no tier check on the mode value. See the CORRECTION block under D251 |
| 2   | Move `screener` into `PLUS_CAPABILITIES`                                                                                    | One line                                                                                                                                                                                                                                                                                                              |
| 3   | Weekly receipt email — **must be reconciled with D189 first, see below**                                                    | The only real build. Derived from the Activity ledger + Screener counts at send time. No new **Gmail** fields and no new AI processor — but it does need a new notification preference, and delivery is a third-party call to Resend                                                                                  |
| 4   | Fix the free-tier dead end                                                                                                  | `confirm-action-modal.tsx:456,460` folds `quotaShort` into `confirmDisabled`, so a free user's 400-sender bulk with 50 remaining moves **zero** messages. Act on the first 50; the preview must say so before it runs                                                                                                 |

The mechanism behind #1 already exists and is tested: `autopilot-apply.worker` records
`observeMatches` with `modeAtMatch: 'observe'`, and `POST /api/autopilot/matches/approve`
("Approve selected", idempotent) flips matches to approved and enqueues the action sweep.

### Two prior decisions this collides with — found in review, both real

**D77 — "Screener is Pro-only; Free/Plus get basic deferred-decision queue"** (🔵 shipped via
#206, #220). D251 moves Screener to Plus, which directly overrides D77, and the first draft of
this work named D194/D226/D230/D19 in its "does not amend" list while silently skipping the one
decision it actually reverses. That asymmetry is the tell. **D251 now carries an explicit
`[REVERSAL 2026-08-02 on D77]` marker in the plan mirror**, so `rg "on D77"` finds it — the
patch-awareness contract in CLAUDE.md §3.

Note D77 also grants Free/Plus a _basic deferred-decision queue_ (the `S` key as "decide later",
no auto-routing, no badge, no recommendations). D251 gives Plus the **full** Screener. Free keeps
whatever D77's basic queue resolves to today — that is unchanged and must not be silently dropped.

**D189 — "Weekly Value Receipt"** (⬜ unbuilt). It already specifies a weekly receipt, and its
terms differ from mine on every axis that matters:

|               | D189 (existing)                                   | D251 first draft      |
| ------------- | ------------------------------------------------- | --------------------- |
| Tier          | **Pro-only**                                      | Plus and Pro          |
| Delivery      | In-app card pinned to Triage + **optional** email | Email                 |
| Email default | **Off**                                           | Unstated — implied on |
| Cadence       | Sundays 6pm user-local                            | "Weekly"              |

Shipping both would put two live D-decisions in the plan specifying the same artifact at
different tiers with opposite consent defaults. **D251's receipt is therefore recorded as an
amendment to D189, not a new artifact**, and it inherits D189's email-default-off unless the
founder decides otherwise. That decision is open.

**And it is a commercial email.** Recurring value receipts are re-engagement, not transactional,
so the receipt inherits the postal-address gate that currently blocks `sync-reminder-24h`
(CAN-SPAM / CASL, open founder follow-up). **The in-app card can ship in the launch release; the
email cannot until a postal address exists.** The first draft scheduled the email for launch week
without noticing.

### Copy

One feature name everywhere. Plus reads _"Autopilot — finds matching mail, you approve
each batch."_ Pro reads _"Autopilot — runs on its own."_ The upgrade sells itself.

### Not doing

No price changes. No new checkout products. No trial with an expiry cliff. Brief stays
Pro. No fourth tier.

---

## Verify before shipping

Rule-matching now runs for Plus workspaces, not only Pro. That is DeclutrMail's own
compute with no outside API involved, but it is per-user background work and it has not
been measured. Check the load before launch rather than assuming it.

## Measurement

Of Plus workspaces at day 21+ (past the initial backlog), the share that approved at
least one Autopilot batch or dispositioned at least one Screener sender in the trailing
7 days. **Under 40% at day 60 means this call was wrong**, and the remedy is pre-decided
and cheap: move `active` mode down to Plus. One line, safe direction, announces as
generosity.

**Guard:** if the paid-Plus denominator is under ~20 workspaces, the rate is not
readable — instrument the denominator and refuse to render below the floor. A rate over
a near-empty cohort is the blind-guard failure this codebase keeps shipping.

## Launch decisions (founder, 2026-08-02)

- **All four items above ship in the launch release**, including the free-tier dead-end
  fix (#4) and the weekly receipt (#3).
- **Pricing page defaults to annual.** `pricing-screen.tsx:48` — both annual price points
  already exist in both providers.
- **Founding Pro is the launch headline offer**, not a badge. $129/yr against $190 list,
  and $39/yr more than Plus annual for the whole hands-off automation set. Cap stays at
  250; no "X left" counter unless it reads the real redemption count.

## The headline (decided 2026-08-02)

> **Clear thousands of emails by sender — and see exactly what moves.**

Subhead: _One decision per sender clears thousands of emails at once — you see the count
and the exact Gmail changes first. On Plus, rules find the matches for you; you still
approve every batch._

Both the 13-agent panel and Codex's independent pass reached the same objection to the
earlier `Nothing moves until you approve it` line: it removes fear but creates no want.
The shipped line leads with the outcome and answers the fear second.

**The constraint that eliminated the alternatives:** the landing CTA signs a visitor up
for **Free**, so the H1 must be true at Free. That kills every "rules find it for you"
variant — true only from Plus — which is why that claim sits in the subhead with its tier
named. It also avoids any _timing_ claim, so Autopilot running on its own can never
falsify it.

## Still open

Nothing. Ready to build.
