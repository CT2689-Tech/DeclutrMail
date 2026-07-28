# Resend email surface — design

**Date:** 2026-07-27
**Status:** Approved (design); implementation plan pending
**Touches:** D6, D162, D165, D189, D225, D226, D245
**Privacy posture:** unchanged — see §7

---

## 1. Why

DeclutrMail's transactional email pipeline is structurally sound but
narrow. Four templates exist; the send path omits every header a
production sender is expected to set; and two planned artifacts (the
weekly value receipt, the re-engagement sequence) were never built.

This arc widens the surface to twelve templates, adds RFC 8058 one-click
unsubscribe, and ships D189's Weekly Value Receipt — without changing
what leaves the database.

## 2. What exists today

| Kind                 | Trigger                                | Opt-out key    |
| -------------------- | -------------------------------------- | -------------- |
| `sync-complete`      | `mailbox.sync_ready` outbox event      | `syncComplete` |
| `sync-reminder-24h`  | +24h delayed; skipped if user returned | `reminders`    |
| `deletion-scheduled` | deletion scheduled                     | none (system)  |
| `deletion-receipt`   | purge complete                         | none (system)  |

Infrastructure that this design builds on unchanged:

- `EmailSendWorker` (`batchPolicy`, D225) resolves recipient, opt-out,
  and "did the user return" at **execution** time, not enqueue time.
- `idempotencyKey` doubles as BullMQ `jobId` and the Resend
  `Idempotency-Key` header.
- `EmailService` fails **closed** without `RESEND_API_KEY` — a typed
  `disabled` outcome that dead-letters on attempt 1. Never a
  pretend-send.
- `EmailSuppressionService` consulted before every send.
- Resend webhook verifies signatures and suppresses on
  `email.bounced` / `email.complained`.

## 3. Decisions locked this session

| Question        | Decision                                                             | Rationale                                                                                                                       |
| --------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Which digest    | **D189 Weekly Value Receipt only**                                   | D61's Brief digest would ship sender names + subjects to Resend — a new Gmail-data sub-processor. Out of scope by founder call. |
| Template format | **React Email** (`@react-email/components`)                          | D162's literal tooling choice.                                                                                                  |
| Gap coverage    | **All four** (unsubscribe headers, reconnect, sync-failed, waitlist) |                                                                                                                                 |
| Email analytics | **Delivery only, no open beacon**                                    | An open-tracking pixel sits badly against the product's own privacy claim. Delivery answers the operational question.           |
| D189 trust line | **Derive from undo data**                                            | A hard-coded `0` is an unfalsifiable claim in the one artifact whose job is being believed.                                     |
| Resend key      | **Keep** (founder decision 2026-07-10)                               | Re-raised in error this session; ledger amended.                                                                                |
| DMARC           | **Stay `p=none`**                                                    | SPF + DKIM verified; enforcement before reading aggregate reports risks quarantining our own mail.                              |

**Scope widened later the same day.** The founder pulled the deferred
items back in, except D61's digest, open tracking, DMARC enforcement,
and key rotation:

| Question           | Decision                | Rationale                                                                                                   |
| ------------------ | ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| D126 P3 sequence   | **In** — Days 3/7/14/30 | Counts-only content keeps it inside the privacy posture (§9.1).                                             |
| D189 in-app card   | **In** — §8.6           | Same `payload` as the email, so the two surfaces cannot disagree.                                           |
| `Reply-To`         | **In, env-gated**       | Code lands now; header activates when `EMAIL_REPLY_TO` is set. Never ships bouncing.                        |
| Pause-initiation   | **In, Paddle-only**     | Day 30 has no destination without it. Added via the existing `BillingProvider` seam, not bespoke endpoints. |
| Tracking-layer fix | **In** — §11            | `generate-impl-log` silently destroys all D-tracking state; found while checking log-row editability.       |

## 4. Architecture

### 4.1 Template layer

Templates move to `.tsx` under `apps/api/src/notifications/templates/`,
each exporting a typed pure function returning
`{ subject, text, html }`. **The plain-text alternative is
hand-written per template, not derived from the HTML** — the result is
genuine multipart, so a text-preferring client gets the calm voice
rather than a tag-stripped approximation.

`apps/api/tsconfig.json` gains `"jsx": "react-jsx"`.
`moduleResolution: "Bundler"` (already set in `tsconfig.base.json`)
resolves `.tsx` without extension gymnastics.

**Step 1 is a spike, not a template.** Prove `@swc-node/register`
loads `.tsx` under this ESM setup before anything is built on top of
it. If it fights, fall back to templates in `packages/shared` (React
19 is already a dependency there) rendered to strings.

`packages/workers` stays React-free. It already receives renderers as
injected ports — `renderReceiptEmail: deletionReceiptEmail`
(`apps/api/src/worker.ts:1741`). That seam is what makes this clean:
the port's return type widens by one field and becomes async
(`@react-email/render`'s `render()` returns a Promise).

### 4.2 Contract changes

- `EmailSendJobData` gains `html?: string`.
- `EmailDeliveryPort.deliver()` gains `html?`.
- `EmailService` passes `html` alongside `text` when present → Resend
  sends multipart; text-only when absent.
- `EmailService` gains a `headers` parameter for List-Unsubscribe.

`html` is **optional**, not required — five of the twelve templates are
plain-text-locked by plan decisions (§4.4). A required field would
force those five to carry an HTML body the plan forbids.

Job payloads grow ~8–15KB in Redis. Acceptable at this volume; noted
so it isn't a surprise in a future queue-sizing review.

### 4.3 Design constraint carried from the codebase

`recipientOverride` currently has exactly one sanctioned caller (the
D232 deletion receipt, whose user row is deliberately gone by send
time). Waitlist confirmation becomes the **second** — a signup has no
user row **by design**. The field's doc comment is widened to name both
cases explicitly rather than letting the precedent go unexplained.

### 4.4 Format matrix — which templates get HTML

Not a stylistic split. Two plan decisions lock specific kinds to plain
text, and those locks survive the move to React Email.

| Template                                    | Format        | Why                                             |
| ------------------------------------------- | ------------- | ----------------------------------------------- |
| `sync-complete`, `sync-reminder-24h`        | HTML + text   | no lock                                         |
| `deletion-scheduled`, `deletion-receipt`    | HTML + text   | no lock                                         |
| `mailbox-reconnect-required`, `sync-failed` | HTML + text   | no lock                                         |
| `waitlist-confirmation`                     | HTML + text   | no lock                                         |
| `weekly-value-receipt`                      | **text only** | D189 specifies plain-text                       |
| `reengage-day3/7/14/30`                     | **text only** | D126 P3: "Plain text only; no marketing chrome" |

Seven multipart, five text-only. The text-only templates are still
authored in the same `.tsx` module for one consistent authoring
surface — they simply export no `html`.

## 5. New emails

| Kind                         | Trigger                                                                   | Recipient           | Opt-out key                                 |
| ---------------------------- | ------------------------------------------------------------------------- | ------------------- | ------------------------------------------- |
| `mailbox-reconnect-required` | `provider_sync_state.last_incremental_error_code` → `'InvalidGrantError'` | `userId`            | `mailboxAlerts` (new, default **on**)       |
| `sync-failed`                | `sync_readiness` → `'failed'` (terminal)                                  | `userId`            | `mailboxAlerts`                             |
| `waitlist-confirmation`      | `POST /api/waitlist` inserts a new row                                    | `recipientOverride` | none                                        |
| `weekly-value-receipt`       | Sun 18:00 user-local                                                      | `userId`            | `weeklyReceipt` (new, default **off**, Pro) |

### 5.1 Reconnect-required — trigger correctness

**Do not watch `mailbox_accounts.status`.** That column flips to
`'disconnected'` on _user-initiated_ disconnect
(`mailbox-accounts.service.ts:458`); emailing "action required" to
someone who deliberately disconnected would be a defect.

The durable evidence of an externally revoked grant is
`provider_sync_state.last_incremental_error_code = 'InvalidGrantError'`.
It is cleared on re-auth by the `freshCredentials` CASE in
`sync.service.ts:150`, so a second revocation after a successful
reconnect produces a fresh `last_incremental_error_at` — and therefore
correctly earns a second email.

Idempotency key: `email__reconnect__${mailboxAccountId}__${lastIncrementalErrorAt}`.

Delivery mechanism: publish a `mailbox.reconnect_required` outbox event
(D204 pattern, mirroring `mailbox.sync_ready`) consumed by the outbox
router, rather than a polling sweep.

### 5.2 Waitlist confirmation — no oracle

`WaitlistService.join()` already performs
`.onConflictDoNothing().returning({ id })`. Enqueue **only when a row
was returned**; a duplicate submit sends nothing.

This preserves the endpoint's deliberate no-oracle property: the HTTP
202 is byte-identical either way, and the suppression decision happens
server-side. Only the address owner ever observes the difference.

Idempotency key: the returned `waitlist.id` — a natural
one-per-address-ever key.

### 5.3 Preferences

`EmailPrefsSchema` gains `mailboxAlerts` (default `true`) and
`weeklyReceipt` (default `false`). `parseEmailPrefs`'s partial-parse
already fills absent keys from defaults, so existing stored bags
upgrade without wiping an opt-out.

`mailboxAlerts` is opt-out-able rather than system: a revoked token is
operational, not a legally-required notice. Default-on because the
alternative is silent product failure.

## 6. List-Unsubscribe + one-click

Headers set on opt-out-able kinds only. System notices (deletion) get
none — there is nothing to unsubscribe from.

```
List-Unsubscribe: <https://api.declutrmail.com/api/email/unsubscribe?t=…>, <mailto:unsubscribe@declutrmail.com>
List-Unsubscribe-Post: List-Unsubscribe=One-Click
```

New route `POST /api/email/unsubscribe`:

- **Unauthenticated** — Gmail POSTs with no cookies. This is the whole
  point of RFC 8058 and the reason it was skipped before.
- Token is a signed JWT via `jose` (already a dependency) carrying
  `{ userId, category }`. Unguessable, non-enumerable, single-purpose.
- Rate-limited. Always returns 200 regardless of token validity — an
  error code would be an enumeration oracle.
- Effect: sets exactly one `emailPrefs` key to `false`.
- A `GET` variant backs the footer link and renders a confirmation
  page.

`Reply-To` is **deliberately not set** this arc.
`FOUNDER-FOLLOWUPS.md:1786` records that `support@declutrmail.com`
delivery is still pending the `.com` domain-alias add; shipping a
bouncing Reply-To is worse than shipping none.

## 7. Privacy posture — unchanged

Every value in every template is one of: a count, a date, the user's
own mailbox address, or a DeclutrMail URL. No message content, no
subjects, no snippets, no third-party addresses.

The value receipt derives all of its numbers from **our own record of
what we did** (`activity_log`, `triage_decisions`, `undo_journal`,
`brief_runs` aggregate counts) — never from Gmail-derived content.

Consequences, stated explicitly so a reviewer can check them:

- `GmailDataProcessor` (`packages/shared/src/contracts/gmail-data-inventory.ts:26`)
  is **not** modified. Resend does not become a Gmail-data
  sub-processor.
- No D245 registry entry, no public storage-list change, no privacy
  page amendment.
- No new `privacy-auditor` gate surface.

This is precisely the property D61's Brief digest would have broken,
and the reason it is out of scope.

## 8. Weekly Value Receipt (D189)

### 8.1 Schema

```
weekly_value_receipts (
  id uuid pk,
  user_id uuid fk → users(id) on delete cascade,
  week_starting date not null,
  payload jsonb not null,
  in_app_viewed_at timestamptz,
  email_sent_at timestamptz,
  generated_at timestamptz not null default now(),
  unique (user_id, week_starting)
)
```

Atlas migration. `in_app_viewed_at` is written by the in-app card
(§8.6).

### 8.2 Worker

`WeeklyValueReceiptWorker`, `cronPolicy` (D203/D225), mirroring
`BriefSnapshotWorker`: a `setInterval` scheduler enqueues a per-minute
tick with `jobId = WeeklyValueReceiptWorker:${scheduledAtMinute}`, and
the worker resolves each user's local Sunday-18:00 window. UTC fallback
for absent or invalid timezones, matching D246's precedent for the
Brief.

**Pro gate:** on `workspaces.tier === 'pro'` directly, **not** a new
`Capability`. `CAPABILITIES`
(`packages/shared/src/entitlements/types.ts:66`) is a closed list of 11
feature surfaces with an invariant test pinning it; the receipt is a
delivered artifact, not a screen the user navigates to, so adding a
12th key would ripple through the entitlements tests for no gate that
anything reads.

### 8.3 Computation — corrected against real tables

D189's specified computation references tables that do not exist. The
corrected mapping:

| Receipt line                      | D189 said                               | Actual source                                                                                                                 |
| --------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| kept out of inbox                 | `count(action_operation_items …)`       | `SUM(affected_count)` from `activity_log` where `source IN ('autopilot','screener')`, 7d, excluding `reverted_at IS NOT NULL` |
| surfaced in Brief                 | `brief_runs.brief_payload.reply + .fyi` | unchanged — counts only                                                                                                       |
| held during Quiet Hours           | `quiet_held_messages`                   | **line dropped** — see §8.4                                                                                                   |
| ~minutes saved                    | `(triage × 30s) + (autopilot × 5s)`     | unchanged; rendered with `~`                                                                                                  |
| irreversible without confirmation | hard-coded `0`                          | derived from `undo_journal` + `activity_log.undo_token`                                                                       |

`SUM(affected_count)` rather than `count(rows)` is a correction, not a
preference: one autopilot row can move hundreds of messages, so
counting rows would badly understate the number the receipt exists to
report.

### 8.4 Two lines that would have asserted unmeasured facts

**Quiet Hours.** D189 specifies `count(quiet_held_messages)` and
`sum(quiet_release_events.message_count)`. Neither table exists, and
more fundamentally **Quiet Mode does not hold messages** — it defers
autopilot sweeps (`autopilot-action.worker.ts:455`). There is no
per-message hold record anywhere in the system. The line is dropped
rather than rendered as `0`.

**The trust line.** D189 specifies a hard-coded
`0 irreversible changes without confirmation`, with a same-day hotfix
if it ever flips. Nothing in the system would ever tell us it flipped.
Replaced with a measured statement derived from undo coverage —
_"N changes were reversible for D days"_ — carrying the same trust
payload with a query behind it.

**`D` is derived, never literal.** The undo window is tier-dependent:
`undo_journal.expires_at` defaults to 7 days (D232), but Pro gets 30
(D81) via `undoWindowDaysFor(tier)`
(`packages/shared/src/entitlements/resolve.ts:36`). Since the receipt
is Pro-only, a hard-coded "7 days" would be wrong for **every single
recipient**. The template takes the window as an input resolved from
the reader's own tier.

Both corrections follow the same rule: **no number renders without a
query behind it.** This is the repo's documented dominant defect class
(surfaces asserting what they don't know), and a trust artifact is the
worst possible place to reintroduce it.

### 8.5 Empty state

If every computable number is zero, **suppress entirely** — do not
generate the row, do not send. Per D189: sending "you did nothing this
week" is worse than silence.

### 8.6 In-app card

D189's second surface: a card pinned to the top of Triage for 24h
after generation, dismissible.

- `GET /api/receipts/current` returns the current week's row for the
  active user, or `null`. Pro-gated identically to the worker.
- `POST /api/receipts/:id/dismiss` writes `in_app_viewed_at`.
- Card renders only while `generated_at` is within 24h **and**
  `in_app_viewed_at IS NULL`.
- Storybook story required (D210), including the null/empty state —
  the card must render nothing rather than a skeleton when there is no
  receipt, since a suppressed empty week is the common case for new
  users.

The card reads the same `payload` the email renders from, so the two
surfaces can never disagree — a single generation, two presentations.

## 9. Re-engagement sequence (D126 Part 3)

Four behavioral emails. All plain-text per D126 Part 3's explicit lock
("Plain text only; no marketing chrome") — this is the one part of the
arc that does **not** get HTML.

| Step   | Condition                  | Content                        |
| ------ | -------------------------- | ------------------------------ |
| Day 3  | no activity since signup   | count of new senders           |
| Day 7  | no activity in 5 days      | count of noisy senders waiting |
| Day 14 | no activity                | 7-day counts summary           |
| Day 30 | no activity + Pro + Paddle | pause offer                    |

### 9.1 Privacy constraint

D126 P3 describes Day 14 as "a Brief summary of last 7 days of email
patterns". **Patterns means counts, not content.** Day 14 renders
message and sender counts only — no sender names, no subjects. Any
other reading would make Resend a Gmail-data sub-processor and drag
D61's excluded privacy work into this arc through the back door.

### 9.2 Scheduling and durable dedup

A daily `ReEngagementSweepWorker` (`cronPolicy`) finds eligible users
and enqueues, rather than BullMQ-delaying a job 30 days out. A
30-day-delayed job is fragile against Redis eviction and job retention
— the existing 24h reminder delay is at the edge of what that
mechanism should carry.

Because the sweep runs daily, dedup must be durable rather than
jobId-scoped:

```
email_sequence_sends (
  id uuid pk,
  user_id uuid fk → users(id) on delete cascade,
  step text not null,          -- 'day3' | 'day7' | 'day14' | 'day30'
  sent_at timestamptz not null default now(),
  unique (user_id, step)
)
```

BullMQ `jobId` dedup only holds for the job-retention window; a 30-day
sequence outlives it. The unique constraint is the real guard.

"Activity" reuses the existing definition — any `active_sessions.last_used_at`
after the reference instant, the same predicate the 24h reminder uses
(`hasUserActivitySince`).

### 9.3 Day 30 requires pause-initiation

D126 P3's Day-30 copy offers to pause the subscription. No
pause-initiation path exists today: the app renders `paused` state and
offers **resume** (`billing.controller.ts:118`), but nothing can enter
the state.

This arc adds it via the existing `BillingProvider` seam rather than
bespoke endpoints:

- `pauseSubscription(providerSubscriptionId, resumeAt)` added to the
  interface alongside the six methods it already carries.
- **Paddle:** `POST /subscriptions/{id}/pause`, mirroring the ~35-line
  `resumeSubscription` at `paddle.adapter.ts:326`.
- **Razorpay:** typed `PAUSE_UNSUPPORTED` refusal, mirroring
  `resumeSubscription`'s existing refusal at `razorpay.adapter.ts:222`.
- `POST /api/billing/pause` mirroring the existing `/resume` route.
- UI control gated exactly like `canSelfServeResume`
  (`billing-screen.tsx:1001`).

**The Day-30 email is therefore gated on `provider === 'paddle'`.**
Razorpay Pro users receive no pause offer, because they could not act
on it. This provider asymmetry is not new — it is the established
pattern for self-serve resume.

## 10. Delivery telemetry

`ResendWebhookController` currently ACKs and discards non-suppressing
events (`resend-webhook.controller.ts:150`). It gains a PostHog
capture for `email.delivered` and `email.bounced`, keyed on the
existing `kind` so per-template delivery is visible.

No `email.opened`, no beacon, no per-recipient pixel identifier.
D126 Part 1's "Brief open rate" therefore remains **partially
unsatisfied** — recorded rather than quietly dropped.

## 11. Tracking-layer fixes

Two defects in the D-tracking layer, both found while checking whether
the log rows are hand-editable.

### 11.1 `generate-impl-log` destroys state

`scripts/generate-impl-log.ts:67` emits every row as:

```ts
lines.push(`| D${d.num} | ${d.title} | ⬜ |  |  |  |`);
```

It reads the existing log **only to locate the AUTO markers**, then
rewrites all 235 rows with status hard-set to ⬜ and PR / Verified-by /
Notes blanked. There is no merge and no keying on existing state — so
`pnpm generate-impl-log`, a command CLAUDE.md's Quick Reference lists
as routine, silently discards the entire tracking history. Recovery is
git or nothing.

Fix: merge by D-number. Parse existing rows, preserve the four state
columns, update titles from the plan, and append genuinely new
decisions as ⬜. Regression test: a log with a 🟢 row survives a
regeneration.

This may also explain §12's D165 anomaly — after a wipe, only rows
`pr-merged.yml` subsequently re-flipped would recover. Hypothesis, not
traced.

### 11.2 Row corrections

Once the generator is safe, correct the rows themselves:

- **D61** 🟢 → 🟡. Its in-app leg shipped; its optional email digest
  never did and is explicitly deferred at
  `brief-snapshot.worker.ts:165`. A 🟢 asserts a decision is verified
  when half of it does not exist.
- **D165** ⬜ → 🔵. Prefs API, both toggles, settings card, and
  execution-time enforcement all shipped.
- **D162** 🔵 → run `verify-d`.

Row edits land **after** the generator fix, so the next regeneration
does not undo them.

## 12. Out of scope

| Item                        | Why                                                                |
| --------------------------- | ------------------------------------------------------------------ |
| D61 Brief email digest      | Would make Resend a Gmail-data sub-processor                       |
| Open tracking               | Founder decision — conflicts with the product's privacy claim      |
| DMARC enforcement           | Staying `p=none`                                                   |
| Resend key rotation         | Founder decision 2026-07-10 — keep                                 |
| Day-30 email to Razorpay    | Gated on `provider === 'paddle'`; Razorpay cannot self-serve pause |
| D119 portal/invoice surface | Adjacent to the pause work but a separate decision's scope         |

`Reply-To` is **in** scope but ships **env-gated**: the header is set
only when `EMAIL_REPLY_TO` is present, and that variable stays unset
until `support@declutrmail.com` `.com` delivery is verified
(`FOUNDER-FOLLOWUPS.md:1786`). Code lands now; the header activates
when the founder sets one variable. No bouncing Reply-To ever ships.
| DMARC enforcement | Staying `p=none` |
| Resend key rotation | Founder decision 2026-07-10 — keep |

## 13. Testing

- **Unit:** template snapshots for all twelve kinds — `subject + text + html`
  for the seven multipart kinds, `subject + text` for the five
  plain-text-locked ones (§4.4); `parseEmailPrefs` upgrade path for the two new keys;
  receipt computation against seeded `activity_log` /
  `triage_decisions` / `undo_journal` fixtures — **seeding ≥2 rows on
  both sides** of every correlated aggregate (the documented Drizzle
  correlated-subquery pitfall).
- **Contract:** `EmailDeliveryPort` fake asserts `html` and `headers`
  reach the port; unsubscribe token round-trip; invalid/expired/absent
  token all return 200.
- **Integration:** waitlist duplicate submit enqueues nothing;
  reconnect email fires on `InvalidGrantError` and **not** on
  user-initiated disconnect; empty-week receipt generates no row.
- **Smoke (§8 bar):** `pnpm --filter @declutrmail/api email-smoke` for
  real delivery; force a revoked-grant state via SQL and restore;
  verify the Gmail native unsubscribe button renders on a received
  message; confirm the text/plain alternative reads correctly in a
  text-only client.

## 14. Appendix — full findings ledger

Everything surfaced this session, including items outside this arc, so
none is lost to the conversation.

### Fixed by this arc

0. **`pnpm generate-impl-log` wipes all D-tracking state**
   (`scripts/generate-impl-log.ts:67`) — see §11.1. Unrelated to email;
   found while checking whether the log rows are hand-editable. The
   most damaging item on this list.
1. No `List-Unsubscribe` / `-Post` / `Reply-To` / `html` on any send
   (`email.service.ts:94`).
2. "Plain-text only — LOCKED" comment (`email-templates.ts:4`)
   over-applies its own citation: D126 Part 3 scopes that lock to the
   re-engagement sequence. D61 explicitly specifies HTML; D162 chose
   Resend _for_ React Email.
3. Waitlist stores a row and sends nothing.
4. Revoked Gmail token → sync dies silently; in-app gate only.
5. Terminal sync failure → no email.
6. Resend webhook discards all delivery telemetry.

### Plan-drift — D-candidates for founder distillation

7. **D189 `action_operation_items` does not exist** → `activity_log`.
8. **D189 Quiet Hours lines are uncomputable** — Quiet defers sweeps;
   it never held messages. No `quiet_held_messages` /
   `quiet_release_events` table has ever existed.
9. **D189's hard-coded `0` trust line** — replaced with a derived
   statement.

### Tracking-layer truth bugs

10. **D61 is marked 🟢 Verified** (`IMPLEMENTATION-LOG.md:115`) with
    `brief.read-service.spec.ts` as evidence — the _in-app_ leg. The
    decision's other half, the optional email digest, was never built
    and is explicitly deferred at `brief-snapshot.worker.ts:165`. A 🟢
    on a half-shipped decision is the UI-truth defect class one floor
    up, in the tracking layer.
11. **D165 is marked ⬜** (`IMPLEMENTATION-LOG.md:219`) but the prefs
    API, both toggles, the settings card, and execution-time
    enforcement all shipped. Under-reported.
12. **D162 sits 🔵**, never `verify-d`'d.

### Now in scope (founder widened 2026-07-27)

13. D126 Part 3 re-engagement sequence — §9.
14. D189 in-app Triage card — §8.6.
15. `Reply-To` — env-gated, §12.
16. Subscription pause-initiation — §9.3, pulled in because Day 30
    depends on it.

### Deferred, recorded

17. D61 Brief digest — requires Resend in `GmailDataProcessor`, the
    D245 registry, and a privacy-page amendment.
18. D126 Part 1 "Brief open rate" stays partially unsatisfied
    (delivery tracked, opens deliberately not).
19. `support@` / `privacy@` `.com` delivery pending the domain-alias
    add — the founder action that activates `Reply-To`.
20. D119 portal / invoice surface — adjacent to pause, own scope.
21. Razorpay self-serve pause and resume both remain unimplemented
    (typed refusals). Day-30 email is Paddle-gated as a result.

### Checked, no action

22. SPF on `send.declutrmail.com` = `include:amazonses.com` —
    Resend-on-SES, correct.
23. DMARC `p=none` on the org domain; the sending subdomain inherits
    it. Satisfies Gmail's bulk-sender minimum.
24. Resend key rotation — founder decision to keep (2026-07-10). The
    stale `Status: Open` ledger line was amended this session; the
    "exposed" framing is unsupported by anything in the repo.
