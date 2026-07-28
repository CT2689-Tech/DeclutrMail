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
   inbox-scoped). The composite _secondary_ Delete also stays
   inbox-only at this build.
3. **Persisted on the row** (`action_jobs.reach`, migration 0050),
   like `older_than_days`: the worker resolves exactly the set the
   preview counted. Reverse and recovery rows copy the forward value.
4. **Preview returns a parallel `allMail` block** (counts + top-5
   samples per window) alongside the inbox block, from one shared
   query builder (`previewBuckets`). Additive wire: an older web
   bundle ignores it; a newer web bundle treats its absence (older
   API) as "reach selection unavailable" and hides the chips.
5. **Undo restores each message to where it was.** The forward path
   records which resolved ids carried INBOX
   (`undo_journal.payload.inboxMessageIds`, read from the local
   mirror inside the terminal transaction, before the mirror update
   rewrites it). The revert applies the registry reverse
   (+INBOX/−TRASH) to that subset and only −TRASH to the archived
   rest — a blanket +INBOX would dump years of archived mail into the
   inbox on undo. A payload the split cannot be read from falls back
   to the uniform registry reverse (pre-ADR behavior).

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
