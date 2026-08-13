# ADR-0032: Unsubscribe cascade runs at FAILURE time, not only at derivation time

- **Status:** Accepted
- **Date:** 2026-08-13
- **Deciders:** founder, Claude (agent)
- **Amends:** [ADR-0006](0006-unsubscribe-cascade-rfc8058-mailto-manual.md)
- **Related D-decisions:** D9 (auto-try RFC 8058 → mailto → fallback), D252
  (unsubscribe degrades honestly), D230 (mailto stays manual), D226 (no fake
  success), D58 (unsubscribe is one-way)

## Context

ADR-0006 encoded D9's three-step cascade as a **derivation-time** choice: a
sender resolves to `one_click`, `mailto`, or `none` once, during sync, and
`senders` keeps a single `unsubscribe_url` for whichever channel won. That was
the right call for _choosing a method_ and it stays unchanged.

What it did not do is deliver the _runtime_ half of D9. ADR-0006 said so
explicitly — "the executor (or non-executor) decides what to do with it" — and
deferred the fallback to V2.1. In the meantime the executor had no fallback at
all: a refused one-click POST recorded `failed` and stopped.

Production data made the cost measurable. Of 2122 `one_click` senders,
**1511 (71%)** also advertise a `mailto:` channel that we hold per-message in
`mail_messages.unsubscribe_mailto_url` and discard at the sender level. A
further **1187** held a stale or wrong one-click URL, because RFC 8058 URLs are
minted per send and carry an expiring token. So the common case was: POST a
dead token, get refused, tell the user "failed" — while a working opt-out
address sat one table over.

Two consequences the derivation-time model cannot reach:

1. **A sender that never mails again never self-heals.** The stored URL is only
   refreshed by a later message from that sender.
2. **A sender can change ESP.** One production sender's stored URL pointed at
   `ebm.cheetahmail.com` while its current messages carry a Walgreens-hosted
   endpoint. That is not an expired token — it is a decommissioned vendor. No
   amount of token freshness helps; only a different channel does.

## Decision

**1. The executor resolves both channels from `mail_messages` at execution
time.** `senders.unsubscribe_url` becomes a _fallback_, not the source of
truth. The newest message carrying `unsubscribe_one_click` supplies the URL to
POST; the newest carrying `unsubscribe_mailto_url` supplies the fallback
address.

This reverses ADR-0006's implication that the sender row is authoritative for
execution. It is still authoritative for **method** — the `one_click` guard
still reads `senders.unsubscribe_method`, so a sync that demotes a sender still
prevents the POST.

The lookup is deliberately **not label-scoped**. A sender's newest one-click
message can legitimately sit in Archive or Trash; scoping to INBOX would select
an older token and manufacture the exact staleness this fixes. Ties on
`internal_date` break by `id DESC`, because `id` is a random v4 UUID and
date-only ordering would let two runs POST different tokens.

**2. A refused POST cascades to the manual path when one exists.** The outcome
vocabulary gains a fourth value, `action_required`:

| Endpoint response           | Outcome                                      |
| --------------------------- | -------------------------------------------- |
| 2xx                         | `endpoint_accepted`                          |
| 3xx                         | `unconfirmed` (redirects are never followed) |
| 4xx / 5xx, mailto available | **`action_required`**                        |
| 4xx / 5xx, no mailto        | `failed`                                     |

`failed` now means what it says: nothing left to try. `action_required` is the
same resting state a natively-`mailto` sender reaches, so it reuses D230's
compose hand-off with no new UI concept.

D230 is unchanged and unweakened: DeclutrMail still never sends the opt-out
mail. The cascade hands the user a prefilled draft; the user sends it.

**3. `action_required` rides on `action_jobs.status = 'failed'` plus
`error_code = UNSUB_MANUAL_REQUIRED`.** `action_job_status` has no "needs the
user" value, and `unconfirmed` already established this pattern. The automated
attempt did end without succeeding; what differs is whether anything remains,
which `sender_policies.unsub_status` carries.

**4. Manual progress is gated on POLICY STATUS, not sender method.** The
previous guard required `senders.unsubscribe_method === 'mailto'`, which closed
the manual path against precisely the senders the cascade rescues. It now also
admits a `one_click` sender whose policy already sits in `action_required`,
`draft_opened`, or `user_marked_sent`.

**5. Bulk unsubscribe records mailto senders.** It previously wrote no policy
row for them, so `recordUnsubscribeManualStatus` rejected with
`UNSUBSCRIBE_INTENT_REQUIRED` — "Mark sent" was permanently dead for every
mailto sender routed through the bulk path, a D226 honesty failure. They now
receive the same durable trio (policy + Activity + outbox event) minus the job,
since D230 means nothing is sent. Re-running a batch cannot regress a sender
past `draft_opened` / `user_marked_sent`.

## Consequences

- No migration. `unsub_status.action_required` and
  `activity_log.unsubscribe_action_required` already existed; only the paths
  that reach them are new.
- **611 senders remain terminal** — one-click-only, with no mailto to fall back
  to. For them `failed` is the honest answer and D9's step 3 (Gmail search
  fallback) is the remaining recourse.
- Adding a fifth outcome now requires updating the exhaustive `switch` in
  `outbox-consumer-router.ts`. That is deliberate: the previous ternary
  defaulted unknown outcomes to `failed`, so widening the event enum silently
  stomped the worker's own row through an unconditional upsert — compile-clean
  data corruption. The `never` arm converts that class into a typecheck error.
- A backfill of stale stored URLs (migration `0055`) is no longer _required_ for
  correctness, since execution reads through to `mail_messages`. It remains
  useful where messages have aged out of the index.

## Known gap

An **all-mailto** bulk selection still rejects with `NO_ACTIONABLE_SENDERS`.
Accepting it means making `batchId` nullable in `BulkActionEnqueueResult`, a
wire-contract change reaching the client. Mixed batches — the common case, given
71% dual-channel — are fixed. Tracked separately; the failure is loud rather
than silent, which is why it is a gap and not a defect.
