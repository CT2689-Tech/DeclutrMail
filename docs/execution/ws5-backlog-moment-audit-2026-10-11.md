# WS5 backlog moment — 2026-10-11

## Scope

One branch, `codex/ws5-backlog-moment`, against main plus the cherry-picked
WS1a stub commit `0444c4fd` (source `5347ac42` on `codex/ws1a-pricing-foundation`,
PR #977, still open at the time of this record). Relates to D226, D245, and D248.
Does not close those rows.

Shipped:

- F1. Unsubscribe plus backlog. The archive or delete composite is enqueued
  before any unsubscribe intent. A 402 `FREE_CAP_REACHED` leaves zero
  unsubscribe intents and zero unsubscribe jobs. Undo reverts the cleanup only.
- G1. `GET /api/mailboxes/:id/inbox-report`. Aggregates from stored metadata.
  Cache row `inbox_report_cache`, invalidated when the latest succeeded sync
  run id changes. Mailbox purge deletes the cache. Privacy static test rejects
  subject, snippet, brief, and LLM references in the report production files.
- G2. First-landing panel, calm fallback, one-tap fix that opens the F1 dialog
  prefilled and does not confirm, celebration without a size claim, home card
  export. Seen state is `localStorage` (`dm-inbox-report-dismissed:{mailboxId}`)
  because the preferences API only accepts known patches.
- F2. Read-only "Largest senders" and `≈ {size}` are live. Sum is inbound
  `mail_messages.size_bytes`, including Trash, excluding outbound. There is
  no size-view switch.

Cut:

- G3 share card. The plan lists it as the first cut. This PR does not ship
  the share control or a share switch. Deck `share.*` strings stay. No
  client card renderer.

## Decisions assumed

- VIP is not an exclusion. D245 retired VIP and `senders` has no `is_vip`
  column. The fix set excludes Protected, senders the user has written to,
  and Keep policies.
- Pass is not in the current tier manifest. The upgrade block uses Plus as
  the primary (`report.upgrade.plus.passOff`) until `BILLING_PASS_ENABLED`.
  The report panel is a client component, so it reads
  `NEXT_PUBLIC_BILLING_PASS_ENABLED` (falling back to `BILLING_PASS_ENABLED`).
  Set both when the pass goes live. Prices come from `TIER_MANIFEST`, not a
  hardcoded dollar amount.
- The review link is `/senders?fix={ids}` until WS2 exports `sendersFixSetHref`.
- Dialog primitives are the current PreviewSheet until WS2a lands. Rebase once
  after #977 merges.
- `sizeEstimate` is already on the metadata fetch. `getMessageMetadata` uses
  `format=metadata` with no `fields` mask, and copies a finite
  `json.sizeEstimate` onto `sizeBytes`. Initial and incremental sync persist
  that value. No backfill in this PR.

## Read-only size null check

Chintan can run this. It does not write.

```sql
SELECT COUNT(*) AS messages,
       COUNT(*) FILTER (WHERE size_bytes IS NULL) AS size_null,
       ROUND(
         100.0 * COUNT(*) FILTER (WHERE size_bytes IS NULL) / NULLIF(COUNT(*), 0),
         2
       ) AS null_pct
FROM mail_messages;
```

A 2026-10-10 production check, recorded in the WS5 prompt, reported `size_bytes`
populated on 100% of rows. This query is the re-check. A non-zero null percent
means those rows sort last and show no size. It does not by itself justify a
backfill.

## Production steps

- The Inbox Report, Unsubscribe with archive or delete, and the read-only
  size view are live on merge. There is no size-view switch and no share
  switch.
- Set `NEXT_PUBLIC_BILLING_PASS_ENABLED` alongside `BILLING_PASS_ENABLED`
  when the pass goes live. The web panel cannot see the server-only flag.
- The privacy inventory purpose for `message-size-estimate` now also names
  Inbox Report storage insights and the read-only size-by-sender view. Regenerate
  the public storage list from the registry before publishing the privacy page.
- `inbox_report_cache` is a derived dataset with removal trigger
  `delete-indexed-data`. Purge deletes it explicitly because the mailbox row
  is kept.

## Verification

- F1: `apps/api/src/actions/unsubscribe-backlog.service.spec.ts`
- G1: `packages/shared/src/inbox-report/select.test.ts`,
  `apps/api/src/inbox-report/inbox-report.service.spec.ts`,
  `apps/api/src/inbox-report/inbox-report.privacy.spec.ts`
- G2: `packages/shared/src/inbox-report/present.test.ts`,
  `apps/web/src/features/inbox-report/panel.test.tsx`
- F2: `apps/api/src/senders/senders.size-view.spec.ts`,
  `apps/web/src/features/senders/sender-size.test.ts`,
  SortMenu and SenderRow cases in the existing senders tests

Local typecheck passed for `@declutrmail/api`, `@declutrmail/web`, and
`@declutrmail/shared` after the dialog optional-prop fix. Playwright visual
regression against the inbox-report mocks and a phone viewport assertion were
not run in this session. No preview deploy exists until this branch is pushed.
