# ADR-0039: An id that crosses the API boundary is a contract

- **Status:** Accepted
- **Date:** 2026-08-25
- **Deciders:** founder, Claude
- **Related D-decisions:** D150, D226

## Context

Most tables here carry `id: uuid('id').primaryKey().defaultRandom()`. For
the majority that is exactly right: the row is reached by a foreign key
or by its natural key, and the surrogate is an implementation detail no
caller ever names.

`senders.id` was not in that majority. The API hands it to the frontend,
which puts it in `/senders/:id` URLs, TanStack query keys, selection
sets, and the `senderId` an open confirm modal sends to
`GET /api/actions/preview`. Nothing in the type system distinguished
those two situations, so the same `defaultRandom()` spelling meant "an
internal row number" on one table and "a public handle" on another.

`InitialSyncWorker.buildSenderIndex` rebuilds the sender index by
`DELETE … WHERE mailbox_account_id = $1` followed by a plain `INSERT` —
a deliberate design, because nuke-and-reinsert is what closes the derived
counter drift that selective deletes left behind (ADR-0014
§Reconciliation). With a random default, that rebuild reissued every
sender id in the mailbox.

On 2026-08-25 an initial sync committed at 08:05:17 while the founder had
the Senders page open, loaded at 08:03.
`GET /api/actions/preview?senderId=018db6ee…` returned **200 at 08:03:52
and 404 at 08:06:21 for the same sender**. Every id the page held was
dangling; the confirm modal's "Retry preview" button refetched the same
dead id and could never succeed. Nothing foreign-keys to `senders.id` —
every durable consumer joins on `sender_key` — so there was no data loss,
no cascade, and no failing test. The rebuild's suite was green throughout,
because every assertion was about counts and rows, never about identity
surviving the churn.

A sweep of every teardown site found no second instance. The other
rebuild targets are safe for reasons that are worth writing down, because
they are the reasons _this_ rule is narrow: `sender_timeseries` and
`mailbox_labels` have composite natural primary keys; `mail_messages` is
upserted on `(mailbox_account_id, provider_message_id)` and only ever
deletes messages genuinely gone from Gmail; `rule_match_log` rows are
destroyed on purpose and never re-created; the rest belong to account or
mailbox deletion, where nothing comes back.

## Decision

An identifier that leaves the database — in a URL, an API response, a
client cache key, or another row that is not a foreign key — is a
contract with whoever holds it. Where its table can be torn down and
rebuilt, the identifier MUST be **derived from the row's natural key**
rather than randomly generated, so the rebuild reproduces it.

For `senders.id` that derivation is `deriveSenderId(mailboxAccountId,
senderKey)` (`packages/db/src/sender-id.ts`) — a SHA-256 of the pair that
`senders_account_sender_key_uniq` already declares unique, formatted as
an RFC 9562 version-8 UUID so the column type and every `isUuid` guard
are unchanged.

## Alternatives considered

- **Turn the rebuild into an upsert on `(mailbox_account_id,
sender_key)`:** rejected because the teardown is load-bearing. ADR-0014
  records that selective `NOT IN (surviving)` deletes stranded
  `(sender_key, year_month)` rows for survivors who lost a month's mail,
  drifting historical volume upward forever. Deriving the id keeps
  identity without touching the atomicity argument.
- **Let the frontend recover instead — treat a 404 as "index rebuilt"
  and refetch the list:** rejected as the primary fix. It restores the
  page but not the user's place, and it leaves every OTHER holder of a
  sender id — a bookmarked `/senders/:id`, an `action_jobs.selector`
  written for audit — silently dangling. Shipped as the second layer, not
  the first.
- **Drop `.defaultRandom()` so Drizzle makes `id` required in
  `NewSender`:** the strongest form, since `tsc` would then catch a
  forgotten id at compile time. Deferred: only 2 of the 67
  `insert(senders)` call sites are production code, so it churns 65 test
  files for a guarantee the cross-writer tests already cover. Revisit if
  a third production writer ever appears.

## Consequences

### Positive

- A sender id survives an index rebuild, so open pages, bookmarked
  detail URLs, in-flight confirm modals and audit rows all keep resolving.
- No migration and no storage-shape change: the column stays `uuid`, and
  `.defaultRandom()` remains only as a fallback for a row inserted
  without one.
- `action_jobs.selector.senderId`, documented as "kept for audit/trace",
  becomes actually traceable rather than dangling at the next rebuild.

### Negative

- This is a **write-side convention**, not a database constraint. A
  future writer that omits `id:` silently gets a random one and
  reintroduces the defect. Two behavioural tests pin both current
  writers to the formula; a third writer needs the same assertion.
- Rows written before this landed keep their random ids until their
  mailbox's next rebuild, which flips them once and then never again.
  Acceptable only because DeclutrMail is prelaunch (CLAUDE.md §2.6).

### Neutral

- The derivation is namespaced (`declutrmail.sender.v1`) and pinned to a
  literal in `packages/db/tests/sender-id.test.ts`, so changing it is a
  deliberate, visible act rather than a silent reshuffle of every handle.

## Implementation notes

- `deriveSenderId` — `packages/db/src/sender-id.ts`, exported from
  `@declutrmail/db`.
- Applied at all three writers: `buildSenderIndex` and `toIdentityRow`
  (`initial-sync.worker.ts`), and the incremental sender upsert
  (`incremental-sync.worker.ts`).
- Regression tests: "sender id — the handle survives a rebuild" and
  "sender id — the incremental writer derives the SAME id the rebuild
  will". Both assert the FORMULA, not just stability, so the two writers
  cannot drift apart without one of them going red. Both were verified
  red against the pre-fix code.
- Second layer: `SENDER_NOT_FOUND` on a preview now renders a "Refresh
  senders" exit instead of a "Retry preview" button that cannot succeed
  (`confirm-action-modal.tsx`). Branch on the error CODE, not the status —
  `CurrentMailboxGuard` answers 404 for causes unrelated to the sender.

## References

- ADR-0014 — sender counter reconciliation; why the rebuild nukes rather
  than selectively deletes.
- ADR-0028 — action reach; why only Delete may act past the inbox.
- `MISTAKES.md` 2026-08-25 — "A surrogate primary key used as the
  frontend's sender handle".
