# ADR-0028 — Action reach: Delete can include archived mail

- **Status:** Accepted (founder-approved 2026-07-27 as "item A"; built 2026-07-28)
- **Decisions touched:** D226 (action lifecycle), D245 (Protected/bulk exclusions), D7 (privacy), ADR-0020 (composite shape), ADR-0015/0019 (verb registry)

## Context

Every sender action resolved "messages currently carrying INBOX"
(`senderInboxActionWhere`, deduplicated in #400). That is the right
default — the product's ritual is inbox triage — but it makes the
product structurally useless for senders whose mail a Gmail filter
files past the inbox. The dogfood mailbox measured the gap: its three
largest such senders held ~6.6k / ~1.1k / ~1k messages each with ZERO
in inbox (all filed by user-defined Gmail filters with "Skip the
Inbox"). Every verb's preview honestly read 0 and those senders could
not be cleaned up at all — the 2026-07-27/28 founder reports ("71 /mo
above five zero chips", "All actions shows as 0 emails currently
match").

## Decision

1. **A `reach` dimension on sender actions**: `inbox_only` (default,
   the pre-ADR semantic) or `all_mail` (inbox + archived; TRASH, SPAM,
   DRAFT and CHAT are never touched — mirrors what a plain Gmail
   `from:` search covers).
2. **Delete-only, single-sender-only, user-explicit.** Enforced at
   three layers: Zod (`compositeActionRequestSchema` superRefine → 400),
   service assert (`INVALID_REACH`), and a DB CHECK
   (`action_jobs_reach_verb_check`). Archive of archived mail is a
   no-op by definition; Later/bulk/Autopilot widening would each be a
   separate product decision (D245 keeps automatic actions
   inbox-scoped). ~~The composite secondary Delete also stays
   inbox-only at this build.~~ **Superseded 2026-08-31** — see
   amendment below.
3. **Persisted on the row** (`action_jobs.reach`, migration 0050),
   like `older_than_days`: the worker resolves exactly the set the
   preview counted. Reverse and recovery rows copy the forward value.
4. **Preview returns a parallel `allMail` block** (counts + top-5
   samples per window) alongside the inbox block, from one shared
   query builder (`previewBuckets`). Additive wire: an older web
   bundle ignores it; a newer web bundle treats its absence (older
   API) as "reach selection unavailable" and hides the chips.
5. **Undo restores each message to where it was.** The forward path
   MEASURES which of the ids being mutated carry INBOX — for every
   Delete, unconditionally — and records that partition
   (`undo_journal.payload.inboxMessageIds`, read from the local
   mirror inside the terminal transaction, before the mirror update
   rewrites it), plus a best-effort `reach: 'all_mail'` marker when
   the row still says so. The revert applies the registry reverse
   (+INBOX/−TRASH) to the inbox subset and only −TRASH to the
   archived rest — a blanket +INBOX would dump years of archived mail
   into the inbox on undo. (An inbox-only delete's partition is the
   whole set, so its split degenerates to the uniform reverse.)

   **The payload governs; the `reach` column never does** (Codex
   stop-review 2026-07-28, both rounds). The column is mutable state:
   a migration rollback + re-apply resets every row — historical AND
   in-flight — to the `inbox_only` default. Keying the reverse on it
   would flood the inbox for past all-mail deletes; keying the
   FORWARD journal write on it would do the same for a job that froze
   its wide id set, crashed before the terminal transaction, and
   retried after the reset — which is why the partition is measured
   from the frozen ids rather than derived from any claim. The
   journal payload is written once and survives the column. When any
   signal says all-mail but the split is unreadable (damaged
   payload), the revert strips the INBOX re-add and restores
   everything to the archive — degraded, never the flood. Only a
   payload with no all-mail signal at all takes the uniform reverse
   (legacy inbox-only deletes, where +INBOX is exactly correct).

## Companion surface

`SenderListRow.inboxCount` (live correlated count, list + detail):
the senders row can say "977 received · 0 in inbox" before the user
opens three no-op modals. Deliberately NOT a maintained counter —
label membership changes on every action and sync; a nightly-
reconciled column would recreate the stale-counter class ADR-0014
documents.

## Consequences

- The Delete modal gains a "Where it applies" chip pair
  (`Inbox only (n)` / `Inbox + archived (m)`), window-scoped counts on
  both, an all-mail sample panel, and a Gmail verify link that drops
  `in:inbox` at the widened reach. The empty-inbox notice points at
  the chip when archived mail exists.
- Recovery (`freezeTarget`) now resolves through the shared predicate
  at the action's reach — which also fixes a drift the inline copy
  had: it lacked `is_outbound = false`, so a recovery freeze could
  target self-sent mail the original action never touched (the class
  #400 deduplicated). Recovery's time-window now derives from the DB
  clock like every other resolver, not the injectable `deps.now`.
- Blast radius: an all-mail Delete on the largest measured sender
  resolves ~6.6k ids (7 chunked batchModify calls; `resolved_message_ids`
  TOASTs — accepted, same as before). Quota is unchanged: one
  composite click = one cleanup unit regardless of reach.
- Known degradation (documented in the worker): if the process
  crashes between the Gmail mutation and the terminal transaction AND
  an incremental sync overwrites the mirror before the retry, the
  undo partition for the raced messages is lost and they restore to
  archive instead of inbox — degraded, never destructive.

## Rejected alternatives

- **Blanket `+INBOX` undo** (simple, wrong): floods the inbox on undo.
- **Restore-all-to-archive undo**: silently un-inboxes real inbox mail.
- **`inbox_message_ids` column on `action_jobs`**: fully durable
  partition, but duplicates ~100% of ids for the common case; the
  mirror-derived capture inside the atomic terminal transaction covers
  every non-raced retry without new schema.
- **Widening all verbs / bulk now**: blast-radius and product
  questions (D245) each deserve their own decision.

## Amendment 2026-08-31 — widen reach to the Unsubscribe composite's Delete secondary

**Trigger.** Founder report: the direct single-sender Delete modal and
the Unsubscribe modal's "Delete them" secondary showed different match
counts for the same sender (2 vs 753) with no explanation on screen —
the secondary had no reach chip at all, so a sender whose mail is
Gmail-filtered past the inbox (exactly this ADR's motivating case)
could never have its backlog reached through the Unsubscribe flow.

**Why this was safe to widen, not a new build.** The composite
secondary Delete was never its own code path: `senders-screen.tsx` /
`sender-detail-page.tsx` re-dispatch it as a genuine single-sender
Delete **primary** (`enqueueCompositeAction({ primary: { type:
secondary.type, ... } })`) after the unsubscribe intent records —
D248's routing note in the Decision section above. That call already
passes through the exact same Zod branch, `INVALID_REACH` assert, and
DB CHECK this ADR built for the primary Delete case, and
`previewComposite` already resolves both the `inbox` and `allMail`
buckets for every verb (not just Delete) — so the `all_mail` counts
were already computed and sitting unused on the wire response. The gap
was purely `confirm-action-modal.tsx`'s `reachAvailable` flag gating
the chip on the OUTER verb (`Delete` primary) instead of on which call
is actually going to be a Delete primary on the wire.

**Change.** `reachAvailable` now also turns on when the composite
secondary is `'delete'` (single-sender only — bulk stays inbox-only,
since the wire selector for a multi-sender secondary is `senders`,
which the server still 400s at `all_mail`). No Zod, service, DB CHECK,
or worker change — item 2's three-layer enforcement and the undo
partitioning in item 5 already cover this shape because it always was
a primary Delete underneath.

**Scope not touched.** The `secondary` sub-object inside
`enqueueComposite`'s OWN composite call (Archive/Later primary +
secondary in one round trip, still hardcoded `inbox_only` in
`actions.service.ts`) is untouched — no live caller sends a real
value there (`showSecondaryRow` is Unsubscribe-only), so widening it
would be speculative.

## Amendment 2026-09-19 — widen reach to the multi-sender (bulk) Delete

**Trigger.** Founder report: with several senders selected, the Delete
modal (and the Unsubscribe modal's "Delete them") showed no "Where it
applies" choice, while the same modal for one sender did. Founder
decision the same day: allow it, same default (`Inbox only`), no cap.

**Why this was safe to widen.** The bulk fan-out
(`enqueueBulkComposite`) already writes ONE ordinary single-sender
`action_jobs` row per sender. Everything item 3 and item 5 built is
per-row — the worker resolves at `job.reach`, the undo partition
(`inboxMessageIds`) is measured per job, and `enqueueCompositeRevert`
copies each sibling's `reach` onto its reverse row — so a bulk row at
`all_mail` is indistinguishable from the single-sender row this ADR
already ships. No worker, journal, or schema change; the DB CHECK
(`reach = 'inbox_only' OR verb = 'delete'`) never mentioned the
selector.

**Change.**

- Zod: the `senders`-selector rejection is removed; `all_mail` is now
  legal on any Delete primary. The Delete-only rule is unchanged at all
  three layers, and `enqueueBulkComposite` gains the same
  `INVALID_REACH` service assert `enqueueComposite` has.
- `POST /api/actions/preview/bulk` returns `allMailTotals` plus a
  per-sender `allMailCounts` beside the inbox block (additive wire, same
  skew rule as item 4: absent ⇒ the chips do not appear). Protected
  senders are excluded from `allMailTotals` exactly as from `totals`
  (D245), so the chip equals what the enqueue will move.
- The modal's `reachAvailable` no longer excludes bulk; at the widened
  reach the per-sender lozenges show each sender's all-mail count.
- Bulk Unsubscribe + "Delete them" dispatches its backlog as a separate
  bulk Delete primary (D248), so the chosen reach rides that call.

**Scope not touched.** The `secondary` sub-object of a bulk
Archive/Later composite stays `inbox_only` (same reasoning as the
2026-08-31 amendment — no live caller). Triage's batch sheet, the
Brief noise-archive, Later and Autopilot stay inbox-scoped.

**Blast radius.** One click can now move every selected sender's
archived mail to Trash (up to `BULK_SENDERS_MAX` senders). Mitigations
are the ones this ADR already relies on: the wider reach is never the
default, the chip states the aggregate count before confirm, Protected
senders are skipped, and undo restores each message to where it was.
Quota is unchanged — one unit per actionable sender regardless of reach.

**Reach is frozen by the Idempotency-Key**, like the time window: a
retried POST with the same key but a different `reach` maps onto the
stored rows (`insertJob` dedups per row) and the response's
`requestedTotal` is summed from them, so nothing claims the wider scope.
A real second click mints a new key.

**Cost of the second preview query.** Measured 2026-09-19 on the local
dev database (104k-message mailbox, the 1,000-sender maximum selection,
five runs, host under load): the inbox grouped query ran ~8 ms warm and
the all-mail one ~62 ms warm (527 ms on the first cold run). They run
in parallel, so the preview pays roughly +55 ms at the worst-case
selection. Not measured on the production database.

## Amendment 2026-09-19 (b) — one rule for where the reach choice appears

**Trigger.** Founder review the same day: "is Inbox + archived available
everywhere it should be?" A survey of every surface that acts on a
sender's mail found the choice on Senders (single + bulk), Sender
Detail and the Screener, and missing from exactly one hand-driven
Delete: Triage's.

**The rule (founder-ratified).** Wherever a person Deletes a sender's
mail by hand behind a preview, the same "Inbox only / Inbox +
archived" choice appears, defaulting to Inbox only. Nowhere else.

- **Triage Delete gains the choice.** Delete is never a
  remember-preference verb in Triage (`RememberableVerb` excludes it),
  so the sheet is its only preview and the only place the chips render.
  The armed count, title, lead, caption, sample rows, the Gmail verify
  link and the footer all follow the selected reach; the reach resets
  to `inbox_only` whenever the pending action changes.
- **Hidden in onboarding's first cleanup** (`journey = 'first_relief'`).
  A first session stays about the inbox; the option is met later on
  Senders / Triage.
- **Empty inbox keeps `Inbox only` selected.** The wider delete is
  always a deliberate click; the existing hint points at the chip.
- **Archive and Later never reach archived mail.** Archive there is a
  no-op; Later would file years of archived mail under the Later label
  and then drop all of it into the inbox on the wake date.
- **Autopilot never touches archived mail.** No per-run preview, and no
  Delete preset exists. Triage's domain batch and the Brief's
  noise-archive offer no Delete, so they have nothing to widen.

No API, worker or schema change for this amendment — Triage's Delete
already rides `enqueueComposite`, which has accepted `reach` since the
original decision.
