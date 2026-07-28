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

This arc widens the surface to eight templates, adds RFC 8058 one-click
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

- `EmailSendJobData` gains `html: string`.
- `EmailDeliveryPort.deliver()` gains `html`.
- `EmailService` passes `html` alongside `text` → Resend sends
  multipart.
- `EmailService` gains a `headers` parameter for List-Unsubscribe.

Job payloads grow ~8–15KB in Redis. Acceptable at this volume; noted
so it isn't a surprise in a future queue-sizing review.

### 4.3 Design constraint carried from the codebase

`recipientOverride` currently has exactly one sanctioned caller (the
D232 deletion receipt, whose user row is deliberately gone by send
time). Waitlist confirmation becomes the **second** — a signup has no
user row **by design**. The field's doc comment is widened to name both
cases explicitly rather than letting the precedent go unexplained.

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

Atlas migration. `in_app_viewed_at` is written by nothing this arc —
it exists so the deferred in-app card (§10) doesn't need a second
migration.

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

## 9. Delivery telemetry

`ResendWebhookController` currently ACKs and discards non-suppressing
events (`resend-webhook.controller.ts:150`). It gains a PostHog
capture for `email.delivered` and `email.bounced`, keyed on the
existing `kind` so per-template delivery is visible.

No `email.opened`, no beacon, no per-recipient pixel identifier.
D126 Part 1's "Brief open rate" therefore remains **partially
unsatisfied** — recorded rather than quietly dropped.

## 10. Out of scope

| Item                                               | Why                                                           |
| -------------------------------------------------- | ------------------------------------------------------------- |
| D61 Brief email digest                             | Would make Resend a Gmail-data sub-processor                  |
| D126 Part 3 re-engagement sequence (Day 3/7/14/30) | Separate arc; depends on the receipt's counts infrastructure  |
| D189 in-app Triage card                            | Frontend arc. **D189 must not be marked done on this build**  |
| `Reply-To`                                         | Blocked on `.com` mailbox delivery                            |
| Open tracking                                      | Founder decision — conflicts with the product's privacy claim |
| DMARC enforcement                                  | Staying `p=none`                                              |
| Resend key rotation                                | Founder decision 2026-07-10 — keep                            |

## 11. Testing

- **Unit:** template snapshots (subject + text + html) for all eight
  kinds; `parseEmailPrefs` upgrade path for the two new keys;
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

## 12. Appendix — full findings ledger

Everything surfaced this session, including items outside this arc, so
none is lost to the conversation.

### Fixed by this arc

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

### Deferred, recorded

13. D61 Brief digest — requires Resend in `GmailDataProcessor`, the
    D245 registry, and a privacy-page amendment.
14. D126 Part 3 re-engagement sequence.
15. D189 in-app Triage card.
16. D126 Part 1 "Brief open rate" stays partially unsatisfied
    (delivery tracked, opens deliberately not).
17. `support@` / `privacy@` `.com` delivery pending the domain-alias
    add — blocks `Reply-To`.

### Checked, no action

18. SPF on `send.declutrmail.com` = `include:amazonses.com` —
    Resend-on-SES, correct.
19. DMARC `p=none` on the org domain; the sending subdomain inherits
    it. Satisfies Gmail's bulk-sender minimum.
20. Resend key rotation — founder decision to keep (2026-07-10). The
    stale `Status: Open` ledger line was amended this session; the
    "exposed" framing is unsupported by anything in the repo.
