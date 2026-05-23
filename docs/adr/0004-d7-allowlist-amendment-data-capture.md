# ADR-0004: D7 storage-allowlist amendment — capture To/Cc + List-Unsubscribe + outbound tagging

- **Status:** Accepted
- **Date:** 2026-05-22
- **Deciders:** founder (interview answers 2026-05-22), Claude (agent)
- **Related D-decisions:** D7 / D228 (privacy posture + body-storage allowlist), D9 (RFC 8058 auto-unsubscribe), D5 (Gmail quota + PR-D incremental sync cursor), D44/D45/D67/D84–D91 (future reply-attribution, VIP, Followups)

## Context

D7 / D228 lock the storage allowlist for Gmail metadata: sender (name +
email), subject, snippet, dates, label ids, read state. Headers outside
that set are banned. The allowlist is the trust wedge of the product.

PR-C/#18/#19 implements the initial-sync worker against that allowlist
strictly. The senders-backend plan §10 already records `has_attachment`
and per-attachment size as **permanently rejected** privacy-posture
extensions. Other fields whose product use is known and time-bounded
remain open.

In the 2026-05-22 interview the founder approved a coordinated set of
small allowlist extensions, with the rule "capture the *data* now to
avoid future re-syncs; defer derived *features* to their own PRs."
Three additions, each tied to a planned product capability:

1. **`To` and `Cc` headers** — needed by the future Sent-sync /
   reply-attribution engine (powers `sender_timeseries.reply_count` —
   D44/D45 — and Followups-Lite — D84–D91). Without recipients on
   stored outbound messages, the reply engine would require a full
   re-fetch of every SENT message at the time it lands.
2. **`List-Unsubscribe` + `List-Unsubscribe-Post`** (RFC 8058) — needed
   by D9 auto-unsubscribe (the "U" in K/A/U/L). Without these headers,
   only manual / mailto fallback is possible; the one-click path that
   D9 names as primary is unreachable.
3. **`is_outbound` column** on `mail_messages` — derived from
   `labelIds.includes('SENT')` at fetch time. Lets the sync ingest the
   user's own SENT mail (so reply attribution has data later) WITHOUT
   polluting `senders` with a row for the user's own address. Required
   to keep #1 from breaking the sender index.

## Decision

We **amend the D7 storage allowlist** with the four new fields and the
direction-tagging column. The amended allowlist:

| Field                                    | Source                              | Storage                                   |
| ---------------------------------------- | ----------------------------------- | ----------------------------------------- |
| Sender name + email                      | `From` header                       | `senders` (identity)                      |
| Subject                                  | `Subject` header                    | `mail_messages.subject`                   |
| Snippet                                  | Gmail `snippet`                     | `mail_messages.snippet` (varchar 300 cap) |
| Dates                                    | Gmail `internalDate`                | `mail_messages.internal_date`             |
| Gmail label ids                          | Gmail `labelIds`                    | `mail_messages.label_ids`                 |
| Read state                               | Derived from `UNREAD` label         | `mail_messages.is_unread`                 |
| **Recipients (outbound only)**           | `To` + `Cc` headers                 | `mail_messages.recipient_emails` (NULL inbound) |
| **Unsubscribe HTTPS URL**                | `List-Unsubscribe` (https URL)      | `mail_messages.unsubscribe_url`           |
| **Unsubscribe mailto URL**               | `List-Unsubscribe` (mailto URL)     | `mail_messages.unsubscribe_mailto_url`    |
| **Sender-level unsubscribe action**      | derived per Option B                | `senders.unsubscribe_url` + `senders.unsubscribe_method` enum |
| **Unsubscribe one-click flag**           | `List-Unsubscribe-Post` (RFC 8058) + HTTPS URL | `mail_messages.unsubscribe_one_click` |
| **Outbound flag**                        | Derived from `SENT` label           | `mail_messages.is_outbound`               |

The **permanent bans stand unchanged**: bodies (HTML + plain text),
attachments, inline images, raw MIME, `sizeEstimate`, attachment sizes
/ filenames, every header outside this table. `messages.get?format=metadata`
remains the only call shape.

## Alternatives considered

- **Defer all of #1–#3; ship them when the consumer features land.**
  Rejected — every deferred field becomes a future full-mailbox re-fetch
  (250K messages, multi-tens-of-minutes at quota). Capturing once at
  initial sync is cheaper for users and easier to reason about.
- **Capture but don't store** (read at use-time only). Rejected for
  `List-Unsubscribe` — D9 wants to show "auto-unsubscribable" status in
  the UI per-sender, which requires aggregation; reading at click time
  loses that. Rejected for `To`/`Cc` — re-fetching at use time means
  re-burning quota when reply attribution lands.
- **Add bodies / attachment metadata.** Rejected — outside the trust
  wedge (D7 / D228; senders-backend plan §10).

## Consequences

### Positive

- D9 auto-unsubscribe is buildable without a re-sync.
- Sent-sync / reply-attribution / Followups land as pure derivation
  steps (no new fetches needed).
- The privacy posture stays MAJORITY-banned — bodies, attachments,
  `sizeEstimate`, and every non-listed header remain forbidden. The
  storage allowlist grew by 4 fields; the "Full bodies fetched: 0"
  badge copy is unchanged.

### Negative

- Sync wall-clock grows ~5-15% per backfill: extra metadata headers
  add ~zero quota cost (`messages.get` is 5 units regardless of
  `metadataHeaders` length), but the message stream now includes
  outbound mail (10–30% of mailbox volume).
- The header allowlist is no longer "just `From` + `Subject`" — the
  privacy-auditor gate's reference list grows.

### Neutral

- `mail_messages.is_outbound` is derived, not provider-sourced, so it
  costs no Gmail API call.
- `senders.unsubscribe_method` and `senders.unsubscribe_url` are
  populated by `building_sender_index` from the per-message data; no
  separate fetch.

## Implementation notes

- Migration `0003_sync_data_capture.sql` adds the original 4
  `mail_messages` columns + 2 `senders` columns + the
  `gmail_unsubscribe_method` enum.
- Migration `0004_unsubscribe_mailto_and_keyset_idx.sql` (Codex iter 5
  fix, 2026-05-22) splits the unsubscribe HTTPS / mailto channels
  across two columns (`unsubscribe_url` + new `unsubscribe_mailto_url`)
  so `building_sender_index` can never emit a sender row whose
  `method='mailto'` carries an `https://` URL. Same migration adds
  the `(mailbox_account_id, id)` composite index that the
  keyset-paginated sender-rebuild streamer relies on.
- `GmailClientService.METADATA_HEADERS` extends to
  `['From', 'Subject', 'To', 'Cc', 'List-Unsubscribe', 'List-Unsubscribe-Post']`.
- Outbound messages SKIP `senders` identity upsert during fetch;
  `building_sender_index` filters to inbound (`is_outbound = false`).
- Header parsing lives in `packages/workers/src/header-parsing.ts`
  (`parseRecipients`, `parseListUnsubscribe`), unit-tested. The
  parser returns `{ httpsUrl, mailtoUrl, oneClick }` — channels are
  kept separate so the aggregator can apply Option B sender-method
  derivation: `one_click` (HTTPS + RFC 8058 post header) →
  `mailto` (mailto channel present) → `none`. Plain HTTPS without
  one-click does NOT surface as an actionable sender method until the
  product supports HTTPS-link unsubscribe (D230 keeps mailto manual at
  launch; the HTTPS-link executor is its own follow-up PR + new D-
  candidate).

## Scope boundary — capture only

This ADR records the **data capture** decision. It does NOT cover
execution of one-click unsubscribe. RFC 8058 POST-mode is a destructive
Gmail-side action (CLAUDE.md §9 stop-condition: founder approval) and
ships in its own PR with:

- audit / activity-log wiring (D232 undo journal awareness)
- retry + timeout policy as an explicit D-candidate
- HTTPS-only guard (cleartext `http:` is already dropped at parse time)
- never-execute-on-method≠one_click invariant

Tracked as a follow-up in `FOUNDER-FOLLOWUPS.md`.

## CLAUDE.md follow-up

CLAUDE.md §2.1 lists the storage allowlist explicitly. Agents do not
edit CLAUDE.md directly (CLAUDE.md §11) — the founder distills the new
fields into §2.1 in a separate `chore/distill-*` PR. Tracked in
`FOUNDER-FOLLOWUPS.md` (2026-05-22).

## References

- `docs/execution/Implementation-Plan.md` — D7, D9, D228
- `docs/execution/senders-backend-plan.md` §10 (attachment-metadata
  decision precedent)
- `packages/db/migrations/0003_sync_data_capture.sql`
- `packages/db/migrations/0004_unsubscribe_mailto_and_keyset_idx.sql`
- Founder interview, 2026-05-22 (this session) — answers documented in
  the corresponding PR body.
