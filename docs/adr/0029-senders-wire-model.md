# ADR-0029: The senders wire row IS the model; derived fields extend it by spread

- **Status:** Accepted
- **Date:** 2026-07-28 (documenting a decision implemented 2026-07-16/17)
- **Deciders:** founder, Claude
- **Related D-decisions:** D38 (reclaimed — see "Relationship to D38"), D245

## Context

Every senders surface — list, grid, detail, compose strip, bulk bar —
reads one sender object. Until 2026-07-16 that object was assembled by a
hand-written adapter that read named fields off the wire row and copied
them into a locally-declared shape.

Hand-mapped adapters have two failure modes, and both had already
happened here:

1. **Silent field loss.** A field added to the server response but not to
   the adapter simply does not exist downstream. `repliedCount` was added
   to the wire and vanished before render; nothing failed, no type
   errored, the number was just absent from every surface that wanted it.
2. **Nullable coercion.** An adapter that defaults a missing value turns
   "we don't know" into a positive claim. `readRate: null` — meaning the
   sender has no measurable read signal — was rendered as **"Never
   read"**, which asserts the opposite of not knowing.

Both are the dominant defect family in this codebase: a surface asserting
something it does not know. The second is worse than the first, because a
dropped field is invisible while a coerced null is a confident lie.

Fixing the instances was not enough — a new wire field arrives roughly
every other senders PR, so any solution that depends on someone
remembering to update a second list will regress. The constraint was
therefore: make the failure _impossible to express_, not merely caught in
review.

## Decision

The wire row is the model. `Sender` is defined as the server shape
intersected with a small additive set of presentation fields:

```ts
export type Sender = SenderListRow & DerivedSenderFields;
```

`enrichSenderRow` builds it with a spread of the wire row, so every field
the backend sends rides through **by construction**. Nullable wire fields
stay nullable all the way to the render — a `null` is carried, never
defaulted, and each surface decides how to say "unknown".

Derived fields are additive only. A compile-time assertion enforces that
no derived key can shadow a wire key:

```ts
type _DerivedShadowsWire = Extract<keyof DerivedSenderFields, keyof SenderListRow>;
const _assertNoShadow: _DerivedShadowsWire extends never ? true : never = true;
```

If a derived field is ever named the same as a wire field, the build
fails rather than letting a computed value quietly replace a real one.

## Alternatives considered

- **Keep the hand-written adapter, add tests.** Rejected: tests can only
  catch fields that already exist. The defect is a field added tomorrow,
  and no test written today asserts anything about it.
- **Generate the adapter from the OpenAPI schema.** Rejected: it removes
  the manual step but keeps the second list. A generator that has not
  been re-run is exactly a stale adapter, and the staleness is now
  invisible in a build artifact rather than in reviewable source.
- **Zod-parse the wire row and remap.** Rejected: runtime validation at
  the boundary is worth having (see the separate Activity-envelope
  followup), but remapping after parsing reintroduces the same
  field-by-field list. Parse and spread are compatible; parse and _remap_
  is not the fix.
- **Make every wire field non-nullable with server-side defaults.**
  Rejected outright: it moves the lie upstream. "Unknown" is a real state
  and the product's trust posture depends on rendering it as unknown.

## Consequences

### Positive

- A new backend field reaches every senders surface with no client
  change. The class of "field added, silently dropped" cannot occur.
- `null` survives to the render, so a surface must handle "we don't know"
  explicitly instead of inheriting a default that reads as fact.
- The no-shadow assertion turns a subtle correctness bug into a compile
  error.
- One model for every senders surface, so list and detail cannot disagree
  about the same sender.

### Negative

- The client type is coupled to the wire type: a breaking rename on the
  server breaks the client build. This is the intended trade — a loud
  break beats a silent drop — but it does mean wire renames are no longer
  absorbable client-side.
- Wire field names leak into component props. Some read less naturally
  than a bespoke client name would.

### Neutral

- Derived fields stay deliberately few. Anything needing more than a
  trivial computation belongs in a selector, not in `DerivedSenderFields`.

## Implementation notes

- `apps/web/src/features/senders/data.ts` — `Sender`, `DerivedSenderFields`,
  `enrichSenderRow`, and the no-shadow assertion.
- `apps/web/src/lib/api/senders.ts` — `SenderListRow`, the source of truth
  for the wire shape.
- Shipped by PR #339 (2026-07-16).
- When adding a derived field, confirm the name does not exist on
  `SenderListRow`; the assertion will tell you, but naming it distinctly
  up front is cheaper.

## Relationship to D38

Two PRs cited `Closes D38` — **#339** (this wire model) and **#343**
(one rolling-30-day window shared by the list and detail read paths).
Neither is D38, which is "First-time education: onboarding-only tour +
tooltips", a feature that has never been built. That mis-tag left
`IMPLEMENTATION-LOG.md` asserting the tour was shipped.

**#343 is recorded here too**, because reverting D38 to ⬜ would
otherwise leave it with no home at all — the same defect this ADR
exists to correct. Its invariant belongs to the same seam: `GET
/api/senders` and `GET /api/senders/:id` returned the same field names
computed over different windows (rolling 30 days vs latest calendar
month), so the product contradicted itself about one sender — the list
showed `readRate` unknown while the detail asserted "100% marked read".
The fix extracted `buildRollingWindowSubqueries()` so both paths share
**one** definition rather than mirroring it, and kept `readRate`
nullable on an empty window. **Rule: a field name means one thing
across every endpoint that returns it; if two paths compute it, they
share the computation rather than reimplement it.**

Recording the wire model here rather than as a new D-decision follows the
registry rule adopted 2026-07-28: **a D-number is something you will ask
"is it built yet?" about; an ADR is a rule that constrains how code gets
written.** This is the latter — it is already built, and its lasting value
is the constraint on future code. D38 returns to ⬜ Not started for its own
unbuilt scope.

## References

- ADR-0016 — senders visual language (the surfaces that consume this model)
- ADR-0012 — senders intent groups
- D245 — unified product clarity and control contract
