# ADR-0006: Unsubscribe cascade — RFC 8058 one-click, mailto deferred manual, fallback none

- **Status:** Accepted
- **Date:** 2026-05-23
- **Deciders:** founder, Claude (agent)
- **Related D-decisions:** D9 (Unsubscribe behavior — auto-try RFC 8058 → mailto → fallback), D230 (mailto unsubscribe deferred to manual-only at launch), D7 / D228 (storage allowlist — amended by ADR-0004)

## Context

D9 defines a three-step cascade for the "U" of K/A/U/L: prefer RFC 8058
one-click POST when the message advertises it; fall back to a
DeclutrMail-sent mailto opt-out when only a `mailto:` URL is present;
otherwise log "no unsubscribe link available" and rely on auto-archive.

D230 then patched D9: the mailto step is **manual-only at launch**.
DeclutrMail does not send opt-out mail from its no-reply address —
many list processors reject unsubscribes that don't come from the
subscribed address, so silent failures would damage the trust wedge.
The mailto path becomes "open a Gmail compose draft pre-filled with the
mailto address" — initiated by the user, sent by the user.

ADR-0004 amended the D7 storage allowlist with the headers needed to
support D9: `List-Unsubscribe`, `List-Unsubscribe-Post`. PR #23 captures
those headers and persists three fields per message
(`unsubscribe_url`, `unsubscribe_mailto_url`, `unsubscribe_one_click`)
plus two fields per sender (`unsubscribe_method`, `unsubscribe_url`).

The remaining design question — what PR #23 actually decides — is how
the per-message header data aggregates into a single per-sender method
that the product surface (K/A/U/L action sheet, sender detail) can
act on. D9 names three sender-level outcomes; D230 narrows the middle
outcome from "auto-send" to "open in Gmail"; the storage layer needs
to encode which of the three a sender will take WITHOUT pre-committing
to an executor that doesn't exist yet.

The header reality also forced a split that D9 didn't anticipate: a
single `List-Unsubscribe` value can carry BOTH a `mailto:` URL AND an
`https://` URL — they are alternative channels offered by the sender,
not a one-or-the-other choice. Collapsing them into a single
`unsubscribe_url` column (the original migration shape) made it
impossible for the aggregator to honor "prefer one-click, fall back to
mailto" without losing data.

## Decision

The unsubscribe cascade is encoded as a **`gmail_unsubscribe_method`
Postgres enum** with three values — `one_click`, `mailto`, `none` —
derived per sender by `building_sender_index` from the per-message
header fields. The derivation rule is fixed:

1. If ANY message from this sender carries `unsubscribe_one_click = true`
   AND an `https://` URL → `method = one_click`,
   `unsubscribe_url = <first https URL seen>`.
2. Else if ANY message carries a `mailto:` URL → `method = mailto`,
   `unsubscribe_url = <first mailto URL seen>`.
3. Else → `method = none`, `unsubscribe_url = null`.

The HTTPS and mailto channels are stored in **separate columns**
(`unsubscribe_url` + `unsubscribe_mailto_url` on `mail_messages`) so
the aggregator never has to guess which channel a URL belongs to. A
plain HTTPS URL without the RFC 8058 `List-Unsubscribe-Post:
List-Unsubscribe=One-Click` header does NOT surface as `one_click` —
it's not actionable until the HTTPS-link executor lands as its own
PR + new D-candidate.

D230's "manual mailto" instruction is honored by **what the product
does** with `method = mailto`, not by the enum. The enum records what
the sender supports; the executor (or non-executor) decides what to
do with it. At launch, `method = mailto` opens a Gmail compose deep
link; in V2.1, an auto-archive fallback pairs with it.

PR #23 captures the data and computes the derivation. It does NOT
execute the one-click POST — execution is a destructive Gmail-side
action and ships in its own PR per CLAUDE.md §9 stop-conditions and
ADR-0004's scope boundary.

## Alternatives considered

- **Single `unsubscribe_url` column** (the original migration shape) —
  rejected by the iter-5 review of PR #23: a message offering BOTH
  `mailto:` AND `https://` could only store one, forcing the aggregator
  to guess. Splitting into two columns (`unsubscribe_url` HTTPS +
  `unsubscribe_mailto_url`) makes the derivation provably correct.
- **Boolean `auto_unsubscribable` flag** (no enum) — rejected: D9's
  cascade has three states, and the product surface needs to
  distinguish "one-click silent" from "manual via Gmail" (D230's
  exact wording for the action sheet copy: "One-click" vs "Manual via
  Gmail"). A boolean would force a second flag to encode the same
  information.
- **Per-message decision at click time** (no aggregate) — rejected:
  the Senders list and sender-detail UI need to show
  "auto-unsubscribable" status PER SENDER, before any specific message
  is selected. Aggregation has to happen at index-build time, not at
  action time.
- **Treat any HTTPS URL as one-click** — rejected: RFC 8058 explicitly
  requires the `List-Unsubscribe-Post: List-Unsubscribe=One-Click`
  header to opt the sender into POST handling. Hitting an HTTPS URL
  that wasn't designed for one-click POST is undefined behavior; some
  senders return a confirmation page, some 405. The `oneClick` flag is
  set only when the post-header is present AND an HTTPS URL exists.
- **Auto-send the mailto opt-out** (D9's original step 2) — superseded
  by D230. Re-litigated outside this ADR.

## Consequences

### Positive

- `senders.unsubscribe_method` is the single field the product surface
  consults — UI, action sheet, telemetry, and Autopilot rule
  evaluation all share one source of truth.
- The HTTPS / mailto channel split makes the "Option B" derivation
  rule provably correct: a sender row's `(method, url)` pair always
  agrees (no `method='mailto'` carrying an `https://` URL, no
  `method='one_click'` without a post-header confirmation).
- D9's cascade encoded in data: enabling the one-click executor in a
  future PR is purely a write-path change. No re-sync, no migration.
- D230's "manual mailto" copy maps 1:1 to a single enum value;
  changing the executor strategy later (e.g., adding a no-reply path
  for senders known to accept it) is a behavior change at the action
  layer, not a data shape change.

### Negative

- The `gmail_unsubscribe_method` enum has a fixed value set —
  introducing a new method (e.g., `https_link`, `webform`) requires a
  Postgres `ALTER TYPE ... ADD VALUE` migration. Acceptable: each new
  method is a deliberate D-decision, not a frequent occurrence.
- "Plain HTTPS URL without RFC 8058" is invisible to the product at
  launch. Senders using non-conformant HTTPS unsubscribe links
  effectively get `method = none` until the HTTPS-link executor
  ships. Telemetry can quantify the gap.
- Aggregation runs once per sync via `building_sender_index`; a sender
  whose method changes (e.g., started advertising one-click after the
  sync) won't be re-derived until the next aggregation pass. A
  periodic re-derive backstop is tracked as a D-candidate after PR-D
  lands.

### Neutral

- The aggregator filters to inbound (`is_outbound = false`) per
  ADR-0004 — the user's own SENT mail never appears as a sender, so
  its `List-Unsubscribe` headers (rare in outbound mail anyway) are
  ignored.
- Header parsing is centralized in `packages/workers/src/header-parsing.ts`,
  reusable by future workers (e.g., incremental sync per D5 / PR-D).
  Returns `{ httpsUrl, mailtoUrl, oneClick }`; sender-method derivation
  lives in `initial-sync.worker.ts` (`deriveUnsubscribe()`).

## Implementation notes

- `packages/db/migrations/0003_sync_data_capture.sql` — adds the
  `gmail_unsubscribe_method` enum, four `mail_messages` columns,
  two `senders` columns. Round-trip test updated for the new enum.
- `packages/db/migrations/0004_unsubscribe_mailto_and_keyset_idx.sql` —
  iter-5 fix: splits the HTTPS / mailto channels into
  `unsubscribe_url` + new `unsubscribe_mailto_url`. Same migration adds
  the `(mailbox_account_id, id)` composite index used by the
  keyset-paginated sender-rebuild streamer.
- `packages/workers/src/header-parsing.ts` — `parseListUnsubscribe()`:
  returns `{ httpsUrl, mailtoUrl, oneClick }`. One-click requires BOTH
  an HTTPS URL AND the post-header advertising `one-click` (case
  insensitive).
- `packages/workers/src/initial-sync.worker.ts` — `deriveUnsubscribe()`
  implements the three-step cascade against an aggregated
  `SenderAggregate { httpsUrl, mailtoUrl, oneClick }`.
- 13 new header-parsing unit tests + 3 integration tests in
  `initial-sync.worker.test.ts` covering `one_click`, `mailto`, and
  `none` outcomes against PGlite.

## Scope boundary — capture + derivation only

This ADR records the **classification** decision: how stored header
data maps to the sender-level method enum. It does NOT cover:

- **One-click POST execution** — a destructive Gmail-side action.
  Ships in its own PR with audit / activity-log wiring (D232 undo
  journal awareness), retry + timeout policy as a new D-candidate,
  HTTPS-only guard, and the `never-execute-on-method≠one_click`
  invariant.
- **Mailto Gmail-compose deep link UI** — D230's manual path. UX
  copy + `GmailOpenLinkService` integration (D231) ship with the
  triage UI.
- **Auto-archive fallback** — D9 step 4 + D230's V2.1 pairing.

Each of those is its own PR + (where applicable) its own D-candidate.

## References

- `docs/execution/Implementation-Plan.md` — D9, D230, D7, D228
- `docs/adr/0004-d7-allowlist-amendment-data-capture.md` — the
  upstream allowlist amendment that made these headers storable
- `packages/db/migrations/0003_sync_data_capture.sql`
- `packages/db/migrations/0004_unsubscribe_mailto_and_keyset_idx.sql`
- `packages/workers/src/header-parsing.ts`
- PR #23 — `feat(sync): Widen D7 allowlist + capture SENT (D9,
  ADR-0004)` (commit `5695d6a`)
