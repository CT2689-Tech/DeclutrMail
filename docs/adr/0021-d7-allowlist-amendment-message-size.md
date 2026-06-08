# ADR-0021: D7 storage-allowlist amendment — capture Gmail `sizeEstimate`

- **Status:** Accepted
- **Date:** 2026-06-06
- **Deciders:** founder (this session), Claude (agent)
- **Related D-decisions:** D7 / D228 (privacy posture + body-storage allowlist), D39 (Sender Detail Recent Messages section)
- **Amends:** ADR-0004 ("permanent ban on `sizeEstimate`" line in §"Decision" + §"Consequences")

## Context

D7 / D228 lock the storage allowlist for Gmail metadata. ADR-0004
extended the original sender/subject/snippet/dates/labels/read-state
allowlist with To/Cc, List-Unsubscribe, and `is_outbound`, and at the
same time named four fields as **permanently banned**: bodies (HTML +
plain text), attachments, inline images, raw MIME, **`sizeEstimate`**,
and attachment sizes / filenames.

The Sender Detail page renders a Recent Messages list (D39 #4, D41). The
size column has shipped since #44 displaying `0B` on every row — the
adapter (`apps/web/src/features/senders/api/adapters.ts:267`) hardcodes
`sizeBytes: 0` with the comment "Wire omits message size — render as
0B until BE adds the field". This is fake data (CLAUDE.md §10 "no fake
completion") that the founder discovered during a live smoke
2026-06-06 alongside two other Sender Detail bugs. We must either:

1. Render the truth (real bytes from Gmail's `sizeEstimate`), OR
2. Remove the size column entirely.

The founder picked (1). That requires reopening ADR-0004's "permanent
ban" on `sizeEstimate`.

`sizeEstimate` is a Gmail-side INTEGER returned in the metadata envelope
of `messages.get?format=metadata` — it is NOT in the body, NOT a
header, and conveys only the rough byte size of the encoded message.
It is the SAME class of metadata as `internalDate` and `labelIds`,
which D7 already permits. The original ban was conservative: founder
preferred to keep the surface area minimal until a product use case
materialized. That use case is now live (Recent Messages row size).

## Decision

We **amend the D7 storage allowlist** to include Gmail's `sizeEstimate`,
persisted as `mail_messages.size_bytes` (nullable INTEGER).

Updated allowlist (cumulative with ADR-0004):

| Field                                | Source                                         | Storage                                                            |
| ------------------------------------ | ---------------------------------------------- | ------------------------------------------------------------------ |
| Sender name + email                  | `From` header                                  | `senders` (identity)                                               |
| Subject                              | `Subject` header                               | `mail_messages.subject`                                            |
| Snippet                              | Gmail `snippet`                                | `mail_messages.snippet` (varchar 300 cap)                          |
| Dates                                | Gmail `internalDate`                           | `mail_messages.internal_date`                                      |
| Gmail label ids                      | Gmail `labelIds`                               | `mail_messages.label_ids`                                          |
| Read state                           | Derived from `UNREAD` label                    | `mail_messages.is_unread`                                          |
| Recipients (outbound only)           | `To` + `Cc` headers                            | `mail_messages.recipient_emails` (NULL inbound)                    |
| Unsubscribe HTTPS URL                | `List-Unsubscribe` (https URL)                 | `mail_messages.unsubscribe_url`                                    |
| Unsubscribe mailto URL               | `List-Unsubscribe` (mailto URL)                | `mail_messages.unsubscribe_mailto_url`                             |
| Sender-level unsubscribe action      | derived per Option B                           | `senders.unsubscribe_url` + `senders.unsubscribe_method` enum      |
| Unsubscribe one-click flag           | `List-Unsubscribe-Post` (RFC 8058) + HTTPS URL | `mail_messages.unsubscribe_one_click`                              |
| Outbound flag                        | Derived from `SENT` label                      | `mail_messages.is_outbound`                                        |
| **Message size estimate** (this ADR) | Gmail `sizeEstimate`                           | `mail_messages.size_bytes` (nullable; NULL for pre-amendment rows) |

The **permanent bans now stand at**: bodies (HTML + plain text),
attachments, inline images, raw MIME, attachment sizes / filenames
(per-attachment is still banned — this ADR amends ONLY the
whole-message integer), every header outside this table.
`messages.get?format=metadata` remains the only Gmail call shape.

The "Full bodies fetched: 0" trust artifact is unchanged: `sizeEstimate`
is in the metadata envelope and is NOT a body fetch. The badge copy
stays as-is.

## Alternatives considered

- **B: Remove the size cell entirely.** Smallest scope. Rejected by
  founder — the size signal IS valuable on Recent Messages (a 2MB
  newsletter vs a 4KB transactional differs in glanceability) and the
  trust posture survives the single-integer addition.
- **C: Don't persist; fetch fresh on render.** Cheapest infra-wise but
  loses the offline / Activity / future search use cases, AND each FE
  render of the Recent Messages list would burn 10 `messages.get` units
  per surface mount × users. Quota- and latency-prohibitive.
- **Per-attachment sizes** (the line ADR-0004 also banned). Out of
  scope. Whole-message integer is a different shape and a different
  product justification.

## Consequences

### Positive

- Sender Detail Recent Messages renders honest byte counts on
  forward-going syncs. The `0B` fake-data smell goes away.
- Pure derivation: no new Gmail API call shape; no extra quota cost.
  `messages.get?format=metadata` already returns `sizeEstimate` in the
  envelope; we simply stop discarding it.
- The trust badge ("Full bodies fetched: 0") is unaffected.

### Negative

- The privacy-posture commitment grows by one field. Documentation
  surface (CLAUDE.md §2.1, mail-messages.ts schema comment,
  privacy-auditor reference list) must be amended in lockstep.
- Existing rows persist NULL until either (a) a one-off backfill
  worker re-fetches every message id with `format=metadata` — quota-
  costly (~5 units × N existing messages) — or (b) we accept that old
  rows render an em-dash. **Founder direction: option (b)** — defer
  backfill; new messages from the amendment point forward carry real
  size.

### Neutral

- `size_bytes` is provider-sourced (Gmail's own integer); we do not
  compute it. If Gmail changes its estimate algorithm, our display
  changes in lockstep.

## Implementation notes

- Migration `0025_mail_messages_size_bytes.sql` adds
  `size_bytes INTEGER NULL` to `mail_messages`. Nullable to preserve
  existing rows + allow the worker to skip the field when Gmail
  occasionally omits it (defensive).
- `apps/api/src/gmail/gmail-client.service.ts`: `GmailGetResponse`
  surfaces `sizeEstimate?: number`. METADATA_HEADERS is unchanged.
- `packages/workers/src/ports.ts`: `GmailMessageMetadata` adds
  `sizeBytes?: number`.
- Both sync workers (`initial-sync.worker.ts`, `incremental-sync.worker.ts`)
  pass through the field on insert / update.
- Backend read service select adds the column;
  `MailMessageRow` BE + FE DTOs add `sizeBytes?: number`.
- FE adapter maps the wire field; absent → `null`. The render layer
  shows an em-dash for null OR zero (rather than "0B").
- `privacy-auditor` agent reference list grows by one entry. No new
  call shape, so the existing "format=metadata only" assertion remains.

## Scope boundary

This ADR is the **storage amendment** decision. Out of scope:

- One-off backfill of historical rows. If/when the founder wants it,
  it's a separate worker behind a job queue with explicit quota plan.
  Logged in `FOUNDER-FOLLOWUPS.md`.
- Surfacing size in Activity or Search. Each is its own product call.

## CLAUDE.md follow-up

CLAUDE.md §2.1 currently lists the storage allowlist with the original
fields plus the ADR-0004 amendments. It needs a third amendment to
add `Size` (or "Message size estimate") to the stored list and to
remove `sizeEstimate` from the forbidden list. Per CLAUDE.md §11,
agents do NOT edit CLAUDE.md directly — the founder distills via a
separate `chore/distill-*` PR. Tracked in `FOUNDER-FOLLOWUPS.md` (this
date).

## References

- ADR-0004 — original D7 storage-allowlist amendment (this one builds on it)
- `docs/execution/Implementation-Plan.md` — D7, D228
- `packages/db/migrations/0025_mail_messages_size_bytes.sql`
- `packages/db/src/schema/mail-messages.ts` — schema comment block (lines 15–58)
- Founder direction, 2026-06-06 (this session) — recorded in the PR body.
