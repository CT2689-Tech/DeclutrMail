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
