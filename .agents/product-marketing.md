# Product Marketing Context

**Document version:** v3
**Last updated:** 2026-10-13 (live public pricing and current manifest reviewed)
**Evidence posture:** pre-customer. Product claims are repository-backed; audience language and
personas are provisional hypotheses based on founder usage, public problem-space discussions, and
competitor positioning. Replace proxy evidence with first-party interviews, conversion data, and
churn reasons as soon as they exist.

## Product Overview

**One-liner:** DeclutrMail is a Gmail cleanup companion for people who want to act on years of mail
in bulk without taking a blind leap.

**What it does:** DeclutrMail groups Gmail mail by sender, shows the current matching count and the
planned Gmail changes before a manual bulk move, and records final outcomes in Activity. Manual
Archive, Later, and Delete have a 30-day Activity undo window on every tier. Plus includes preset future-mail rules: preview first, then choose Act now or Watch first.

**Product category:** Gmail cleanup and email-management software.

**Product type:** Self-serve consumer/prosumer SaaS. Gmail remains the reader and composer;
DeclutrMail is a companion control surface.

**Business model:** Free includes 1,000 emails cleared per month for one Gmail inbox, with
unlimited Unsubscribe, Keep, and Later. Backlog Pass is $19 once for 30 days of unlimited cleanup
in one Gmail inbox. Plus is $59/year for up to two Gmail inboxes, with unlimited cleanup,
Screener, Autopilot, and Quiet Hours. Pro is coming and is not currently purchasable; do not
advertise its planned features, five-inbox limit, former monthly prices, or founding offer as
available. The Activity undo window is 30 days on every plan for supported manual moves.
Authority: `packages/shared/src/entitlements/pricing.config.ts` and the live `/pricing` page,
checked 2026-10-13. Prices are published USD base prices; checkout confirms taxes and discounts.
The catalog's version identifier is not a launch date.

## Target Audience

**Primary segment:** Long-tenure personal Gmail owners with roughly 20,000–150,000 messages and
hundreds or thousands of recurring senders. They have stopped believing that email-by-email inbox
zero is sustainable and hesitate to use a bulk action when the scope is hard to verify.

**Secondary segment:** Professionals, founders, and independent workers maintaining two or three
Gmail accounts who want one explicit cleanup method and a durable record across them.

**Primary use case:** Reduce a large existing Gmail backlog by sender while retaining control over
what moves and a recovery path for reversible actions.

**Jobs to be done:**

- When years of mail have accumulated, help me make meaningful progress without losing something
  important.
- When new sender patterns keep rebuilding the backlog, give me a small review queue or explicitly
  approved rule instead of another invisible pile.
- When I act in bulk, show me what the action covers and leave me a record I can inspect later.
- When I manage several Gmail accounts, let me apply the same deliberate workflow without merging
  the accounts or replacing Gmail.

**Use cases:**

- Storage warning or a backlog in the thousands.
- A long-lived personal address full of promotions, notifications, receipts, and dormant senders.
- A failed inbox-zero reset where native search and select-all felt too coarse.
- Weekly new-sender review on Plus.
- Previewed recurring-mail handling on Plus; up to two separate Gmail inboxes. Pro is coming.

## Persona Hypotheses

These are segmentation hypotheses, not demographic characters. Do not present them as validated
personas until each has at least five independent first-party data points.

| Segment                | Trigger and job                                                                                 | Main anxiety                                                                   | Best initial message                                                                            | Likely plan                                                            |
| ---------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Backlog owner          | A storage warning or years of accumulated mail creates urgency; wants a large, safe first pass  | Accidentally deleting receipts, account records, or personal mail              | Clear years of Gmail clutter with the scope visible first                                       | Free to prove value; Backlog Pass to finish; Plus for recurring review |
| Control-first skeptic  | Has avoided cleanup tools because inbox access and opaque bulk actions feel worse than the mess | What the product reads, what will move, and whether a mistake can be recovered | Exact preview, **"We never fetch or store full email contents."**, Activity record, scoped undo | Free or Plus                                                           |
| Multi-inbox maintainer | Personal, work, and an older/project Gmail account all accumulate recurring noise               | Separate accounts, inconsistent rules, missed mail, and opaque automation      | One deliberate workflow across up to two Gmail inboxes; rules offer Act now or Watch first      | Plus                                                                   |

## Problems & Pain Points

**Core problem:** The user cannot confidently review and change a large Gmail backlog in bulk.
Native Gmail makes searching and selecting possible, but a high-consequence action can still feel
like a blind leap.

**Why alternatives fall short:**

- Gmail Manage subscriptions solves mailing-list opt-out, not the wider Archive/Later/Delete job.
- Gmail search and filters are powerful but ask the user to know the criteria and maintain the
  rule plumbing.
- Broad cleanup suites offer more providers and more automation, but breadth is not the same as an
  explicit current-scope preview plus a 30-day Activity undo window on every tier.
- One-click unsubscribe extensions solve a narrower job and make sender-level cleanup close to a
  commodity.
- Doing nothing avoids immediate risk but lets the backlog and anxiety compound.

**What it costs them:** Repeated manual passes, storage pressure, time spent reconstructing Gmail
queries, missed important mail, and a backlog that becomes emotionally easier to ignore than fix.

**Emotional tension:** Relief versus regret. The user wants the satisfying progress of a bulk
action without the fear that an important message disappeared with the junk.

## Competitive Landscape

**Primary alternative — Gmail itself:** Manage subscriptions now groups active subscriptions and
supports unsubscribe. Search, filters, labels, archive, and bulk delete are already native and
included. DeclutrMail must therefore sell guided scope, recovery, auditability, and cross-account
control—not the existence of a sender list.

**Direct — Clean Email:** A broad, mature, multi-provider suite with Smart Folders, Auto Clean,
Screener, unsubscribe, action logs, and substantial public proof. Best for breadth. DeclutrMail is
the narrower Gmail-specific option for users who prefer explicit decisions, a live manual-move
preview, and a restrained data boundary.

**Direct — Trimbox:** A simple Gmail-adjacent unsubscribe and past-mail deletion product with a
strong on-device privacy claim and large public usage proof. Best when the only job is mailing-list
cleanup. DeclutrMail covers more sender outcomes and a durable Activity workflow.

**Secondary — SaneBox:** Continuous learned importance sorting across providers. Best when the
primary job is incoming-mail prioritization. DeclutrMail should not compete on importance
prediction; it is for explicit Gmail cleanup and approved rules.

**Secondary — Leave Me Alone:** Subscription control, Rollups, Screener, and multi-provider support,
including a one-off seven-day cleanup pass. Best for subscription-focused control. DeclutrMail
serves all recurring sender types and makes Archive/Later/Delete scope and recovery first-class.

**Indirect:** Gmail filters, Gemini cleanup commands, manual search-and-select, switching email
clients, paying for more storage, or ignoring the backlog.

**Current primary sources:** [Gmail Manage subscriptions](https://support.google.com/mail/answer/15621070) ·
[Clean Email features](https://clean.email/features) · [Trimbox](https://www.trimbox.io/) ·
[SaneBox pricing](https://www.sanebox.com/pricing) ·
[Leave Me Alone pricing](https://leavemealone.com/pricing/). Re-verify mutable feature and pricing
claims before every comparison-page release.

## Differentiation

**Key differentiators:**

- A live current-scope preview before manual Archive, Later, or Delete moves mail.
- An Activity record of final outcomes with a 30-day undo window on every tier for
  manual Archive, Later, and Delete.
- The locked, schema-backed privacy claim: **"We never fetch or store full email contents."**
- Explicit Keep, Archive, Unsubscribe, Later, and Delete decisions in Gmail terms.
- Plus rules offer Act now or Watch first after a preview and explicit enable step.
- Up to two separate Gmail inboxes on Plus without replacing Gmail; Pro is coming.

**How it is different:** The product does not ask the user to surrender judgment to a classifier or
move into a replacement inbox. It reduces the unit of review to a sender, exposes the effect of a
manual move, executes against Gmail, and leaves an audit trail.

**Why that is better:** The buyer gets visible progress with lower perceived risk and can continue
using Gmail as the source of truth.

**Position to own:** Deliberate bulk cleanup for Gmail—progress without the blind leap.

## Objections

| Objection                                          | Response                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Why pay when Gmail can unsubscribe or bulk-delete? | Use Gmail for native unsubscribe and known searches. Use DeclutrMail when the hard part is discovering sender patterns, seeing the scope of a manual move, recording the outcome, and recovering reversible actions over days instead of seconds.                                                                                |
| Why should I grant inbox access?                   | Show the exact field boundary before OAuth. The locked public badge is **"We never fetch or store full email contents."**; full/raw bodies and attachments are not fetched. Be equally explicit that subject and Gmail's short preview snippet are stored where the product contract says so.                                    |
| Could this delete something important?             | The user sees the current count, an available sample, and the planned Gmail change before manual Archive, Later, or Delete. Those actions have Activity undo while the 30-day window is open and the messages remain recoverable; Delete also has a separate Gmail Trash recovery path. Never imply unsubscribe can be recalled. |
| Does one Archive decision create a future rule?    | No. Manual actions cover the current messages in the approved scope at the moment they run; Delete can include archived mail when explicitly selected. Future-mail handling is a separate Autopilot feature on Plus with a preview and explicit Act now or Watch first choice.                                                   |
| Why keep paying after the backlog is gone?         | Plus earns renewal through useful new-sender review and explicitly approved recurring-mail rules. Plus supports two inboxes. Pro is coming. If cohorts do not use those standing jobs, copy cannot repair the packaging.                                                                                                         |

**Anti-personas:**

- Someone who only needs the occasional Gmail-native unsubscribe.
- Someone who wants a free one-click permanent purge with no review.
- Someone who needs Outlook, iCloud, Yahoo, or general IMAP support.
- Someone seeking message-body search, summaries, reply drafting, or automatic importance ranking.
- A team buyer until the Team product, admin controls, support model, and pricing are real.

## Switching Dynamics

**Push:** Storage warning, an embarrassing missed message, a failed manual cleanup, thousands of
unread messages, several Gmail accounts, or a backlog that returned after the last reset.

**Pull:** Sender-sized decisions, visible manual-move scope, Activity undo, a clear Gmail companion
model, and a verifiable data boundary.

**Habit:** Gmail is already open, native search is free, the user knows the mess, and doing nothing
has no immediate switching cost.

**Anxiety:** OAuth access, accidental deletion, hidden future rules, unclear unsubscribe behavior,
another subscription for a one-time job, and whether the product will still be needed next month.

## Customer Language

There is no first-party customer language yet. The following problem-space phrases are proxy
evidence and must not be presented as DeclutrMail testimonials:

- “I don't want to have to manually archive 700 pages.” —
  [public r/Gmail discussion](https://www.reddit.com/r/GMail/comments/1u0p5pk/best_way_to_cleanup_massive_inboxes/),
  2026-06
- “without accidentally deleting anything important” —
  [public r/Gmail discussion](https://www.reddit.com/r/GMail/comments/1u0p5pk/best_way_to_cleanup_massive_inboxes/),
  2026-06
- “I have 10's of thousands I want to delete quickly.” —
  [public r/Gmail discussion](https://www.reddit.com/r/GMail/comments/1jx339o/), 2025-04
- “I want my email back.” —
  [public r/Gmail discussion](https://www.reddit.com/r/GMail/comments/1k9u750/), 2025-04
- “I'm getting overwhelmed.” —
  [public multi-account r/Gmail discussion](https://www.reddit.com/r/GMail/comments/1t3u1cx/how_do_i_merge_multiple_10_gmail_and_google/),
  2026-05
- “without toggling tabs, forwarding or clogging one mail account” —
  [public r/Gmail discussion](https://www.reddit.com/r/GMail/comments/11nu2z5/), 2023-03

**Words and phrases to use:** Gmail cleanup; years of mail; thousands of emails; sender; preview;
matching count; exact Gmail changes; approve; Activity; undo window; existing mail; future rules;
Observe; review; Gmail stays home; one inbox / two inboxes.

**Words and phrases to avoid:** inbox zero as the sole aspiration; sender-first as the sole
differentiator; safe without explaining why; privacy-first; clean as a verb on user data; AI magic;
supercharged; nuke; destroy; blast; obliterate; smart or intelligent as standalone adjectives;
AI-powered as a standalone claim; every action is reversible; blocks or prevents new senders;
never reads your email; automatic importance ranking.

**Glossary:**

| Term                 | Meaning                                                                                                                                         |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Cleanup action       | A user-approved sender action. The Free quota counts emails cleared by Archive or Delete; Later, Unsubscribe, Keep, and Unarchive are unlimited |
| Manual move          | Archive, Later, or Delete applied to matching Gmail messages at execution time; not a future-mail rule                                          |
| Activity undo        | DeclutrMail's 30-day undo on every tier for manual Archive, Later, and Delete while its window is open                                          |
| Gmail Trash recovery | Separate recovery for Delete, normally up to 30 days unless Trash is emptied sooner                                                             |
| Screener             | A review queue for new senders; they still arrive in Gmail                                                                                      |
| Observe              | A rule state on Plus that records matches without acting                                                                                        |
| Active               | A rule state on Plus enabled by the user to act on future matches                                                                               |

## Brand Voice

**Tone:** Calm, exact, premium, and reassuring without being soft or cute.

**Style:** Short sentences, concrete nouns, familiar Gmail language, visible limitations, restrained
claims, and product proof adjacent to the claim it supports.

**Personality:** Deliberate, composed, transparent, technically credible, quietly confident.

## Proof Points

**Product-backed proof:**

- **"We never fetch or store full email contents."** from the shared schema-backed privacy contract.
- 1,000 emails cleared per month on Free; unlimited Unsubscribe, Keep, and Later.
- 30-day Activity undo for supported manual Archive, Later, and Delete on every tier; Delete also requires mail to remain in Gmail Trash.
- Up to two Gmail inboxes on the purchasable Plus plan; Pro is coming.
- Mandatory scope preview before manual mail-moving actions.
- Preview before enabling preset Autopilot rules; Watch first is optional.
- Source-backed competitor comparison pages.
- Interactive synthetic inbox demo that does not require mailbox access.
- 14-day money-back on any purchase, once per customer. (`pricing.refundLine`, `POLICY.refundWindowDays`)

**Not available:** Paid-customer count, testimonials, logos, review score, measured hours saved,
measured email reduction, conversion rate, retention rate, churn reasons, or win/loss interviews.
Never fabricate them or turn founder/mailbox data into customer proof.

**Value themes:**

| Theme            | Proof                                                                                    |
| ---------------- | ---------------------------------------------------------------------------------------- |
| Progress         | Sender-sized decisions and visible matching counts                                       |
| Control          | Manual-move preview, explicit approval, previewed rules with optional Watch first        |
| Recovery         | Activity undo for reversible actions and a separate Gmail Trash recovery explanation     |
| Privacy boundary | **"We never fetch or store full email contents."** plus the exact stored-field inventory |
| Continuity       | Gmail remains the reader, composer, and final mailbox source of truth                    |

## Goals

**Business goal:** Generate sustainable paid revenue: increase qualified Gmail connections,
Free-to-Backlog Pass/Plus conversion, paid activation, and retained paid cohorts without using misleading
claims or dark patterns.

**Unsubscribe boundary:** Standards-based one-click requests are submitted; mailto-only requests open a prepared Gmail draft the user sends. Sender compliance is not guaranteed. Existing email stays unless Archive/Delete is separately selected and previewed.

**Primary conversion action:** Connect one Gmail account and complete the first previewed cleanup
action. The public demo is the lower-friction secondary action.

**Revenue jobs by plan:** Free proves the workflow; Backlog Pass finishes a one-time reset; Plus funds recurring review with up to two inboxes, Screener, Autopilot, and Quiet Hours. Pro is coming.

**Current metrics:** No verified conversion, ARPU, activation, retention, or churn baseline is recorded in this document. Re-query first-party data before publishing customer counts. Instrument separately: landing CTA, demo completion, OAuth completion, first preview,
first successful action, quota encounter, pricing intent, checkout success, Screener weekly use,
Autopilot activation, multi-inbox connection, 30/60/90-day paid retention, cancellation reason,
and involuntary churn.

## Changelog

- v3 (2026-10-13) — Refreshed purchasable plans against live public pricing: Free email quota, $19 Backlog Pass, $59/year Plus with two inboxes, and Pro coming. Removed former prices and availability claims from active positioning.

- v2 (2026-09-22) — Current branch packaging (five Pro inboxes, Plus Screener, uniform 30-day undo), precise unsubscribe/recovery boundaries, and separation of repository evidence from live rollout.

- v1 (2026-08-01) — Initial context for the preview-led repositioning, provisional audience
  segments, competitor frame, D251 packaging direction, revenue goal, and truth constraints.
