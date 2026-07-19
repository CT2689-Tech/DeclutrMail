# ADR-0026: Server-side brand grouping (registrable-domain aggregation)

- **Status:** Accepted
- **Date:** 2026-07-18
- **Deciders:** founder, Claude (session 2026-07-18)
- **Related D-decisions:** D247 (new), supersedes the client-side rollup of D51

## Context

The Senders screen keys senders by exact From-address (one row per address,
D12/ADR-0011) so per-address `List-Unsubscribe` stays correct. A consequence:
one brand fragments across many rows — Macy's mails from `shop@emails.macys.com`,
`alert@em.macys.com`, `notify.macys.com`, `oes.macys.com`, … = 8 sender rows in
the founder's mailbox; Amazon = 97, Google = 113. To a user comparing against
Gmail's inbox, the product "doesn't show my real senders" — especially under the
`first_seen` ("Newest arrivals") sort, where fresh one-off sub-addresses surface
as `total=1` rows that look nothing like the recurring brands flooding Gmail.

D51 already shipped a **client-side** brand rollup (`domain-rollup.ts`), but only
in the **grid** view, always-on, folding over the _loaded page_. The **table**
view had no grouping at all. Client-side folding over the loaded page produces
**partial** brand totals until more pages load — the exact "surface asserts what
it doesn't know" bug class this codebase fights (see `MISTAKES.md`, the UI-truth
bug memory). The founder chose (2026-07-18) a **toggle, default-off** grouping
backed by **server-side, complete** aggregation, explicitly superseding D51's
client-side approach.

"Complete counts across pagination" requires aggregating over the whole matching
set in SQL (`GROUP BY` the brand), which requires the brand key to be a column.

## Decision

We materialise the **registrable domain (eTLD+1)** of each sender as a
`GENERATED ALWAYS AS (dm_registrable_domain(domain)) STORED` column
(`senders.registrable_domain`, migration 0047), indexed by
`(mailbox_account_id, registrable_domain)`. `dm_registrable_domain` is an
IMMUTABLE SQL function and is the **single source of truth** for eTLD+1. Brand
grouping is a server-side aggregation over this column; the client-side D51
rollup (and its TS `registrableDomain`) is removed.

## Alternatives considered

- **Keep D51 client-side, extend to table view:** rejected — folds over the
  loaded page only, so a brand card shows partial totals until scrolled; the
  founder explicitly declined this for the truth risk.
- **Compute eTLD+1 in app code, `GROUP BY domain` in SQL then fold in TS:**
  rejected — folding thousands of full-domains per request in app memory breaks
  the keyset-cursor model and doesn't paginate cleanly.
- **A plain column backfilled + maintained by the sync workers:** rejected —
  two impls of the eTLD+1 logic (SQL backfill + TS runtime) is a drift trap, and
  it touches the initial/incremental sync workers. The GENERATED column computes
  existing rows at ALTER time and every future write with no worker change.
- **Full Public Suffix List dependency:** rejected — ~200KB for a grouping
  heuristic. A short multi-part-suffix allowlist (co.uk, com.au, co.in, co.jp, …)
  covers observed mailboxes; worst case for an un-listed suffix is an over-eager
  group, and grouping is presentation-only (per-sender actions unaffected).

## Consequences

### Positive

- Brand cards carry **complete** counts (whole matching set, not the loaded
  page). Verified on the founder's mailbox: `macys.com` 8 rows→1, BofA 19/7195,
  Amazon 97/2341, Google 113/1507 — recognizable brands, correct totals.
- eTLD+1 has one source of truth (the SQL function); no dual-impl drift.
- No sync-worker changes; existing rows auto-populate on `ADD COLUMN`.

### Negative

- Introduces the codebase's first GENERATED column + first custom SQL function —
  a novel migration pattern for schema-migration-reviewer to vet.
- Grouping is presentation-only: there is no single brand-level unsubscribe.
  **Founder decision (2026-07-18):** a brand card's Unsubscribe **expands the
  card to member addresses**; the user unsubscribes per-address (or multi-selects
  members). No hidden fan-out abstraction; D226 preview + undo stay strictly
  per-address. A collapsed brand card therefore exposes no destructive verb —
  only aggregate facts and an expand affordance.

### Neutral

- Consumer mail providers (gmail.com, outlook.com, yahoo.com, …) resolve to
  themselves and are **excluded from grouping at query time** — 338 unrelated
  humans at gmail.com are not one "brand". Replied-to senders are likewise never
  rollup inventory (a relationship is not bulk mail), matching D51's exclusions.

## Implementation notes

**Landed (this session):**

- `packages/db/migrations/0047_senders_registrable_domain.sql` (+ `.rollback`) —
  function + generated column + index. Applied + smoked on dev; rollback verified.
- `packages/db/src/schema/senders.ts` — `registrableDomain` generated column +
  `registrableDomainIdx`.
- `apps/web/.../compose-strip.tsx` — relabel "Newest senders"→"Newest arrivals",
  "Oldest senders"→"Oldest arrivals" (the perception fix that started this).

**Remaining (staged):**

1. **API** — grouped list mode in `senders.read-service.ts`: a merged, keyset-
   paginated stream of brand-group rows (`GROUP BY registrable_domain HAVING
count>=3`, excluding consumer providers + `replied_count>0`) and ungrouped
   sender rows, reusing the existing compose-filter WHERE. New wire shape
   (group vs sender entry) + `group=domain` param + contract tests.
2. **FE** — `Group by brand` toggle (compose-strip + store + URL param, default
   off); render group rows in **table + grid** driven by the server; expand to
   member addresses; selection fans out to member ids; remove the client-side
   `rollupByDomain` + `domain-rollup.ts` `registrableDomain`; Storybook story;
   edge states.
3. **Docs/tracking** — D247 row in `IMPLEMENTATION-LOG.md`; note D51 rollup
   superseded (grid client-side path retired); PR body `Closes D247`.
4. **Gates + smoke** — privacy-auditor (no new Gmail fields — clean),
   architecture-guardian, design-system-agent, schema-migration-reviewer; full
   D206 dev-login smoke of the toggle across table/grid + selection + unsubscribe
   fan-out + empty/partial states.

## References

- D247 (founder decision, 2026-07-18); supersedes D51 client-side rollup.
- `apps/web/src/features/senders/domain-rollup.ts` (retiring), the prior
  client-side eTLD+1 + consumer-provider list ported into `dm_registrable_domain`.
