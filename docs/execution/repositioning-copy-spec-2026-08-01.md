# Repositioning content and packaging spec — product-wide

**Date:** 2026-08-01 · **Status:** proposed, nothing applied
**Decides:** D250 (headline, reverses D223) · D251 (Screener Pro → Plus, founder-approved)
**Also proposes:** downstream homepage, pricing, comparison, activation, retention, proof, research,
and measurement changes; §19 is the consolidated action register.
**Basis:** 13-agent panel (5 expert lenses, 3 cold personas, 4 adversarial refutations, 1 synthesis)
run 2026-08-01, plus direct verification of every claim against the repo.

> **Purpose of this file.** A complete, self-contained record of the acquisition, pricing,
> comparison, activation, retention, and packaging changes recommended by this repositioning pass.
> Quoted "before" copy was read from the cited source; long conditional or manifest-derived
> surfaces are summarized and point back to their source instead of being reconstructed from
> memory.

---

## DECISIONS LOCKED 2026-08-02 — read this before anything below

Sections 8–20 were written on 2026-08-01, **before** the packaging changed. Where this block
conflicts with any section below, **this block wins.** The companion decision record is
`docs/execution/packaging-2026-08-02.md`.

### The hero, final

|                   |                                                                                                                                                                                           |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Kicker**        | For inboxes you gave up on                                                                                                                                                                |
| **H1**            | **Clear thousands of emails by sender — and see exactly what moves.**                                                                                                                     |
| **Subhead**       | One decision per sender clears thousands of emails at once — you see the count and the exact Gmail changes first. On Plus, rules find the matches for you; you still approve every batch. |
| **Under the CTA** | Free · no card · 7-day undo on Archive, Later and Delete                                                                                                                                  |

Resolves **DEC-01** — the benefit-led challenger ships; the D250 control does not. §8's
`without a blind bulk move` is replaced by `and see exactly what moves`: same job, no timing
claim, plain product vocabulary. §2's `Control Gmail by sender. Nothing moves until you approve
it.` is decision history, not the shipped line.

The H1 must remain true for a **Free** user, because the landing CTA signs a visitor up for Free.
That test is what eliminated every "rules find it for you" variant from the H1 — that claim is
true only from Plus, so it lives in the subhead with its tier named.

#### The kicker carries no privacy claim at all

The kicker's job is recognition, not proof. `For inboxes you gave up on` is the buyer's own
language — the persona is defined as someone who has abandoned inbox-zero at least once — and it
asserts nothing about the product, so there is nothing in it that can be wrong or need explaining
to a cold reader.

**Privacy moves down to the trust strip, where it already lives in better form.** The locked
`PrivacyBadge` carries `Full bodies fetched: 0`, the plain-language lead (_"We never fetch or store
message bodies. This list is generated from the Gmail fields DeclutrMail actually stores"_), and
both generated lists. That is more honest and more complete than any four-word paraphrase above the
fold. Per the copywriting hierarchy, an objection is answered after desire is created, not before
it — and privacy is an objection.

Three drafts of this kicker failed the same way: compressing a precise generated claim into four
words produced either jargon or a small untruth. **Do not reintroduce a privacy claim into the
kicker.** If the wedge needs to sit higher on the page, move the badge, do not paraphrase it.

#### Plain-language sweep — the "needs a clause to be understood" test

A term that requires an explainer clause every time it is used is the wrong term. Applying that
test past the kicker found one shipping defect and one parked question.

| Surface                                | Before                                  | After                                                     | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------- | --------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pricing-teaser.tsx`, Free tier bullet | `Full sender ledger + activity journal` | `Every sender listed, and a record of everything you did` | **Ships with this copy set.** Two accounting words on the tier a cold visitor reads first                                                                                                                                                                                                                                                                                                                                                                                     |
| Feature name `Screener`                | —                                       | —                                                         | **Parked, post-launch.** In your own pricing copy it reads "Screener — new senders collected for review": the clause carries the meaning, the name carries none. It also has no verb form, because "screen" is banned in UI copy (D227), so nobody learns it by using it. Renaming touches routes, components, tests, docs and D194; not worth doing in launch week, but it is now the name of the thing Plus buys, so revisit once signups show whether people understand it |
| Feature name `Triage`                  | —                                       | —                                                         | **Keep.** Borderline medical term, but common in productivity tools and it conveys rapid sorting                                                                                                                                                                                                                                                                                                                                                                              |

#### Onboarding, signup and analytics pass (2026-08-02)

Applied `onboarding`, `signup` and `analytics` from the marketing-skills set against the live flow.

**Analytics is in better shape than assumed.** The funnel already emits `page_viewed`,
`landing_cta_clicked`, `onboarding_step_viewed` / `onboarding_step_completed` (with a `step`
property covering promise → connect → sync gate → preset pick → first triage → finished),
`activation_goal_selected`, `first_relief_session_started` / `_completed`, and the revenue chain
(`checkout_started`, `plan_change_started`, `payment_succeeded` / `_failed`). Against the standard
self-serve event library the coverage is essentially complete. **DATA-01 is therefore a
verification task, not a build task** — confirm the chain fires end to end under consent gating,
do not design new events.

**Declare the activation metric.** `first_relief_session_completed` already exists and is the
correct definition of activation for this product. Nothing currently reports it. Name it as the
activation metric before launch so the launch produces a readable number.

**The aha moment is blocked, and this is the highest-value fix on the list.** The onboarding
framework defines activation as the first time a user _does_ the valuable thing. Here that is
watching hundreds of messages leave the inbox from one decision. `confirm-action-modal.tsx:456,460`
folds `quotaShort` into `confirmDisabled`, so a free user's first realistic bulk attempt executes
**zero** messages. Independent confirmation of the fix already scheduled for this release.

**Time-to-value is dominated by sync, and is unmeasured.** Nothing can be triaged until
`is_ready_for_triage`. On a large mailbox that delay may exceed the first session, which would
put the aha moment after the user has left. Measure sync-to-ready duration at the p50 and p90
before launch; if it is long, the fix is partial readiness, not copy.

**Signup trust sequencing is already correct** — step 1 shows the privacy boundary _before_ the
Google consent screen, and step 2 itemises access, what is fetched, what is stored, and what
requires approval. No change recommended.

**One consequence of the packaging change to catch.** `onboarding/page.tsx:262` branches the
preset-pick step on `hasCapability(me.tier, 'autopilot')`. Moving Autopilot's review mode to Plus
flips that branch for Plus workspaces, so `StepPresetPick` copy must not imply rules act on their
own. Fold into TIER-02.

#### `metadata only` is retired everywhere — it was inaccurate, not just unclear

The term appears in §2, §3.2 row 7, §6 and §14 of this document. **Do not implement any of them.**
Two independent problems:

1. **It overclaims the boundary.** `gmail-data-inventory.ts:139-141` records the Gmail preview
   snippet as fetched from `message.snippet` and stored at `mail_messages.snippet`. A snippet is
   message _content_, however short — metadata is data _about_ a message. Compressing the storage
   list into "metadata only" makes the one claim the brand rests on quietly untrue.
2. **It needs its own explainer.** The site already has
   `/answers/what-is-metadata-only-email-analysis`. A term that requires a dedicated page is not a
   term for a hero kicker.

`never the full message` is plain, is accurate against the registry, and the word _full_ concedes
the snippet rather than papering over it — which is the honest form of the claim and the one that
survives a reader who opens the storage list. The locked `Full bodies fetched: 0` badge and its
generated field inventory continue to carry the precise version in the trust strip; the kicker
must never be a lossy paraphrase of them. §14's caveat ("never let `metadata only` stand alone")
correctly identified the risk but kept the term; retiring it resolves the risk at the source.

Banned in this copy set, per T5 and CLAUDE.md §2.1: `metadata only`, `never reads your email`, and
any other forward-looking absolute about what is or is not read.

### D251 is larger than §§8–20 assume

Those sections scope D251 to `screener` alone. The founder expanded it on 2026-08-02:

|                                                   | Today          | Shipping |
| ------------------------------------------------- | -------------- | -------- |
| Screener                                          | Pro            | **Plus** |
| Autopilot — finds matches, you approve each batch | Pro            | **Plus** |
| Autopilot — runs on its own                       | Pro            | Pro      |
| Weekly receipt email                              | does not exist | **Plus** |

Autopilot splits on **what it does**, not on whether you have it. Mechanism already exists and is
tested (`autopilot-apply.worker` records `observeMatches`; `POST /api/autopilot/matches/approve`
is idempotent). The work is splitting the class-level `@RequiresCapability('autopilot')` at
`autopilot.controller.ts:70` so Plus gets the read/approve routes and only the transition to
`active` stays Pro.

**TIER-01 through TIER-04 are therefore under-scoped as written** — every Screener gate, upsell
surface, badge, test and story listed there has an Autopilot equivalent that also changes.

### Also locked

- **Also shipping in the launch release:** the free-tier dead end (`confirm-action-modal.tsx:456,460`
  — a free user's over-quota bulk currently moves **zero** messages; act on the first 50 and say so
  in the preview), the weekly receipt, and the pricing page defaulting to annual
  (`pricing-screen.tsx:48`).
- **Founding Pro is the launch headline offer**, not a badge. $129/yr, cap stays 250, no
  "X left" counter unless it reads the real redemption count.
- **RESEARCH-01 moves from P0 to post-launch.** It requires 15 customer interviews and there are
  zero customers; it cannot gate the launch it depends on.
- **Scope for launch is the P0 set** (29 items, minus RESEARCH-01). P1 and P2 wait for real
  customers.
- Everything §8 flagged on the Autopilot approval seam is now resolved by the product rather than
  by hedged copy: Plus approves every batch, Pro is explicitly where you delegate approving.

---

## 0. What is being decided, and what is not

|                  |                                                                                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Changing**     | Public positioning and the acquisition, pricing, comparison, activation, and retention copy that inherits it; the Screener's tier                        |
| **Not changing** | The product mechanic. Sender-level decisions with a mandatory scope preview and an Activity undo window is exactly what the product does today and after |
| **Not changing** | Prices, refund window, privacy posture, legal pages, and keyword-bearing SEO/AEO titles and URLs                                                         |

### Why the incumbent headline moves

`docs/execution/product-launch-audit-2026-07-25.md:110`, the founder's own commissioned audit:

| DeclutrMail capability                | Gmail status                                      | Verdict                                        |
| ------------------------------------- | ------------------------------------------------- | ---------------------------------------------- |
| Sender list ranked by volume          | **Shipped** (Manage subscriptions, GA 8 Jul 2025) | **Dead differentiator.** Stop leading with it. |
| **Scope preview before the mutation** | **Not offered**                                   | **Durable.**                                   |

The incumbent headline names the row Gmail shipped. The replacement names the row it did not.

### What the panel found about the incumbent

The founder's stated preference — that `Control Gmail by sender, not by email.` is the most
understandable line — **was upheld on evidence, not overruled**. All three cold personas scored it
clarity 9/10, the only unanimous top score in the exercise, and the archetype persona (90k messages,
non-technical) chose it as the line they would click.

The same personas also rejected it as a reason to act: _"That's literally how Clean Email worked… I
just don't know why I'd switch"_ and _"Clear sentence, zero reason to click."_ Comprehension and
conversion separated cleanly. The clause therefore survives **verbatim as beat one**, and a second
beat carries the differentiation.

---

## 1. Truth constraints — check every proposed string against these

Any copy that violates one of these is disqualified regardless of how well it tests. Each is backed
by a file in the repo, not by judgement.

| #   | Constraint                                                                                                                                                                                              | Source                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| T1  | Manual Archive / Later / Delete apply to **matching inbox messages at the moment they run**. They do **not** create future-mail rules.                                                                  | `packages/shared/src/copy/action-safety.ts` → `MANUAL_ACTION_SCOPE_CLAIM`                  |
| T2  | **A delivered unsubscribe request cannot be recalled.** Blanket phrases like "every action is reversible" are false.                                                                                    | `action-safety.ts` header comment + `ACTION_SAFETY_SUMMARY`                                |
| T3  | Screener is **soft quarantine** — new senders still arrive in the Gmail inbox; Screener collects them for review. Never claim it blocks or prevents arrival.                                            | D194 forbidden framings; D72                                                               |
| T4  | Future-mail automation is **Autopilot, Pro-only**. Free and Plus are existing-mail-only.                                                                                                                | `pricing.config.ts` `PRO_CAPABILITIES`; hero demo card already states "Existing mail only" |
| T5  | Privacy copy is the locked badge string **"Full bodies fetched: 0"**. Never "never reads your email" or any forward-looking absolute.                                                                   | CLAUDE.md §2.1; `packages/shared/src/copy/privacy.ts`                                      |
| T6  | D209 forbidden words include **`clean` as a verb on user data**, plus: AI magic, supercharged, nuke, destroy, blast, obliterate, `smart` standalone, `intelligent` standalone, `AI-powered` standalone. | D209; ADR-0011                                                                             |
| T7  | Delete's Gmail Trash fallback is a **separate** recovery, normally up to 30 days, and can end sooner if Trash is emptied. Do not merge it with the Activity undo window.                                | `DELETE_RECOVERY_CLAIM`                                                                    |

### Enforcement gap worth knowing

`action-safety.test.ts:18` asserts only that **`ACTION_SAFETY_SUMMARY`** does not match
`/every action (?:is )?(?:reversible|undoable)/i`. It does **not** scan marketing copy. So a false
reversibility claim in `hero.tsx` would pass CI silently. T2 is a real product truth with no
automated guard on the surface where it matters most.

---

## 2. The hero

```
kicker    Gmail cleanup · metadata only

H1        Control Gmail by sender. Nothing moves until you approve it.

subhead   One decision per sender clears thousands of emails at once. You see the
          matching count and the exact Gmail changes first — and manual Archive,
          Later and Delete stay undoable from Activity for 7 days, 30 on Pro.

CTA       Connect your Gmail  ·  Try the demo first
note      Free · no card · 7-day undo on Archive, Later and Delete
```

### Why this line and not a shorter one

- **"Nothing moves until you approve it"** is phrased around **mail moving**, not around
  reversing or previewing. That is what makes it survive T1–T4 where every higher-ranked candidate
  failed. Keep and Unsubscribe move no mail, so the claim is vacuously true for them rather than
  false. Archive / Later / Delete are behind the D226 mandatory preview, so it is literally true.
- **The verb must stay `approve`.** It spans both the per-action confirm and the per-rule Autopilot
  approval. Do not soften it to "you see every change before it happens" — that version has a real
  Pro-tier hole (see §6).

---

## 3. Change table

Class key: **MUST** = carries the retired string · **FRAME** = inherits the retired framing ·
**TIER** = required by D251 · **NEW** = content that does not exist yet · **KEEP** = no change.

### 3.1 The headline string — 6 sites

| #   | File:line                                                      | Before                                                    | After                                                                           | Class |
| --- | -------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------- | ----- |
| 1   | `apps/web/src/features/marketing/landing/hero.tsx:25`          | `Control Gmail by <em>sender</em>, not by email.`         | `Control Gmail by <em>sender</em>. Nothing moves until you approve it.`         | MUST  |
| 2   | `apps/web/src/app/(marketing)/page.tsx:32`                     | `DeclutrMail — Control Gmail by sender, not by email.`    | `Preview Gmail cleanup by sender — DeclutrMail`                                 | MUST  |
| 3   | `apps/web/src/app/opengraph-image.tsx:85-88`                   | `Control Gmail by` / `<teal>sender</teal>, not by email.` | `Control Gmail by <teal>sender</teal>.` / `Nothing moves until you approve it.` | MUST  |
| 4   | `apps/web/src/app/opengraph-image.tsx:11` (`alt`)              | `DeclutrMail — Control Gmail by sender, not by email.`    | `DeclutrMail — Control Gmail by sender. Nothing moves until you approve it.`    | MUST  |
| 5   | `apps/web/src/features/marketing/page-metadata.ts:22` (OG alt) | `DeclutrMail — Control Gmail by sender, not by email.`    | same as row 4                                                                   | MUST  |
| 6   | `apps/web/src/features/onboarding/step-promise.tsx:26`         | `Control Gmail by sender, not by email.`                  | `Control Gmail by sender. Nothing moves until you approve it.`                  | MUST  |

**Metadata title must decouple from the H1.** The H1 is 60 characters, which overruns the ~580px
SERP budget. `apps/web/src/app/(marketing)/page.test.tsx:104` currently asserts the H1 string
appears in `metadata.title`; that assertion changes to the new, shorter title rather than being
deleted.

Tests asserting the old string: `page.test.tsx:31`, `page.test.tsx:104`,
`onboarding/page.test.tsx:160`.

### 3.2 Hero supporting copy — `hero.tsx`

| #   | Line     | Before                                                                                                                                                                                | After                                                                                                                                                                                                                | Class                           |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| 7   | `:22`    | `Gmail cleanup · **sender-first**`                                                                                                                                                    | `Gmail cleanup · **metadata only**`                                                                                                                                                                                  | FRAME                           |
| 8   | `:28-31` | `DeclutrMail turns thousands of emails into a handful of sender decisions — with automation, privacy-first indexing, and 7-day Activity Undo for Archive, Later, and Delete on Free.` | `One decision per sender clears thousands of emails at once. You see the matching count and the exact Gmail changes first — and manual Archive, Later and Delete stay undoable from Activity for 7 days, 30 on Pro.` | **MUST — fixes a live falsity** |
| 9   | `:54`    | `Free tier · no card · preview before mail moves`                                                                                                                                     | `Free · no card · 7-day undo on Archive, Later and Delete`                                                                                                                                                           | FRAME                           |
| 10  | `:60`    | `one Archive decision · 412 emails handled · reversible`                                                                                                                              | `one Archive decision · 412 emails · undoable for 7 days`                                                                                                                                                            | FRAME                           |

**Row 8 is a bug fix, not a preference.** The shipped subhead promises **"with automation"** on a
hero whose CTA is the free connect. Autopilot is Pro-only (T4), and `MANUAL_ACTION_SCOPE_CLAIM`
states _"These actions do not create future-mail rules."_ This is false on the live site today.
`privacy-first indexing` is also jargon; the kicker now carries `metadata only` instead — a
mechanism description rather than a forward-looking absolute, so it does not repeat the T2 mistake.

**Row 10** replaces the bare word `reversible` with the scoped, verb-correct claim. Archive is
undoable, so the caption is true for the action it depicts.

### 3.3 Landing body — `features/marketing/landing/sections.tsx`

| #   | Line       | Before                                                                                                                                                                                       | After                                                                                                                                                                                                                                   | Class             |
| --- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| 11  | `:17`      | `The cleanup is N decisions. We shrink N.`                                                                                                                                                   | `Thousands of emails. A few hundred senders.`                                                                                                                                                                                           | FRAME             |
| 12  | `:29`      | `Cleaning it email-by-email`                                                                                                                                                                 | `Handled email by email`                                                                                                                                                                                                                | FRAME — clears T6 |
| 13  | `:36`      | `Cleaning it by sender`                                                                                                                                                                      | `Handled sender by sender`                                                                                                                                                                                                              | FRAME — clears T6 |
| 14  | `:74`      | `On Pro, Autopilot applies preset rules you explicitly enable to future matches. Manual decisions stay in the activity ledger, with undo for label-changing actions.`                        | `On Plus, new senders are collected in the Screener for review. On Pro, Autopilot applies preset rules you explicitly enable to future matches. Every decision lands in the activity ledger, with undo where the action is reversible.` | TIER              |
| 15  | `:100`     | `Five verbs. One per sender.`                                                                                                                                                                | `Five verbs. See the scope before manual moves.`                                                                                                                                                                                        | FRAME             |
| 16  | `:171-175` | `Free is the full manual cleanup workflow with a monthly meter. Plus removes the meter. Pro adds preset automation for recurring matches. The same Activity record ties all three together.` | `Free is the full manual workflow with a monthly meter. Plus removes the meter and adds the Screener for new senders. Pro adds preset automation for recurring matches. The same Activity record ties all three together.`              | TIER              |

**Unchanged in this file, deliberately:** the arithmetic cells themselves (12,418 emails → 143
decisions), `:52` `Connect. Review. Done.`, the `:101-105` ritual lede, `:130` `Built for the most
skeptical person in the room.`, `:235` `A control companion, not a replacement inbox.`, all five
`VERB_EXPLAINERS`, and the entire Gmail-terms mapping table. Rows 11 and 15 change headings only —
the ledes beneath them already describe the preview, the worker re-check and the Activity record.

### 3.4 New content — the Screener chapter

`sections.tsx` `ProductTour` currently renders **three** chapters: Triage (All plans), Autopilot
(Pro), Activity (All plans). The Screener is not featured on the landing page at all. If it is what
Plus buys, it needs a chapter with a visible tier badge.

| #   | Location                                                   | Content                                                                                                                                                                                                                                         | Class |
| --- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| 17  | `sections.tsx` `ProductTour`, between Triage and Autopilot | Tier badge `Plus · Review`, heading `Screener`, body: _"New senders are collected for review instead of piling up unnoticed. They still arrive in Gmail — the Screener is where you decide what happens next, in a batch, when you are ready."_ | NEW   |

The body wording is constrained by T3 and follows D194's approved framings. It must not say
_blocks_, _prevents_, _keeps out_, _intercepts_, or _quarantine_.

### 3.5 Pricing

| #   | File:line                                                     | Before                                                                                                                                              | After                                                                                                                                               | Class |
| --- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| 18  | `packages/shared/src/entitlements/pricing.config.ts:42,45-49` | `PLUS_CAPABILITIES = [...FREE_CAPABILITIES]`<br>`PRO_CAPABILITIES = [...PLUS_CAPABILITIES, 'autopilot', 'brief', 'screener', 'quiet', 'followups']` | `PLUS_CAPABILITIES = [...FREE_CAPABILITIES, 'screener']`<br>`PRO_CAPABILITIES = [...PLUS_CAPABILITIES, 'autopilot', 'brief', 'quiet', 'followups']` | TIER  |
| 19  | `features/marketing/landing/pricing-teaser.tsx` Plus bullets  | `Unlimited cleanup actions` / `Everything in Free, without the monthly cap`                                                                         | `Unlimited cleanup actions` / `Screener — new senders collected for review`                                                                         | TIER  |
| 20  | `pricing-teaser.tsx` Pro bullets                              | `Everything in Plus, plus automation` / `Autopilot rules, Brief, Screener`                                                                          | `Everything in Plus` / `Autopilot, Brief, Quiet Hours, and Follow-ups`                                                                              | TIER  |

**Why row 18 matters beyond copy.** Today `PLUS_CAPABILITIES` is a spread of `FREE_CAPABILITIES`
with nothing added — Plus removes a meter and grants no capability. A customer who finishes their
one-time cleanup has nothing left that Plus does, which is a structural churn mechanism. The
Screener is a standing arrangement, so it gives Plus a reason to renew.

Prices, quotas, inbox limits and undo windows render **from the manifest** and re-flow with no copy
edit. Only the hardcoded feature bullets above need hand-editing.

### 3.6 Other public pages

| #   | File                                                                                | Before                                                                                               | After                                                                                                                                               | Class |
| --- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| 21  | `app/(marketing)/blog/page.tsx:6`                                                   | `DeclutrMail Journal — sender-first Gmail cleanup`                                                   | `DeclutrMail Journal — previews, undo, and the limits of bulk email`                                                                                | FRAME |
| 22  | `features/marketing/learn/blog-content.ts` — post `why-cleanup-starts-with-senders` | Argues the retired position                                                                          | Post stays. One paragraph added connecting the sender unit to the preview guarantee                                                                 | FRAME |
| 23  | `comparison-data.ts:135` (Clean Email)                                              | `Choose between a broad smart-folder cleanup suite and a focused, sender-first Gmail ritual.`        | `Choose between a broad smart-folder cleanup suite and a Gmail workflow that previews manual Archive, Later, and Delete before they run.`           | FRAME |
| 24  | `comparison-data.ts:265` (Trimbox)                                                  | `Choose between fast newsletter opt-outs and a broader sender-by-sender Gmail control surface.`      | `Choose between fast newsletter opt-outs and a broader Gmail workflow with previews for manual mail moves.`                                         | FRAME |
| 25  | `comparison-data.ts:395` (SaneBox)                                                  | `Choose between learned importance sorting for incoming mail and an explicit sender cleanup ritual.` | `Choose between learned importance sorting for incoming mail and explicit sender decisions you approve one at a time.`                              | FRAME |
| 26  | `comparison-data.ts:526` (Leave Me Alone)                                           | `Choose between subscription-focused control and a wider set of Gmail sender outcomes.`              | `Choose between an unsubscribe specialist and a broader Gmail workflow that also includes supported unsubscribe, Keep, Archive, Later, and Delete.` | FRAME |
| 27  | `comparison-data.ts:660` (Gmail filters)                                            | `Choose between native rule-building and a guided, ranked sender cleanup workflow.`                  | `Choose between native rule-building and a guided sender workflow that shows the scope before manual moves.`                                        | FRAME |
| 28  | `app/(marketing)/changelog/page.tsx`                                                | —                                                                                                    | New entry: headline change + Screener moves to Plus                                                                                                 | NEW   |

---

## 4. Verified as needing NO change

Each of these was read, not assumed.

| Surface                                                               | Why it stays                                                                                                                                                          |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/methodology` — all 9 section headings                               | Already argues the new position. `Intent, preview, confirmation, evidence.` and `A current action never smuggles in a future rule.` are the new beat, already shipped |
| `/how-it-works` — h1 `A sender-control layer for Gmail.` + 8 sections | Section `Preview before the mailbox changes.` already carries beat two. `Manual cleanup is not a hidden rule.` already states T1                                      |
| 5 email templates, `apps/api/src/notifications/templates/`            | `shell.tsx` carries the wordmark only — no tagline, no positioning copy                                                                                               |
| 5 how-to pages, `/how-to/*`                                           | Keyword-bearing and ranking. The title _is_ the query. Only the in-page CTA block changes                                                                             |
| 5 answer pages, `/answers/*`                                          | Same. Still factually accurate                                                                                                                                        |
| 5 legal pages, `/privacy /terms /refunds /cookies /security`          | Factual and compliance-load-bearing, with a CASA assessment on file                                                                                                   |
| `PrivacyBadge`, `shared/src/copy/privacy.ts`                          | Locked D228 copy, schema-backed, already the strongest trust asset                                                                                                    |
| `/compare` title                                                      | Keyword-bearing                                                                                                                                                       |
| Hero trust strip, `hero.tsx:141-153`                                  | `30-day money-back guarantee` and the preview claim are both true and on-message                                                                                      |

**Original D250/D251 scope:** 15 files. The marketing pass expands the proposed work beyond that
initial boundary; use §19 and §20—not this original count—for product-wide planning.

---

## 5. Doc-side changes (companion PR, not this one)

| Artifact                                                                | Change                                                                                                                                                      |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/adr/0030-positioning-preview-guarantee.md`                        | NEW — the stance that constrains future copy                                                                                                                |
| `Implementation-Plan.md:8484`                                           | `[REVERSAL 2026-08-01 on D223]` block; D223 body kept readable                                                                                              |
| `Implementation-Plan.md`                                                | D250 (headline), D251 (Screener tier)                                                                                                                       |
| `Implementation-Plan.md:8299, :8488, :8498, :8524, :8748, :8918, :9296` | Re-point cross-references from D223 to D250                                                                                                                 |
| `Implementation-Plan.md:2708`                                           | `"Clean Gmail by sender, not by email."` — pre-existing T6 violation                                                                                        |
| `IMPLEMENTATION-LOG.md`                                                 | D223 → 🚫 Retired; D250/D251 rows ⬜                                                                                                                        |
| `FOUNDER-FOLLOWUPS.md:1716-1719`                                        | Reopen the 2026-07-28 _Skipped_ entry; record that the reopen is on judgement, with no conversion data, because zero customers means that data cannot exist |
| `CLAUDE.md:208, :796, :214`                                             | Plan stats + tier row — founder-only, via `chore/distill-*`                                                                                                 |

---

## 6. Known seams — review these specifically

1. **Autopilot and the word "approve."** On Pro, an enabled Autopilot rule actions future matches
   with no new per-batch approval. The defence is that promoting a rule out of Observe mode is
   itself an approval carrying a D226 scope preview
   (`apps/web/src/features/autopilot/approve-confirm-modal.tsx`). This is why the verb must be
   `approve` and not `see` or `preview`. **Is that defensible to a hostile reader, or does the H1
   need an explicit Pro qualifier?** This is the single weakest joint in the recommendation.

2. **Beat two sells safety, not desire.** It is a promise about what will _not_ happen. That
   removes an objection but does not create a want, and it is channel-shaped: strongest on r/gmail
   and Show HN, weakest on Product Hunt and X. Runner-up if this proves inert:
   `Clear thousands of emails by sender. See the scope before manual moves.`

3. **No headline fixes the packaging problem.** Even with the Screener, Plus sells a job that
   finishes. That is a pricing question, not a copy question.

4. **`metadata only` in the kicker.** Is three words enough to carry the privacy wedge above the
   fold, given T5 forbids the stronger phrasings? All three personas said the wedge was missing
   above the fold today.

---

## 7. Review brief

Check, in order:

1. **Truth.** Does any proposed string violate T1–T7? Quote the string and the constraint.
2. **The seam in §6.1.** Does "Nothing moves until you approve it" survive a hostile reading of the
   Autopilot case?
3. **Completeness.** Is there a public-facing surface carrying the retired framing that this spec
   misses? Search for `sender-first`, `not by email`, `Control Gmail`.
4. **Regression.** Do rows 1–28 leave any test, snapshot, or Storybook story asserting a string
   that no longer exists?
5. **Better wording.** For any row, propose a stronger line that still satisfies T1–T7.

---

## 8. Marketing-skills pass — what changes in the recommendation

**Pass run:** product marketing, proxy customer research, competitor positioning, pricing and
packaging, churn prevention, conversion copywriting, and page CRO.

Sections 0–7 remain the implementation-ready record of the original D250/D251 proposal. This and
the remaining sections broaden that proposal into a public-content and retention system. A string
below does not enter the implementation scope until it is promoted into the change table in §3.

The canonical reusable context created by this pass is
`.agents/product-marketing.md`. It distinguishes shipped facts, approved-but-not-yet-deployed
packaging, proxy research, and unknown customer metrics.

| Lens               | Finding                                                                                                                    | Decision                                                                                                                                                             |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Positioning        | `Control Gmail by sender` remains exceptionally clear, but sender grouping is now a mechanism, not a durable reason to buy | Keep sender in the explanation; lead with progress plus controlled bulk action                                                                                       |
| Desire             | `Nothing moves until you approve it` removes fear but does not create the want                                             | Preserve it as a test/control; the recommended lead starts with clearing thousands of emails                                                                         |
| Truth              | The Autopilot seam in §6.1 makes universal approval timing fragile                                                         | Scope timing claims to **manual** Archive, Later, and Delete; describe Autopilot separately                                                                          |
| Audience           | There are no customers from whom validated personas can be derived                                                         | Use three provisional segments and replace them with first-party evidence after interviews                                                                           |
| Competition        | Gmail is the default alternative; vendor comparisons are secondary                                                         | Add a direct “Why not just Gmail?” argument before the vendor grid                                                                                                   |
| Premium perception | Competitors have years of reviews and large public usage numbers; DeclutrMail has none                                     | Build premium trust from restraint, exact product proof, transparent limits, and a polished demo—never invented social proof                                         |
| Monetization       | Free proves value; Plus must own a standing one-inbox job; Pro must own recurring multi-inbox control                      | Keep D251. Package each tier around a distinct customer job, not a list of features                                                                                  |
| Churn              | A landing-page headline cannot repair a one-time paid job                                                                  | Make weekly Screener review the Plus renewal story and approved automation + multi-inbox receipts the Pro renewal story; measure whether customers actually use them |
| Conversion         | The page asks for sensitive OAuth access before showing enough payoff and proof                                            | Keep the synthetic demo as a real secondary CTA and place product proof directly beside the claims it supports                                                       |

### Revised headline recommendation

The original D250 line is a strong **control** variant:

> Control Gmail by sender. Nothing moves until you approve it.

The marketing pass recommends this as the benefit-led **challenger**:

> **Clear thousands of emails by sender—without a blind bulk move.**

Why the challenger is stronger:

- `Clear thousands of emails` creates the desired outcome.
- `by sender` retains the clarity winner as the mechanism.
- `without a blind bulk move` names the anxiety and the differentiator without claiming a fresh
  approval before every future Autopilot batch.
- It is specific enough to exclude reply drafting, importance ranking, and replacement-inbox use.

Do not choose between these on taste if there is enough qualified traffic to test. The decision
metric is completed OAuth **and first successful manual action**, not headline preference or CTA
clicks alone. With insufficient traffic, ship the challenger and run five moderated cold reads
before implementation.

---

## 9. Provisional audience segments

These are behavioral segments, not invented demographic characters. Each remains **low
confidence** until at least five independent first-party data points support it.

| Segment                    | Trigger                                                                         | Job                                                                     | Main anxiety                                                                     | Best lead                                                              | Plan path                                                             |
| -------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **Backlog owner**          | Storage warning, thousands of unread messages, or years of neglected mail       | Make a large, visible first dent without losing something important     | Bulk delete is too coarse; the useful mail is mixed in                           | Clear thousands by sender; see the scope of manual moves first         | Free proves value → Plus finishes the backlog and reviews new senders |
| **Control-first skeptic**  | Has postponed cleanup or rejected another tool because inbox access feels risky | Understand what is read, what will move, and how recovery works         | Opaque OAuth access, hidden rules, and false “everything is reversible” promises | `Full bodies fetched: 0` + exact preview + Activity record             | Free/Plus                                                             |
| **Multi-inbox maintainer** | Personal, work, and an old/project Gmail account all accumulate recurring noise | Apply one deliberate method without merging accounts or replacing Gmail | Inconsistent rules, switching accounts, opaque automation                        | Approved rules and one Activity model across up to three Gmail inboxes | Pro                                                                   |

### Anti-personas to say “not for you” to

- A user who only needs Gmail's occasional native Unsubscribe button.
- A user who wants a free, one-click permanent purge with no review.
- A user who needs Outlook, iCloud, Yahoo, or general IMAP support.
- A user shopping for message-body search, summarization, reply drafting, or automatic importance
  ranking.
- A team buyer until Team has real collaboration, administration, support, and pricing.

Honest disqualification is premium behavior. It reduces wrong-fit acquisition, refunds, support
load, and voluntary churn.

### Proxy voice-of-customer themes

These are problem-space signals, not DeclutrMail testimonials:

- **Scale:** “I don't want to have to manually archive 700 pages.”
- **Safety:** “without accidentally deleting anything important.”
- **Urgency:** “I have 10's of thousands I want to delete quickly.”
- **Emotion:** “I want my email back.”
- **Multi-account load:** “I'm getting overwhelmed.”
- **Workflow friction:** “without toggling tabs, forwarding or clogging one mail account.”

Public copy may mirror the themes, but must not quote or attribute them as customer proof.

---

## 10. Messaging hierarchy

Every public surface should draw from the hierarchy in this order:

| Layer                  | Canonical message                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------- |
| **Category**           | A Gmail cleanup companion—not a replacement inbox                                                  |
| **Desired outcome**    | Make meaningful progress on years of accumulated mail                                              |
| **Mechanism**          | Review recurring mail by sender instead of message by message                                      |
| **Differentiator**     | See the current scope and planned Gmail change before a manual bulk move                           |
| **Recovery**           | Find the outcome in Activity; undo manual Archive, Later, and Delete while the plan window is open |
| **Privacy proof**      | `Full bodies fetched: 0`                                                                           |
| **Recurring Plus job** | Review new senders in one queue before they disappear into the backlog; they still arrive in Gmail |
| **Recurring Pro job**  | Observe and enable preset rules for future matches across up to three Gmail inboxes                |
| **Emotional payoff**   | Progress without the blind leap—and no mystery about what happened                                 |

### One-sentence position

> DeclutrMail is the Gmail cleanup companion for people who want to act on years of mail in bulk
> without taking a blind leap.

### Short category line

> Deliberate bulk cleanup for Gmail.

### “Why pay?” answer

> Gmail is excellent when you know the search or subscription you want. DeclutrMail is for the
> harder moment: you know the inbox is out of control, but you do not yet know which senders create
> the most noise or exactly what a bulk move will touch.

### Copy discipline

- Use **safe** only beside the mechanism that makes the action safer.
- Use **undoable** only with Archive, Later, or Delete and a stated window.
- Use **existing mail** and **future rules** as separate ideas.
- Use **sender** as the review unit, not the whole competitive claim.
- Put the locked privacy badge beside OAuth and data-access claims.
- Never let `metadata only` stand alone; the FAQ must remain explicit that subject and Gmail's short
  preview snippet are stored under the product contract.

---

## 11. Homepage — recommended public copy

### 11.1 Hero

```text
kicker    Gmail cleanup · preview before manual moves

H1        Clear thousands of emails by sender—without a blind bulk move.

subhead   Choose Keep, Archive, Unsubscribe, Later, or Delete for each sender.
          Before manual Archive, Later, or Delete, see the current matches and
          exact Gmail change; then verify the result in Activity.

CTA       Review my Gmail senders
          Try the demo — no sign-in

note      Free · no card · 50 cleanup actions every month
```

The primary CTA still opens Google sign-in; add a short accessible expectation such as `Opens
Google sign-in` next to or beneath it. The button describes the value awaiting the visitor instead
of the integration step. If this creates expectation mismatch in usability testing, fall back to
`Connect Gmail — free`.

**Hero proof row:**

- Render the locked `Full bodies fetched: 0` badge unchanged.
- `30-day money-back guarantee on paid plans`.
- `Gmail stays your inbox`.
- The demo uses synthetic mail and needs no mailbox access.

### 11.2 Headline alternatives

| Variant | Copy                                                             | Role                                                    |
| ------- | ---------------------------------------------------------------- | ------------------------------------------------------- |
| A       | `Control Gmail by sender. Nothing moves until you approve it.`   | Original D250 control; maximum clarity and reassurance  |
| B       | `Clear thousands of emails by sender—without a blind bulk move.` | Recommended; outcome + mechanism + anxiety              |
| C       | `Clear years of Gmail clutter. See the scope before you act.`    | Shortest premium expression; less explicit about sender |

Do not test more than one challenger at a time. Preserve the same visual, subhead, traffic mix, and
CTA so the headline is the variable.

### 11.3 Payoff before fine print

```text
eyebrow   The backlog, compressed

H2        Thousands of emails. A few hundred sender decisions.

body      An illustrative inbox with 12,418 messages can become 143 sender
          reviews. Choose the outcome for the current backlog; DeclutrMail shows
          the matching messages and Gmail change before a manual move runs.
```

Keep the arithmetic visual, but label it **illustrative** at the number itself—not in distant fine
print. The payoff should precede the full privacy section; the compact privacy badge remains above
the fold.

### 11.4 The native-alternative section

Add this before vendor comparisons and before the long product tour:

```text
eyebrow   Why not just Gmail?

H2        Gmail can select thousands. The hard part is trusting the selection.

body      Use Gmail to read, search, manage subscriptions, and build filters.
          Use DeclutrMail when recurring senders are the problem and you want the
          scope of a manual Archive, Later, or Delete shown before it runs.
```

Three proof cards:

| Card     | Heading              | Body                                                                                     |
| -------- | -------------------- | ---------------------------------------------------------------------------------------- |
| Before   | `See the scope`      | `Review the current count, an available sample, and the planned Gmail label change.`     |
| After    | `Keep the record`    | `Every final outcome lands in Activity. Undo appears only where the action supports it.` |
| Boundary | `Keep Gmail as home` | `Read, reply, search content, and inspect final mailbox state in Gmail.`                 |

This section competes with the real default choice without pretending Gmail is deficient at jobs
it already does well.

### 11.5 How it works

```text
H2        Find the pattern. See the scope. Make the call.

1         Review senders
          Start with the recurring sources creating the most volume—not an
          undifferentiated wall of messages.

2         Preview the manual move
          See what currently matches and whether Gmail will remove Inbox, add
          DeclutrMail/Later, or move messages to Trash.

3         Verify the result
          Find the completed outcome in Activity. Manual Archive, Later, and
          Delete show undo while the plan window remains open.
```

Unsubscribe needs an adjacent one-way note: `A delivered unsubscribe request cannot be recalled;
existing mail stays put unless you separately approve another action.`

### 11.6 Product chapters by customer job

**Manual cleanup — All plans**

> Work through the existing backlog with Keep, Archive, Unsubscribe, Later, or Delete. Manual
> Archive, Later, and Delete show their current scope before mail moves.

**Screener — Plus and Pro after D251 deploys**

> New senders still arrive in Gmail. Screener collects them into a review queue so the decisions do
> not disappear into the backlog. Review them in a batch when you are ready.

**Autopilot — Pro**

> Preset rules begin in Observe. Review what a rule would have matched, then enable it for future
> mail. Pause it whenever you want; completed outcomes appear in Activity.

**Activity — All plans**

> One place to verify what happened. Undo appears for manual Archive, Later, and Delete while the
> plan window is open. A delivered unsubscribe request is clearly marked one-way.

### 11.7 Persona pathways

Do not force three audiences into the H1. Add a compact chooser after the core proof:

```text
H2        Start with the Gmail problem you have today.

Backlog   Years of accumulated mail
          Work through recurring senders without guessing what a manual move will touch.

Trust     Cautious about inbox access
          See the exact data boundary, action scope, recovery path, and one-way actions.

Accounts  Two or three Gmail inboxes
          Use the same deliberate review and approved-rule model without merging accounts.
```

Route these cards into existing methodology, privacy, how-to, and pricing content before building
new pages. New persona routes are justified only after search demand or interview evidence shows
that the existing route cannot satisfy the intent.

### 11.8 Final CTA

```text
H2        Start with one sender. See the scope before a manual move.

body      Free includes the full manual workflow, one Gmail inbox, 50 cleanup
          actions every month, and 7-day Activity undo for manual Archive,
          Later, and Delete.

CTA       Review my Gmail senders
          Try the demo — no sign-in
```

---

## 12. Pricing page — sell the job, not the feature inventory

The current H1, `Pick how clean you want to stay.`, is confusing and violates the spirit of T6 by
using _clean_ as the user-data outcome. Replace it.

### 12.1 Pricing hero

```text
eyebrow   Pricing

H1        Choose the level of control you need.

subhead   Start with the full manual workflow. Plus removes the meter and adds
          a queue for new senders. Pro adds approved future-mail rules, three
          Gmail inboxes, and 30-day Activity undo.

note      Every paid plan has a 30-day money-back guarantee.
```

The Plus/Screener sentence can ship only with D251. Before that atomic deploy, retain the current
capability truth.

### 12.2 Tier jobs

| Plan     | Public job line                                   | Customer fit                                   | Hero bullets after D251                                                                                                        |
| -------- | ------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Free** | `Prove the workflow on one inbox.`                | Occasional cleanup or evaluating trust         | `50 cleanup actions every month` · `Full manual sender workflow` · `7-day Activity undo for manual Archive, Later, and Delete` |
| **Plus** | `Finish the backlog. Review what arrives next.`   | One busy Gmail inbox, ongoing manual control   | `Unlimited cleanup actions` · `Screener queue for new senders` · `1 inbox · 7-day Activity undo`                               |
| **Pro**  | `Put approved rules to work across your inboxes.` | Recurring noise in two or three Gmail accounts | `Everything in Plus` · `Autopilot, Brief, Quiet Hours, and Follow-ups` · `3 inboxes · 30-day Activity undo`                    |

Replace the unearned `⭐ recommended` badge. With zero customer data, neither “most popular” nor a
universal recommendation is evidence-backed. Use fit labels:

- Plus: `For one busy inbox`
- Pro: `For recurring, multi-inbox control`

Highlighting Plus is a CRO hypothesis, not a permanent truth. Test it against the current Pro
highlight using paid checkout **and 30-day retained conversion**, not checkout alone.

### 12.3 Pricing reassurance

Add this directly beneath the cards:

> **Only need occasional cleanup? Stay on Free.** Upgrade when the monthly meter interrupts useful
> work, when you want a standing queue for new senders, or when approved rules and multiple inboxes
> will keep earning their place.

This line reduces low-fit purchases and short-term revenue, but should improve trust, refunds, and
retained revenue.

### 12.4 Pricing FAQs to add

**Which plan should I choose?**

> Choose Free to try the complete manual workflow or for occasional maintenance. Choose Plus for
> unlimited manual cleanup and Screener on one Gmail inbox. Choose Pro for preset future-mail rules,
> up to three Gmail inboxes, Brief, and a 30-day Activity undo window.

**Why is Plus recurring after I finish the backlog?**

> Plus is for one busy inbox that keeps receiving new sources. Screener collects new senders for a
> later review—they still arrive in Gmail—and unlimited actions let you handle the next batch when
> it appears. If you only need occasional maintenance, Free may be enough.

**Does upgrading make manual cleanup automatic?**

> No. Free and Plus manual actions affect matching mail when they run. Pro Autopilot is a separate
> future-mail feature: preset rules begin in Observe and act only after you enable them.

**Can I undo every action?**

> No. Manual Archive, Later, and Delete expose Activity undo while the plan window is open. Delete
> also has separate Gmail Trash recovery, normally for up to 30 days unless Trash is emptied sooner.
> A delivered unsubscribe request cannot be recalled.

---

## 13. Competitor-facing public content

### 13.1 Comparison hub

```text
H1        Compare the way each tool handles the decision—not just the feature list.

subhead   DeclutrMail is a Gmail-specific companion for explicit sender decisions,
          manual-move previews, and an Activity record. The broader or simpler
          option is sometimes the better fit; every comparison says when.
```

Replace `DeclutrMail is a sender-first Gmail cleanup companion` in
`comparison-screen.tsx`. That line is a missed public instance of the retired position and is not
listed in §3.

### 13.2 Gmail — the primary comparison

Add `/vs/gmail`, separate from the existing `/vs/gmail-filters` page.

```text
title      DeclutrMail vs Gmail for bulk cleanup

H1         Gmail already manages subscriptions. DeclutrMail handles the harder
           bulk decisions.

summary    Use Gmail when you know the sender, search, unsubscribe action, or
           filter you need. Use DeclutrMail when you want supported unsubscribe
           beside Keep, Archive, Later, and Delete, recurring senders surfaced,
           manual-move scope shown first, and a separate Activity record.

Gmail fit  Native, free, no additional vendor, flexible search and filters,
           built-in subscription controls.

DM fit     Guided sender review, manual Archive/Later/Delete scope, plan-based
           Activity undo, approved rule workflow, and up to three Gmail inboxes.

CTA        Try the demo — no Gmail access
```

Do not compare DeclutrMail against Gmail on sender lists, one-click unsubscribe, AI summaries,
reply drafting, or importance ranking. Gmail owns or commoditizes those jobs.

### 13.3 Vendor page leads

| Page           | H1                                                              | Honest summary                                                                                                                                                                                                                                                       |
| -------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clean Email    | `Choose breadth—or deliberate Gmail control.`                   | `Clean Email is the broader multi-provider suite. DeclutrMail is the narrower Gmail workflow when manual-move scope, a defined Activity undo window, and a restrained data boundary matter more than breadth.`                                                       |
| Trimbox        | `One-click unsubscribe—or a complete sender decision workflow.` | `Trimbox is the simpler fit for mailing-list opt-out and past-mail deletion. DeclutrMail adds Keep, Archive, Later, Delete, previews for manual moves, and Activity.`                                                                                                |
| SaneBox        | `Learned sorting—or explicit Gmail cleanup.`                    | `SaneBox continuously sorts incoming mail across providers. DeclutrMail is for people who prefer to decide sender outcomes, inspect manual-move scope, and enable future rules only after Observe.`                                                                  |
| Leave Me Alone | `Subscription control—or a wider Gmail sender workflow.`        | `Leave Me Alone specializes in unsubscribe, Rollups, and Inbox Shield across providers. DeclutrMail includes supported unsubscribe within a broader Gmail workflow—Keep, Archive, Later, and Delete—with scope previews and Activity records for manual mail moves.` |
| Gmail filters  | `Native rule power—or a guided decision workflow.`              | `Gmail filters are ideal when you know the criteria and action. DeclutrMail helps surface the sender pattern, explain the Gmail effect, and preserve a separate cleanup record.`                                                                                     |

Every page must keep its source list, reviewed date, honest “choose them when” section, and unknown
states. No competitor negative claim should ship from memory.

---

## 14. Customer-facing retention copy

Public acquisition copy cannot deliver lower churn by itself. These customer-facing moments make
the public promise real after OAuth. They are copy specifications, not authorization to implement
new billing behavior.

### 14.1 First session

```text
heading    Start with one sender you already recognize.

body       Open the preview to see the current matches and exact Gmail change.
           If you choose manual Archive, Later, or Delete, nothing moves until
           you approve the preview.
```

The first success receipt should repeat the value, not celebrate with generic confetti:

```text
heading    {affectedCount} messages archived from Inbox.

body       They remain searchable in All Mail. This result is in Activity and
           can be undone there for {undoWindowDays} days on your current plan.
```

Use the real count, action, destination, and plan window. Never reuse `412` outside the synthetic
demo.

### 14.2 Free quota encounter

```text
heading    You have used this month's cleanup actions.

body       Your sender map and Activity remain available. Continue when your
           quota resets on {date}, or choose Plus for unlimited cleanup actions
           and Screener for new-sender review.

CTA        View Activity
           Compare Plus
```

The reset date must come from the server's anniversary-based entitlement value. The Screener line
ships only with D251.

### 14.3 Plus weekly value cue

```text
subject    {N} new senders are ready for review

body       They still arrived in Gmail. Screener keeps the decisions together
           so you can review the batch when you are ready.

CTA        Review new senders
```

Send only when `N > 0`, respect notification preferences, and never include sender identities or
mailbox content in analytics.

### 14.4 Pro value receipt

```text
subject    Your approved rules handled {N} matches this month

body       Across {M} Gmail inboxes, the rules you enabled produced {N} final
           outcomes. Review each one in Activity, including any undo that is
           still available.

CTA        Review Activity
```

Do not claim time saved unless measured and defined. Do not say the inbox “stayed clear” if the
product cannot back that state.

### 14.5 Cancellation copy

The cancel flow should remain easy to find and complete. Ask one reason, then show at most one
relevant alternative. Do not add a discount before there is evidence that price is the cause or
that discounted cohorts retain.

**Reason: `The backlog is handled`**

> Free may be enough for occasional maintenance. It keeps the manual workflow with 50 cleanup
> actions every month. Move to Free, or continue cancelling.

**Reason: `I am not using it enough`**

> Move to Free and keep the manual workflow for occasional cleanup. Your existing Gmail state does
> not depend on keeping a paid subscription.

**Reason: `A feature is missing`**

> Tell us what is missing. This does not delay cancellation, and we will not promise a roadmap date
> we cannot meet.

**Final confirmation:** state the exact access end date, what happens to Active Autopilot rules,
the remaining Activity undo deadline, and whether the workspace moves to Free. Those strings must
derive from real billing and entitlement state, not a generic template.

---

## 15. Premium-and-polished proof system

Premium does not mean louder adjectives. For a product touching Gmail, it means fewer claims,
better evidence, calmer interaction, and no surprise after the click.

### Product proof available before customer proof

1. **Synthetic interactive demo:** visitors can experience the preview and receipt without OAuth.
2. **Exact privacy boundary:** the shared `Full bodies fetched: 0` badge and field inventory.
3. **Concrete action proof:** current count, sample, Gmail label change, final Activity outcome.
4. **Transparent limits:** existing mail versus future rules; one-way unsubscribe; separate Trash
   recovery; Screener still allows Gmail delivery.
5. **Source-backed comparisons:** primary sources, review dates, unknown states, and an honest case
   for choosing the competitor.
6. **Commercial reassurance:** public prices, visible plan fit, cancel access, and the published
   30-day paid-plan guarantee.

### Presentation rules

- Remove the emoji `⭐` from the Pro recommendation; use restrained fit labels.
- Put one decisive screenshot or interactive state beside each major claim.
- Keep paragraphs short enough to scan; move edge-case detail into a nearby disclosure or FAQ.
- Do not repeat the entire privacy contract in every section. Use the badge above the fold and the
  detailed inventory where trust is being evaluated.
- Use Gmail's words—Inbox, All Mail, Trash, label, search—before product nouns.
- Keep one primary CTA label across the homepage and one lower-friction demo CTA.
- Never display “trusted by,” logos, ratings, time saved, or outcome percentages until first-party
  evidence exists and permission is documented.

---

## 16. Revenue and churn measurement plan

### Funnel that matters

```text
qualified landing view
→ primary CTA or synthetic demo
→ Google OAuth completed
→ first preview opened
→ first successful cleanup action
→ second-session return
→ quota encounter or paid-feature intent
→ checkout completed
→ paid feature activated
→ 30 / 60 / 90-day retained paid workspace
```

The highest marketing goal is **retained gross profit**, not the number of OAuth starts or even the
number of first-month subscriptions.

### Metrics by decision

| Decision       | Primary metric                                                | Guardrail                                                    |
| -------------- | ------------------------------------------------------------- | ------------------------------------------------------------ |
| Hero           | First successful cleanup action / qualified landing view      | OAuth completion, demo completion, bounce by source          |
| CTA wording    | OAuth completion / CTA click                                  | Consent-screen abandonment and support confusion             |
| Plus highlight | 30-day retained Plus conversion / pricing view                | Refunds, cancellation reason, Free→Plus misfit               |
| D251           | Weekly Screener use among Plus cohorts                        | 30/60/90-day Plus retention and queue-related support issues |
| Pro story      | Autopilot enabled after Observe **or** second inbox connected | Rule pauses, unexpected-action reports, refunds              |
| Value receipt  | Return to Activity and retained paid cohort                   | Unsubscribe rate and notification complaints                 |

### Experiment order

1. Verify every event in the funnel and record a baseline.
2. Run five cold-message interviews per provisional segment; do not show all variants first.
3. Test the hero control against one challenger.
4. Test the value CTA only after the headline winner is stable.
5. Ship D251 atomically, then compare Plus cohorts on Screener activation and retention.
6. Test the Plus-versus-Pro visual highlight on retained conversion.
7. Add persona routes only where search or interview evidence shows distinct intent.

Low traffic makes parallel A/B tests noisy. Prefer sequential tests, annotated release dates,
session replays with consent, and short post-action interviews until volume supports inference.

---

## 17. Research required before claiming product-market language

### First 15 conversations

- Five people who connected Gmail and completed a first action.
- Five who reached OAuth or the demo but did not connect.
- Five who paid, requested a refund, downgraded, or cancelled as soon as those cohorts exist.

Ask for events and behavior, not opinions about copy:

1. What happened that made you look for Gmail help now?
2. What had you already tried?
3. What were you afraid a bulk action might do?
4. What did you need to see before connecting Gmail?
5. Which first result made the product feel useful—or not?
6. After the backlog is handled, what would make the product worth keeping next month?
7. What would make you choose Gmail, Clean Email, Trimbox, SaneBox, Leave Me Alone, or doing
   nothing instead?

Capture exact wording. Tag every insight by segment, source, date, acquisition channel, and
confidence. Do not convert one vivid quote into a persona.

---

## 18. Expanded execution priority

### P0 — before the repositioning ships

1. Decide whether D250 remains the shipped headline or becomes the test control against §8's
   challenger.
2. Apply D251 atomically across entitlements, gates, nav badge behavior, pricing, FAQ, tests, and
   user-facing upgrade copy.
3. Fix the live Free-CTA automation falsity already identified in row 8.
4. Replace the pricing H1 and plan jobs so the ladder describes customer fit.
5. Add the direct Gmail comparison argument.
6. Replace the missed `sender-first` comparison-hub intro.
7. Verify the end-to-end conversion and retention event chain before evaluating copy.

### P1 — launch content

1. Reorder homepage proof: payoff → native alternative → workflow → trust depth → product chapters
   → pricing.
2. Use one primary CTA and an explicitly synthetic, no-sign-in demo CTA.
3. Add the four job-based product chapters and pricing FAQs.
4. Add the first-session, quota, Screener, Pro receipt, and cancellation copy only where the
   underlying state and behavior already exist.

### P2 — after evidence

1. Replace proxy segment language with first-party voice-of-customer.
2. Publish persona routes only for validated intent.
3. Add attributed testimonials and outcomes only with permission and a reproducible measurement
   definition.
4. Revisit price points only after paid conversion, activation, refund, and retention cohorts can
   distinguish a price problem from a product-value problem.

---

## 19. Canonical implementation action register

This section consolidates the original D250/D251 proposal and the later marketing-skills pass into
one execution list. **Where copy in §§2–3 conflicts with §§11–14 or the matrix in §20, §20 is the
recommended after-state.** The original copy remains above as decision history and, for the H1, as
the experiment control.

The register includes copy, product packaging, lifecycle, proof, analytics, research, and
verification work because retained revenue will not improve if only the landing page changes.

| ID          | Priority | Owner lane          | Action                                                                                                                                              | Dependency / definition of done                                                                                                                                                                                                        | Status                               |
| ----------- | -------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| DEC-01      | P0       | Founder + Growth    | Decide the H1 launch mode: ship the benefit-led challenger or run it against the D250 control.                                                      | Recommended: if qualified traffic is low, run five cold reads, then ship the challenger. If traffic supports a test, use first successful manual action per qualified landing view—not clicks—as the decision metric.                  | Decision                             |
| DEC-02      | P0       | Founder + Product   | Confirm D251 as an atomic product-and-copy release: Screener moves from Pro to Plus and remains in Pro through capability inheritance.              | Already founder-approved in this spec; do not publish Plus/Screener copy before the entitlement and API/UI gates deploy.                                                                                                               | Approved, unimplemented              |
| DEC-03      | P0       | Growth + Product    | Choose the initial pricing-card emphasis.                                                                                                           | Remove `⭐ recommended` and `Most popular`. Recommended launch: fit labels only; test Plus versus Pro emphasis later on 30-day retained paid conversion.                                                                               | Decision                             |
| DEC-04      | P1       | Product + Lifecycle | Approve the cadence and consent model for Plus and Pro value receipts.                                                                              | Send only when there is real value to report, respect notification preferences, and never include mailbox content or sender identity in analytics.                                                                                     | Decision                             |
| TRUTH-01    | P0       | Web                 | Remove the live hero implication that automation is included with the Free CTA.                                                                     | No acquisition surface may describe Pro Autopilot as part of the Free/manual workflow.                                                                                                                                                 | Open                                 |
| TIER-01     | P0       | Shared + API        | Move `screener` into `PLUS_CAPABILITIES`; let Pro inherit it while retaining `autopilot`, `brief`, `quiet`, and `followups`.                        | Manifest, derived pricing tables, capability guards, and pinned tests agree.                                                                                                                                                           | Open                                 |
| TIER-02     | P0       | Web + API           | Update every Screener gate and under-tier state from Free/Plus→Pro to Free→Plus.                                                                    | Free never queries the queue; Plus, Pro, Team, and Enterprise do; server remains authoritative.                                                                                                                                        | Open                                 |
| TIER-03     | P0       | Web                 | Rename `ScreenerProUpsell` and its file/tests/stories to a Plus-oriented under-tier surface.                                                        | No user-facing or code comment claims Screener is Pro-only.                                                                                                                                                                            | Open                                 |
| TIER-04     | P0       | QA                  | Update Screener, entitlement, nav badge, API guard, pricing-model, Storybook, and billing-upgrade tests.                                            | Unit, integration, and e2e suites pin the new tier boundary.                                                                                                                                                                           | Open                                 |
| HOME-01     | P0       | Web + Copy          | Apply the chosen hero system across the homepage, SEO title/description, default OG image/alt, and onboarding promise.                              | All retired headline instances are gone except the explicitly retained experiment control.                                                                                                                                             | Open                                 |
| HOME-02     | P0       | Web + Copy          | Replace the hero kicker, subhead, CTA labels, helper text, note, and synthetic ledger caption with §20 copy.                                        | All five verbs—including Unsubscribe—are visible near the lead; preview/undo claims remain action-scoped.                                                                                                                              | Open                                 |
| HOME-03     | P1       | Web + Design        | Reorder the homepage to payoff → Gmail alternative → workflow → trust depth → product chapters → pricing.                                           | Compact privacy proof remains above the fold; detailed privacy stays later.                                                                                                                                                            | Open                                 |
| HOME-04     | P1       | Web + Copy          | Add the “Why not just Gmail?” section and three proof cards.                                                                                        | It acknowledges Gmail search, filters, and subscription controls; no obsolete sender-list differentiation.                                                                                                                             | Open                                 |
| HOME-05     | P1       | Web + Copy          | Rewrite the workflow as Find the pattern → See the scope → Make the call and add the one-way unsubscribe disclosure.                                | Manual/current-mail behavior and future Autopilot behavior remain separate.                                                                                                                                                            | Open                                 |
| HOME-06     | P1       | Web + Copy          | Expand the product tour from three to four customer-job chapters: Manual cleanup, Screener, Autopilot, Activity.                                    | Screener badge says Plus and Pro only after TIER-01/TIER-02 ship.                                                                                                                                                                      | Open                                 |
| HOME-07     | P1       | Web + Copy          | Add the compact Backlog / Trust / Accounts pathway chooser.                                                                                         | Cards route to existing useful pages first; do not create persona landing pages until intent is validated.                                                                                                                             | Open                                 |
| HOME-08     | P1       | Web                 | Standardize homepage primary and demo CTAs, including the final CTA.                                                                                | Primary: `Review my Gmail senders`; helper: `Opens Google sign-in`; secondary: `Try the demo — no sign-in`. OAuth destination does not change.                                                                                         | Open                                 |
| HOME-09     | P1       | Web                 | Correct the simulator tier eyebrow and align its conversion CTA.                                                                                    | Triage is described as available on every plan; synthetic/no-sign-in boundary remains prominent.                                                                                                                                       | Open                                 |
| PRICE-01    | P0       | Web + Copy          | Replace the pricing H1, subhead, and Free/Plus/Pro job lines.                                                                                       | The ladder explains fit: prove → maintain one inbox → automate recurring multi-inbox work.                                                                                                                                             | Open                                 |
| PRICE-02    | P0       | Web + Design        | Replace unearned popularity/recommendation badges with fit labels.                                                                                  | Plus: `For one busy inbox`; Pro: `For recurring, multi-inbox control`.                                                                                                                                                                 | Open                                 |
| PRICE-03    | P0       | Web + Copy          | Update landing pricing teaser bullets and derived pricing cards after D251.                                                                         | Plus names unlimited actions + Screener; Pro names inherited Plus + Pro-only automation set.                                                                                                                                           | Blocked by TIER-01                   |
| PRICE-04    | P1       | Web + Copy          | Add the “Stay on Free” reassurance and four pricing FAQs.                                                                                           | Copy reduces low-fit purchases and explicitly states Unsubscribe irreversibility and the distinction between manual work and Autopilot.                                                                                                | Open                                 |
| PRICE-05    | P0       | Web + Copy          | Update public FAQ and Help plan answers for D251.                                                                                                   | Plus includes Screener; Pro retains Autopilot, Brief, Quiet, Follow-ups, three inboxes, and 30-day undo.                                                                                                                               | Blocked by TIER-01                   |
| PRICE-06    | P0       | Web + Copy          | Update the Free-cap upgrade modal.                                                                                                                  | Preserve real reset date and localized manifest price; add Screener to the Plus value explanation without implying automation.                                                                                                         | Blocked by TIER-01                   |
| PRICE-07    | P0       | Web + Copy          | Update the Triage near-cap nudge.                                                                                                                   | Say `unlimited cleanup actions and Screener for new-sender review`; do not list only Archive/Delete/Unsubscribe.                                                                                                                       | Blocked by TIER-01                   |
| COMP-01     | P0       | Web + Copy          | Reframe the comparison hub around the job and decision model.                                                                                       | Remove `sender-first Gmail cleanup companion`; keep primary-source and unknown-state standards.                                                                                                                                        | Open                                 |
| COMP-02     | P0       | Web + Copy          | Add `/vs/gmail` as the primary native-alternative page.                                                                                             | Register route, metadata, JSON-LD/index listing, source set, tests, and sitemap if applicable.                                                                                                                                         | Open                                 |
| COMP-03     | P0       | Copy                | Update all five vendor comparison leads and index summaries.                                                                                        | Each page says when the competitor is a better fit and preserves verified dates/sources.                                                                                                                                               | Open                                 |
| COMP-04     | P0       | Copy                | Make DeclutrMail’s supported sender unsubscribe explicit on Trimbox, Leave Me Alone, Gmail, and relevant hub copy.                                  | Never imply universal sender support; distinguish RFC one-click, mailto/manual, unsupported senders, and one-way delivery.                                                                                                             | Open                                 |
| COMP-05     | P0       | Research + Copy     | Re-verify competitor claims immediately before release.                                                                                             | Official primary sources only; update `Last verified`; unknown stays unknown.                                                                                                                                                          | Open                                 |
| CONTENT-01  | P1       | Copy + Web          | Reframe the Journal metadata and add a preview-guarantee bridge to the sender thesis article.                                                       | Preserve the ranking article and URL; do not rewrite keyword-bearing how-to titles.                                                                                                                                                    | Open                                 |
| CONTENT-02  | P1       | Copy + Web          | Add a changelog entry for the positioning change and D251.                                                                                          | State the product boundary, tier change, and effective date without presenting it as customer proof.                                                                                                                                   | Open                                 |
| CONTENT-03  | P1       | Copy + Web          | Standardize in-page conversion blocks on how-to and answer pages.                                                                                   | Keep SEO headings/content; use the synthetic demo and value-led Gmail CTA at the conversion block only.                                                                                                                                | Open                                 |
| ONBOARD-01  | P0       | Web + Copy          | Align the pre-OAuth Promise screen with the selected H1 and value CTA.                                                                              | Keep the exact PrivacyBadge and Google consent explanation.                                                                                                                                                                            | Open                                 |
| ONBOARD-02  | P1       | Web + Copy          | Make the first live session start with one recognized sender and the preview promise.                                                               | Reuse real Triage behavior; no synthetic claims in authenticated onboarding.                                                                                                                                                           | Open                                 |
| ONBOARD-03  | P1       | Web + Copy          | Replace generic first-success celebration with an action-specific receipt.                                                                          | Render actual count, verb, Gmail destination, plan undo window, and Activity location.                                                                                                                                                 | Open                                 |
| RETAIN-01   | P1       | Web + Copy          | Rewrite the Free quota encounter around preserved value, reset date, and Plus fit.                                                                  | Sender map and Activity remain accessible; buttons are `View Activity` and `Compare Plus`.                                                                                                                                             | Blocked by TIER-01 for Screener line |
| RETAIN-02   | P1       | API + Lifecycle     | Add the Plus weekly Screener value cue.                                                                                                             | Trigger only when `N > 0`; template and analytics contain no mailbox content or sender identities.                                                                                                                                     | Blocked by DEC-04/TIER-01            |
| RETAIN-03   | P1       | API + Lifecycle     | Add the Pro monthly approved-rule value receipt.                                                                                                    | Use real final outcome and connected-inbox counts; do not claim time saved.                                                                                                                                                            | Blocked by DEC-04                    |
| RETAIN-04   | P1       | Shared + API + Web  | Add cancellation reason `The backlog is handled`.                                                                                                   | Extend shared schema, persistence/reporting, UI label, tests, and analytics taxonomy.                                                                                                                                                  | Open                                 |
| RETAIN-05   | P1       | Web + Copy          | Show at most one reason-relevant alternative in the cancellation flow.                                                                              | Backlog/not-using → Free; missing feature → feedback; price → no automatic discount until cohort evidence exists; cancellation remains immediate to complete.                                                                          | Open                                 |
| RETAIN-06   | P1       | Web + API           | Make final cancellation consequences fully state-derived.                                                                                           | Exact access end, Autopilot consequence, remaining undo deadline, and resulting tier are truthful for provider and subscription state.                                                                                                 | Discovery needed                     |
| EMAIL-01    | P1       | Shared + API + Web  | Add an explicit opt-out-able preference category and delivery path for Plus/Pro value receipts.                                                     | Do not reuse `reminders` or `syncComplete`: extend the shared preference schema and Settings UI, enforce the preference at worker execution, add in-body and header unsubscribe, idempotent triggers, templates, snapshots, and tests. | Blocked by DEC-04                    |
| PROOF-01    | P1       | Design + Web        | Place one decisive product proof beside each major claim.                                                                                           | Use the synthetic preview, Activity receipt, PrivacyBadge, pricing truth, and source-backed comparisons; no fake logos, ratings, or outcomes.                                                                                          | Open                                 |
| DATA-01     | P0       | Data + Web          | Audit the end-to-end funnel event chain and consent gating.                                                                                         | Landing view → CTA/demo → OAuth → preview → action → return → intent → checkout → paid activation → retained workspace is queryable without mailbox content.                                                                           | Open                                 |
| DATA-02     | P0       | Data                | Record a pre-launch baseline and annotate every copy/packaging release.                                                                             | Baseline covers conversion, activation, refunds, cancellations, and 30/60/90-day paid retention by plan/source.                                                                                                                        | Open                                 |
| DATA-03     | P1       | Growth + Data       | Run experiments sequentially in the order in §16.                                                                                                   | One primary variable at a time; retain guardrails; do not call a winner from clicks alone.                                                                                                                                             | Blocked by DATA-01/DATA-02           |
| RESEARCH-01 | P0       | Founder + Research  | Complete the first 15 event-based interviews.                                                                                                       | Five activated, five OAuth/demo non-connectors, five paid/refund/downgrade/cancel participants as cohorts become available; capture exact language and confidence.                                                                     | Open                                 |
| RESEARCH-02 | P2       | Growth              | Replace proxy personas, claims, and plan emphasis with first-party evidence.                                                                        | Minimum five independent supporting observations per segment/claim; permission for any attribution.                                                                                                                                    | Blocked by RESEARCH-01               |
| DOC-01      | P0       | Product             | Record D250/D251 and positioning constraints in ADR/plan/log/follow-up artifacts listed in §5.                                                      | Decision history stays readable; docs and shipped tier truth agree.                                                                                                                                                                    | Open                                 |
| QA-01       | P0       | QA + Copy           | Run a public-copy truth scan against T1–T7.                                                                                                         | Search built output as well as source for universal reversibility, hidden automation, `clean` as a verb on user data, and false Screener blocking.                                                                                     | Open                                 |
| QA-02       | P0       | QA                  | Update string assertions, snapshots, route tests, schema tests, and Storybook stories for every changed surface.                                    | No retired copy/tier assumption remains; new Gmail page and lifecycle states have coverage.                                                                                                                                            | Open                                 |
| QA-03       | P1       | QA + Design         | Verify responsive layout, focus order, screen-reader labels, reduced motion, OG rendering, and localized price consistency.                         | New copy does not truncate or create expectation mismatch; checkout charge matches displayed rail/currency.                                                                                                                            | Open                                 |
| LAUNCH-01   | P0       | Release             | Ship D251 and every dependent copy/gate/test change atomically; deploy copy that does not depend on D251 in a separately reviewable unit if useful. | No interval where Plus is advertised with Screener but denied it, or Pro loses inherited access.                                                                                                                                       | Open                                 |
| LAUNCH-02   | P1       | Product + Data      | Review cohorts at 7, 30, 60, and 90 days.                                                                                                           | Report retained paid conversion, Screener activation, Autopilot activation, refunds, cancel reasons, and support confusion; feed evidence back into copy.                                                                              | Blocked by launch                    |

### 19.1 File-level regression checklist

The exact touched set will depend on which P1 lifecycle items are approved, but these known
source/test clusters must be reconciled. A checked marketing string with a stale gate, API comment,
snapshot, or sitemap entry is not a finished change.

| Cluster                             | Known source and test files to review                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Homepage and shared positioning     | `apps/web/src/features/marketing/landing/{hero,sections,footer,pricing-teaser}.tsx`; `apps/web/src/features/marketing/landing/landing.css`; `apps/web/src/app/(marketing)/page.tsx`; `apps/web/src/app/(marketing)/page.test.tsx`; `apps/web/src/app/opengraph-image.tsx`; `apps/web/src/features/marketing/page-metadata.ts`                                                                  |
| Entry and demo                      | `apps/web/src/features/onboarding/step-promise.tsx`; `apps/web/src/app/onboarding/page.test.tsx`; `apps/web/src/features/marketing/inbox-simulator/inbox-simulator-screen.tsx`; its tests/styles; `apps/web/src/features/marketing/auth-entry/auth-entry.tsx` and test                                                                                                                         |
| D251 manifest and shared assertions | `packages/shared/src/entitlements/pricing.config.ts`; `packages/shared/src/entitlements/entitlements.test.ts`; `packages/shared/src/edge-states/inventory.ts`; `packages/shared/src/edge-states/inventory.test.ts`                                                                                                                                                                             |
| D251 API                            | `apps/api/src/screener/screener.controller.ts`; `apps/api/src/screener/screener.service.ts`; `apps/api/src/screener/screener.service.spec.ts`; `apps/api/src/screener/screener.read-service.spec.ts`; `apps/api/src/common/entitlements/capability.guard.spec.ts`                                                                                                                              |
| D251 Web gate and queue             | `apps/web/src/app/(app)/screener/page.tsx`; `apps/web/src/app/(app)/layout.tsx`; `apps/web/src/app/(app)/layout.test.tsx`; `apps/web/src/features/screener/api/use-screener.ts`; rename `apps/web/src/features/screener/pro-upsell.tsx`; update `screener-screen.test.tsx`, `screener-screen.stories.tsx`, and badge tests where plan access is asserted                                       |
| Pricing and upgrade surfaces        | `apps/web/src/features/marketing/pricing/{pricing-screen,pricing-model,tier-card}.tsx` or `.ts`; pricing tests; `apps/web/src/features/marketing/landing/pricing-teaser.tsx`; `apps/web/src/features/marketing/learn/faq-content.ts`; `apps/web/src/app/(marketing)/help/page.tsx`; `apps/web/src/features/billing/upgrade-modal.tsx` and test; `apps/web/src/features/triage/empty-state.tsx` |
| Comparison content and `/vs/gmail`  | `apps/web/src/features/marketing/comparison/comparison-data.ts` and test; `comparison-screen.tsx` and test; `apps/web/src/app/(marketing)/vs/[competitor]/page.tsx`; `apps/web/src/app/sitemap.ts` and test; `apps/web/src/app/llms-txt.test.ts`; comparison CSS if the new lead needs layout work                                                                                             |
| Blog and changelog                  | `apps/web/src/app/(marketing)/blog/page.tsx`; `apps/web/src/features/marketing/learn/blog-content.ts`; `apps/web/src/features/marketing/learn/changelog-content.ts`; learn-content tests                                                                                                                                                                                                       |
| Cancellation                        | `packages/shared/src/contracts/billing.ts`; billing contract/API tests; `apps/web/src/features/billing/cancel-modal.tsx`; cancel-modal/billing-screen tests and stories; server persistence/reporting for `cancellation_reason`                                                                                                                                                                |
| Value-receipt email infrastructure  | `packages/shared/src/contracts/email-prefs.ts` and test; Settings notification controls; `apps/api/src/notifications/email-prefs.controller.ts` and spec; notification templates/index/snapshots; trigger/worker registration; unsubscribe headers/tokens; delivery/idempotency tests                                                                                                          |
| Cross-surface release coverage      | `packages/e2e/specs/billing-upgrade.spec.ts`; route/sitemap tests; Storybook states; public-copy truth scan; localized Paddle/Razorpay price checks                                                                                                                                                                                                                                            |

---

## 20. Complete before/after content matrix

`After` is the recommended public state. `NEW` means there is no equivalent current content.
`BEHAVIOR` means the copy must not ship until the underlying product change is live. Prices and
limits continue to render from `TIER_MANIFEST`; the strings below must not become duplicate pricing
constants.

### 20.1 Homepage, metadata, demo, and onboarding entry

| Surface / file                                                           | Before                                                                                                                                                                                | After                                                                                                                                                                                                                                                            | Type / dependency                                                                                          |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Hero H1 — `landing/hero.tsx`; homepage tests                             | `Control Gmail by sender, not by email.`                                                                                                                                              | `Clear thousands of emails by sender—without a blind bulk move.`                                                                                                                                                                                                 | COPY; retain `Control Gmail by sender. Nothing moves until you approve it.` only as the named test control |
| SEO title — `app/(marketing)/page.tsx`                                   | `DeclutrMail — Control Gmail by sender, not by email.`                                                                                                                                | `Preview Gmail cleanup by sender — DeclutrMail`                                                                                                                                                                                                                  | COPY                                                                                                       |
| SEO description — `app/(marketing)/page.tsx`                             | `DeclutrMail turns thousands of emails into a handful of sender decisions — with automation, privacy-first indexing, and 7-day Activity Undo for Archive, Later, and Delete on Free.` | `Review Gmail by sender with Keep, Archive, Unsubscribe, Later, and Delete. See the scope before manual mail moves and verify final outcomes in Activity.`                                                                                                       | COPY; fixes Free/automation falsity                                                                        |
| Default OG alt — `app/opengraph-image.tsx`; `marketing/page-metadata.ts` | `DeclutrMail — Control Gmail by sender, not by email.`                                                                                                                                | `DeclutrMail — Clear thousands of emails by sender without a blind bulk move.`                                                                                                                                                                                   | COPY                                                                                                       |
| Default OG main line — `app/opengraph-image.tsx`                         | `Control Gmail by sender, not by email.`                                                                                                                                              | `Clear thousands of emails by sender.` / `Without a blind bulk move.`                                                                                                                                                                                            | COPY + visual check                                                                                        |
| Default OG eyebrow/footer — `app/opengraph-image.tsx`                    | `GMAIL CLEANUP, BY SENDER` / `One sender at a time · preview before mail moves`                                                                                                       | `GMAIL CLEANUP · SCOPE BEFORE MANUAL MOVES` / `Keep · Archive · Unsubscribe · Later · Delete`                                                                                                                                                                    | COPY                                                                                                       |
| Hero kicker — `landing/hero.tsx`                                         | `Gmail cleanup · sender-first`                                                                                                                                                        | `Gmail cleanup · preview before manual moves`                                                                                                                                                                                                                    | COPY                                                                                                       |
| Hero subhead — `landing/hero.tsx`                                        | `DeclutrMail turns thousands of emails into a handful of sender decisions — with automation, privacy-first indexing, and 7-day Activity Undo for Archive, Later, and Delete on Free.` | `Choose Keep, Archive, Unsubscribe, Later, or Delete for each sender. Before manual Archive, Later, or Delete, see the current matches and exact Gmail change; then verify the result in Activity.`                                                              | COPY; explicitly includes sender unsubscribe without implying universal support                            |
| Hero primary CTA — `landing/hero.tsx`                                    | `Connect your Gmail`                                                                                                                                                                  | `Review my Gmail senders` + helper `Opens Google sign-in`                                                                                                                                                                                                        | COPY; destination remains OAuth                                                                            |
| Hero secondary CTA — `landing/hero.tsx`                                  | `Try the demo first`                                                                                                                                                                  | `Try the demo — no sign-in`                                                                                                                                                                                                                                      | COPY                                                                                                       |
| Hero note — `landing/hero.tsx`                                           | `Free tier · no card · preview before mail moves`                                                                                                                                     | `Free · no card · 50 cleanup actions every month`                                                                                                                                                                                                                | COPY; quota rendered from manifest in implementation                                                       |
| Hero ledger caption — `landing/hero.tsx`                                 | `one Archive decision · 412 emails handled · reversible`                                                                                                                              | `one Archive decision · 412 emails · undoable for 7 days`                                                                                                                                                                                                        | COPY; synthetic demo only                                                                                  |
| Payoff H2 — `landing/sections.tsx`                                       | `The cleanup is N decisions. We shrink N.`                                                                                                                                            | `Thousands of emails. A few hundred sender decisions.`                                                                                                                                                                                                           | COPY                                                                                                       |
| Arithmetic labels — `landing/sections.tsx`                               | `Cleaning it email-by-email` / `Cleaning it by sender`                                                                                                                                | `Handled email by email` / `Handled sender by sender`                                                                                                                                                                                                            | COPY; removes `clean` as verb                                                                              |
| Native-alternative section — homepage                                    | NEW                                                                                                                                                                                   | Eyebrow `Why not just Gmail?`; H2 `Gmail can select thousands. The hard part is trusting the selection.`; body and `See the scope` / `Keep the record` / `Keep Gmail as home` proof cards from §11.4                                                             | NEW                                                                                                        |
| Workflow H2 — `landing/sections.tsx`                                     | `Connect. Review. Done.`                                                                                                                                                              | `Find the pattern. See the scope. Make the call.`                                                                                                                                                                                                                | COPY                                                                                                       |
| Workflow steps — `landing/sections.tsx`                                  | `Connect` / `Review` / `Done`, with Pro automation mixed into the completion step                                                                                                     | `Review senders` / `Preview the manual move` / `Verify the result`, using the exact bodies in §11.5                                                                                                                                                              | COPY                                                                                                       |
| Workflow unsubscribe note — homepage                                     | The Ritual explainer says existing mail stays put; no adjacent one-way note in How it works                                                                                           | `A delivered unsubscribe request cannot be recalled; existing mail stays put unless you separately approve another action.`                                                                                                                                      | NEW                                                                                                        |
| Ritual H2 — `landing/sections.tsx`                                       | `Five verbs. One per sender.`                                                                                                                                                         | `Five verbs. See the scope before manual moves.`                                                                                                                                                                                                                 | COPY; keep all five existing verb explainers                                                               |
| Product-tour H2/lede — `landing/sections.tsx`                            | `Three product chapters, not three quota bands.`; Plus only removes the meter                                                                                                         | `Four product chapters. Each earns a different kind of control.`; `Free proves the manual workflow. Plus removes the meter and adds Screener for new senders. Pro adds approved rules for recurring matches. Activity records final outcomes across every plan.` | COPY + BEHAVIOR D251                                                                                       |
| Manual cleanup chapter — homepage                                        | `Triage` chapter                                                                                                                                                                      | `Manual cleanup — All plans`: body from §11.6, explicitly listing Keep, Archive, Unsubscribe, Later, Delete                                                                                                                                                      | COPY                                                                                                       |
| Screener chapter — homepage                                              | NEW                                                                                                                                                                                   | `Screener — Plus and Pro`; `New senders still arrive in Gmail. Screener collects them into a review queue so the decisions do not disappear into the backlog. Review them in a batch when you are ready.`                                                        | NEW + BEHAVIOR D251                                                                                        |
| Autopilot chapter — homepage                                             | `Pro · Automate`; current Observe copy                                                                                                                                                | Keep tier and truth; use §11.6 body ending `completed outcomes appear in Activity.`                                                                                                                                                                              | COPY                                                                                                       |
| Activity chapter — homepage                                              | Current Activity ledger copy                                                                                                                                                          | Use §11.6 body; keep delivered unsubscribe explicitly one-way                                                                                                                                                                                                    | COPY                                                                                                       |
| Persona chooser — homepage                                               | NEW                                                                                                                                                                                   | H2 `Start with the Gmail problem you have today.` + `Years of accumulated mail` / `Cautious about inbox access` / `Two or three Gmail inboxes` cards from §11.7                                                                                                  | NEW                                                                                                        |
| Homepage order — `app/(marketing)/page.tsx`                              | Hero → Problem → How → Ritual → Privacy → Product tour → Gmail companion → Pricing → FAQ → Final                                                                                      | Hero → Payoff → Why Gmail → How → Ritual → compact trust/deep privacy → Product chapters → Gmail companion → Pricing → FAQ → Final                                                                                                                               | STRUCTURE                                                                                                  |
| Final CTA H2/body — `landing/footer.tsx`                                 | `Your inbox is a few hundred decisions away.`; no body                                                                                                                                | `Start with one sender. See the scope before a manual move.` + Free-plan body from §11.8                                                                                                                                                                         | COPY                                                                                                       |
| Final CTA buttons/note — `landing/footer.tsx`                            | `Connect your Gmail`; `Free tier · no card · preview before mail moves`                                                                                                               | `Review my Gmail senders`; `Try the demo — no sign-in`; `Free · no card · 50 cleanup actions every month`                                                                                                                                                        | COPY                                                                                                       |
| Pre-OAuth Promise — `onboarding/step-promise.tsx`                        | Title `Control Gmail by sender, not by email.`; CTA `Connect Gmail →`                                                                                                                 | Title follows chosen H1; CTA `Review my Gmail senders`; helper `Next: Google shows the requested Gmail permission.`                                                                                                                                              | COPY; keep PrivacyBadge unchanged                                                                          |
| Simulator eyebrow — `inbox-simulator-screen.tsx`                         | `Interactive demo · Plus/Pro Triage`                                                                                                                                                  | `Interactive demo · Triage on every plan`                                                                                                                                                                                                                        | COPY; fixes stale tier statement                                                                           |
| Simulator conversion CTAs — `inbox-simulator-screen.tsx`                 | `Run this on your Gmail →` / `Connect Gmail →`                                                                                                                                        | `Review my Gmail senders →` with `Opens Google sign-in`                                                                                                                                                                                                          | COPY                                                                                                       |
| Auth-entry alternate CTA — `auth-entry.tsx`                              | `Try the demo →`                                                                                                                                                                      | `Try the demo — no sign-in →`                                                                                                                                                                                                                                    | COPY; keep `Continue with Google` as the real consent CTA                                                  |

### 20.2 Pricing, packaging, gates, and upgrade moments

| Surface / file                                              | Before                                                                                                                        | After                                                                                                                                                                                                                                      | Type / dependency                                                          |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Entitlement manifest — `pricing.config.ts`                  | Plus = Free + unlimited quota only; Pro adds `autopilot`, `brief`, `screener`, `quiet`, `followups`                           | Plus capabilities include `screener`; Pro inherits Plus and adds `autopilot`, `brief`, `quiet`, `followups`                                                                                                                                | BEHAVIOR D251; prices/quotas unchanged                                     |
| Screener access — API, route, nav badge                     | Free and Plus denied; Pro+ allowed                                                                                            | Free denied; Plus+ allowed; under-tier UI and queries follow the manifest                                                                                                                                                                  | BEHAVIOR D251                                                              |
| Screener upsell — `features/screener/pro-upsell.tsx`        | `Screener · Pro`; `With Pro...`; `See Pro plans`; Free/Plus under-tier explanation                                            | `Screener · Plus`; `With Plus, Screener collects first-time senders for review. They still arrive in Gmail until you decide.`; `See Plus`; Free-only under-tier explanation                                                                | COPY + BEHAVIOR D251; rename component/file                                |
| Pricing H1 — `pricing/pricing-screen.tsx`                   | `Pick how clean you want to stay.`                                                                                            | `Choose the level of control you need.`                                                                                                                                                                                                    | COPY                                                                       |
| Pricing subhead — `pricing/pricing-screen.tsx`              | `Free shows you what’s noisy. Plus adds unlimited manual actions. Pro adds explicit Autopilot rules...` + verb/safety summary | `Start with the full manual workflow. Plus removes the meter and adds a queue for new senders. Pro adds approved future-mail rules, three Gmail inboxes, and 30-day Activity undo.` + `Every paid plan has a 30-day money-back guarantee.` | COPY + BEHAVIOR D251; retain detailed safety in FAQ/compare table          |
| Free job line — `pricing-model.ts`                          | `See what’s noisy.`                                                                                                           | `Prove the workflow on one inbox.`                                                                                                                                                                                                         | COPY                                                                       |
| Plus job line — `pricing-model.ts`                          | `Handle it yourself, unlimited.`                                                                                              | `Finish the backlog. Review what arrives next.`                                                                                                                                                                                            | COPY + BEHAVIOR D251                                                       |
| Pro job line — `pricing-model.ts`                           | `Automate recurring noise with explicit rules.`                                                                               | `Put approved rules to work across your inboxes.`                                                                                                                                                                                          | COPY                                                                       |
| Pricing plan labels — `tier-card.tsx`; `pricing-screen.tsx` | Pro highlighted with `Most popular`                                                                                           | Plus label `For one busy inbox`; Pro label `For recurring, multi-inbox control`; no popularity claim                                                                                                                                       | COPY/DESIGN; experiment emphasis separately                                |
| Landing Pro label — `landing/pricing-teaser.tsx`            | `⭐ recommended`                                                                                                              | `For recurring, multi-inbox control`                                                                                                                                                                                                       | COPY                                                                       |
| Landing Plus bullets — `landing/pricing-teaser.tsx`         | `Unlimited cleanup actions`; `Everything in Free, without the monthly cap`                                                    | `Unlimited cleanup actions`; `Screener — new senders collected for review`                                                                                                                                                                 | COPY + BEHAVIOR D251                                                       |
| Landing Pro bullets — `landing/pricing-teaser.tsx`          | `Everything in Plus, plus automation`; `Autopilot rules, Brief, Screener`                                                     | `Everything in Plus`; `Autopilot, Brief, Quiet Hours, and Follow-ups`                                                                                                                                                                      | COPY + BEHAVIOR D251; reflect actual manifest                              |
| Pricing reassurance — below cards                           | NEW                                                                                                                           | `Only need occasional cleanup? Stay on Free. Upgrade when the monthly meter interrupts useful work, when you want a standing queue for new senders, or when approved rules and multiple inboxes will keep earning their place.`            | NEW                                                                        |
| Pricing FAQ: plan choice                                    | Existing generic plan answer only                                                                                             | Add `Which plan should I choose?` answer from §12.4                                                                                                                                                                                        | NEW + BEHAVIOR D251                                                        |
| Pricing FAQ: recurring Plus value                           | NEW                                                                                                                           | Add `Why is Plus recurring after I finish the backlog?` answer from §12.4                                                                                                                                                                  | NEW + BEHAVIOR D251                                                        |
| Pricing FAQ: manual vs automation                           | Existing FAQ covers Archive/future routing, not the upgrade misconception directly                                            | Add `Does upgrading make manual cleanup automatic?` answer from §12.4                                                                                                                                                                      | NEW                                                                        |
| Pricing FAQ: undo                                           | Existing Help/FAQ answer                                                                                                      | Keep the truth and add the compact `Can I undo every action?` pricing answer from §12.4                                                                                                                                                    | NEW/REUSE                                                                  |
| Public FAQ plan answer — `learn/faq-content.ts`             | Plus only removes meter; Pro automation set includes Screener                                                                 | Plus removes meter and adds Screener; Pro adds three inboxes, 30-day undo, Autopilot, Brief, Quiet, Follow-ups                                                                                                                             | COPY + BEHAVIOR D251                                                       |
| Help plan answer — `app/(marketing)/help/page.tsx`          | Plus only removes cap; Pro adds automation/inboxes/undo                                                                       | Plus removes cap and adds Screener; Pro adds approved automation set, inboxes, and undo; retain Delete Trash caveat                                                                                                                        | COPY + BEHAVIOR D251                                                       |
| Free-cap modal — `billing/upgrade-modal.tsx`                | `Plus unlocks unlimited cleanup... Pro could do this automatically...`                                                        | `Plus unlocks unlimited cleanup and Screener for new-sender review for {price}. Pro adds approved future-mail rules, Daily Brief, Quiet Hours, and up to three inboxes for {price}.`                                                       | COPY + BEHAVIOR D251; preserve actual reset date/localized price           |
| Triage near-cap nudge — `triage/empty-state.tsx`            | `Plus removes the cap — unlimited archive, delete, and unsubscribe.`                                                          | `Plus removes the cap and adds Screener for new-sender review.`                                                                                                                                                                            | COPY + BEHAVIOR D251                                                       |
| Plus→Pro nudge — `triage/empty-state.tsx`                   | `Pro could do this for you automatically. Learn more →`                                                                       | `Want approved rules for future matches? See Pro →`                                                                                                                                                                                        | COPY; avoids implying the current manual action silently becomes automatic |

### 20.3 Comparisons and public educational content

| Surface / file                                     | Before                                                                                               | After                                                                                                                                                                                                                                                                                                                                  | Type / dependency                     |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Comparison hub H1 — `comparison-screen.tsx`        | `Email cleanup tools solve different problems.`                                                      | `Compare the way each tool handles the decision—not just the feature list.`                                                                                                                                                                                                                                                            | COPY                                  |
| Comparison hub subhead — `comparison-screen.tsx`   | `DeclutrMail is a sender-first Gmail cleanup companion...`                                           | `DeclutrMail is a Gmail-specific companion for explicit sender decisions, supported unsubscribe, manual-move previews, and an Activity record. The broader or simpler option is sometimes the better fit; every comparison says when.`                                                                                                 | COPY                                  |
| Comparison final CTA — `comparison-screen.tsx`     | `Connect Gmail`; `See every tier`                                                                    | `Review my Gmail senders`; `Try the demo — no sign-in`; retain Free quota/privacy facts                                                                                                                                                                                                                                                | COPY                                  |
| `/vs/gmail`                                        | NEW; only `/vs/gmail-filters` exists                                                                 | Full page from §13.2: title `DeclutrMail vs Gmail for bulk cleanup`; H1 `Gmail already manages subscriptions. DeclutrMail handles the harder bulk decisions.`; explicitly place supported unsubscribe beside Keep/Archive/Later/Delete                                                                                                 | NEW                                   |
| Clean Email lead — `comparison-data.ts`            | `Choose between a broad smart-folder cleanup suite and a focused, sender-first Gmail ritual.`        | `Choose breadth—or deliberate Gmail control.` Summary: Clean Email is broader; DeclutrMail is narrower when manual-move scope, defined Activity undo, and restrained data boundary matter more                                                                                                                                         | COPY                                  |
| Trimbox lead — `comparison-data.ts`                | `Choose between fast newsletter opt-outs and a broader sender-by-sender Gmail control surface.`      | `One-click unsubscribe—or a complete sender decision workflow.` Summary: Trimbox is simpler for opt-out/past-mail deletion; DeclutrMail adds supported unsubscribe, Keep, Archive, Later, Delete, manual-move previews, and Activity                                                                                                   | COPY                                  |
| SaneBox lead — `comparison-data.ts`                | `Choose between learned importance sorting for incoming mail and an explicit sender cleanup ritual.` | `Learned sorting—or explicit Gmail cleanup.` Summary from §13.3                                                                                                                                                                                                                                                                        | COPY                                  |
| Leave Me Alone lead — `comparison-data.ts`         | `Choose between subscription-focused control and a wider set of Gmail sender outcomes.`              | `Subscription control—or a wider Gmail sender workflow.` Summary: `Leave Me Alone specializes in unsubscribe, Rollups, and Inbox Shield across providers. DeclutrMail includes supported unsubscribe within a broader Gmail workflow—Keep, Archive, Later, and Delete—with scope previews and Activity records for manual mail moves.` | COPY; addresses unsubscribe ambiguity |
| Gmail filters lead — `comparison-data.ts`          | `Choose between native rule-building and a guided, ranked sender cleanup workflow.`                  | `Native rule power—or a guided decision workflow.` Summary from §13.3                                                                                                                                                                                                                                                                  | COPY                                  |
| Journal metadata — `app/(marketing)/blog/page.tsx` | `DeclutrMail Journal — sender-first Gmail cleanup`                                                   | `DeclutrMail Journal — previews, undo, and the limits of bulk email`                                                                                                                                                                                                                                                                   | COPY                                  |
| Sender thesis article — `learn/blog-content.ts`    | Positions sender-first grouping as the thesis; already separates current mail and future mail        | Keep title/URL; add a paragraph: sender grouping compresses the work, while preview and an Activity record make the resulting bulk action trustworthy                                                                                                                                                                                  | COPY; preserve SEO asset              |
| Changelog                                          | No repositioning/D251 entry                                                                          | Add dated entry naming the new public promise and Screener’s move to Plus                                                                                                                                                                                                                                                              | NEW + BEHAVIOR D251                   |
| How-to/answer page conversion blocks               | Route-specific related links such as `Try the sender-first method` / `Run a sender-first pass`       | Keep query-bearing content; conversion block: `Review the sender pattern on a synthetic inbox.` CTAs `Try the demo — no sign-in` and `Review my Gmail senders`                                                                                                                                                                         | COPY only at CTA blocks               |

### 20.4 In-product activation, value receipts, and cancellation

| Surface / file                                                       | Before                                                                                                                                       | After                                                                                                                                                                                                                                                               | Type / dependency                                                                                             |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| First live review framing — `onboarding/step-first-triage.tsx`       | Goal-specific intro: `We'll guide you through up to five real sender decisions...`                                                           | Heading `Start with one sender you already recognize.` Body `Open the preview to see the current matches and exact Gmail change. If you choose manual Archive, Later, or Delete, nothing moves until you approve the preview.` Keep goal-specific sentence below it | COPY                                                                                                          |
| First-session completion — `step-first-triage.tsx`                   | `You're done for today.` + a general decision count and safety explanation                                                                   | `{affectedCount} messages {actionPastTense} from {Gmail location}.` + `This result is in Activity and can be undone there for {undoWindowDays} days on your current plan.`                                                                                          | COPY + data binding; action-specific, not used for Unsubscribe unless the one-way result has its own template |
| Empty first session — `step-first-triage.tsx`                        | `Nothing needs your attention.`                                                                                                              | Keep; it is truthful and appropriately calm                                                                                                                                                                                                                         | KEEP                                                                                                          |
| Free quota encounter — `billing/upgrade-modal.tsx` and related state | Reset date + upgrade pitch, with limited preserved-value framing                                                                             | Heading `You have used this month's cleanup actions.` Body from §14.2; CTAs `View Activity` / `Compare Plus`                                                                                                                                                        | COPY + BEHAVIOR D251 for Screener sentence                                                                    |
| Email preference model — shared contract, Settings, worker           | Toggleable categories are `reminders` and `syncComplete`; no value-receipt category exists                                                   | Add an explicitly named value-receipt category and control; classify Plus/Pro receipts as opt-out-able relationship email with in-body and header unsubscribe                                                                                                       | BEHAVIOR + DEC-04; do not silently reuse an existing preference                                               |
| Plus weekly value cue                                                | NEW                                                                                                                                          | Subject `{N} new senders are ready for review`; body/CTA from §14.3                                                                                                                                                                                                 | NEW + notification preferences + D251                                                                         |
| Pro monthly value receipt                                            | NEW                                                                                                                                          | Subject `Your approved rules handled {N} matches this month`; body/CTA from §14.4                                                                                                                                                                                   | NEW + notification preferences                                                                                |
| Cancellation reasons — shared contract + `cancel-modal.tsx`          | `Not using it enough`; `Too expensive`; `Found another tool`; `Privacy concerns`; `Other`                                                    | Add `The backlog is handled`; retain existing reasons and optional/skip behavior                                                                                                                                                                                    | BEHAVIOR + COPY                                                                                               |
| Cancellation base preview — `cancel-modal.tsx`                       | Exact period-end, resulting Free state when applicable, pause offer where supported, optional reason, `Keep my plan` / `Cancel subscription` | Keep base preview and easy exit. Add only one reason-relevant alternative below it                                                                                                                                                                                  | KEEP + NEW conditional block                                                                                  |
| Cancel: backlog handled                                              | No targeted treatment                                                                                                                        | `Free may be enough for occasional maintenance. It keeps the manual workflow with 50 cleanup actions every month.` CTAs `Move to Free` / `Continue cancelling`                                                                                                      | NEW; requires a truthful downgrade path or use `Continue cancelling` only                                     |
| Cancel: not using enough                                             | Generic pause offer, if provider supports it                                                                                                 | `Move to Free and keep the manual workflow for occasional cleanup. Your existing Gmail state does not depend on keeping a paid subscription.` Keep pause only when supported and relevant                                                                           | NEW; no dark pattern                                                                                          |
| Cancel: feature missing                                              | `Other` only; no targeted feedback                                                                                                           | `Tell us what is missing. This does not delay cancellation, and we will not promise a roadmap date we cannot meet.`                                                                                                                                                 | NEW; optional feedback                                                                                        |
| Cancel: too expensive                                                | Generic pause offer                                                                                                                          | No automatic discount. Show Free fit or supported pause only; collect reason and continue cancellation                                                                                                                                                              | POLICY/COPY; revisit only with retention evidence                                                             |
| Final cancellation confirmation                                      | Current preview states feature end and Free transition; Autopilot/undo consequences are not fully enumerated                                 | State exact access end, what happens to Active Autopilot rules, remaining Activity undo deadline, and resulting tier from live billing/entitlement state                                                                                                            | COPY + backend discovery                                                                                      |

### 20.5 Internal docs, analytics, tests, and non-copy release work

| Surface                     | Before                                                                                                    | After                                                                                                                                           | Type           |
| --------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| Positioning decision record | D223 and current docs still lock the retired sender-only headline                                         | New ADR plus D250 reversal history and D251 tier decision; cross-references and implementation log updated                                      | DOC            |
| Funnel measurement          | Individual events exist, but no verified end-to-end retained-revenue baseline is established in this spec | Consent-safe funnel in §16 is queryable and baselined; releases annotated; 30/60/90-day retention segmented by plan/source                      | DATA           |
| Copy truth enforcement      | Shared safety string has a narrow test; marketing surfaces can still make false universal claims          | Add built-output/source checks for T1–T7 plus focused tests for headline, plan copy, one-way unsubscribe, and Screener soft-quarantine language | QA             |
| D251 regression coverage    | Tests/comments pin Screener as Pro-only in shared, API, Web, Storybook, and e2e                           | Tests pin Free denied and Plus+ allowed; derived pricing and nav badge follow the manifest                                                      | QA + BEHAVIOR  |
| Evidence system             | No first-party testimonials or outcome claims; synthetic demo and exact product proof already exist       | Launch with product proof only; add attributed proof after permission and reproducible measurement                                              | RESEARCH/PROOF |

### 20.6 Explicitly unchanged anchors

These are intentionally excluded from the rewrite even though they sit beside changed content:

| Keep                                                                                          | Reason                                                                                     |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `Full bodies fetched: 0` and the complete PrivacyBadge field inventory                        | Locked, specific, and stronger than vague privacy adjectives                               |
| Canonical verbs `Keep · Archive · Unsubscribe · Later · Delete` and their current definitions | They accurately describe the feature set; Unsubscribe remains a first-class sender outcome |
| `Continue with Google` on the actual OAuth entry                                              | It accurately names the external action; value-led CTA is used before this step            |
| Gmail as the place to read, reply, search content, inspect threads, and verify mailbox state  | Core companion positioning                                                                 |
| Prices, quotas, inbox limits, refund terms, and undo windows                                  | Continue rendering from the manifest and approved policy; this project does not reprice    |
| Legal pages and the core privacy/security disclosures                                         | Factual and compliance-bearing                                                             |
| Keyword-bearing how-to and answer page titles/URLs                                            | Preserve search intent; only conversion blocks change                                      |
| Manual/current-mail versus Pro/future-rule separation                                         | Non-negotiable product truth                                                               |
| Delivered unsubscribe is one-way and existing mail stays put                                  | Non-negotiable product truth                                                               |
| Delete's Activity undo versus separate Gmail Trash recovery                                   | Non-negotiable product truth                                                               |
