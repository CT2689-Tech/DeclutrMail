# ADR-0038: The Data API roles hold no privileges in `public`

- **Status:** Accepted
- **Date:** 2026-08-21
- **Deciders:** founder, Claude
- **Related D-decisions:** D7, D150

## Context

DeclutrMail's database is a Supabase project, but the product does not
use Supabase the way Supabase assumes. The API and the workers open
ordinary Postgres connections as the `postgres` role through Supavisor —
transaction pooler for general work, session pooler for advisory locks
and `LISTEN`. Nothing in the product calls PostgREST, and no client-side
code holds a Supabase key.

Supabase's bootstrap does not know that. It grants the two Data API
roles, `anon` and `authenticated`, full DML across `public`, on the
premise that browser traffic will arrive through PostgREST with
row-level security as the only thing standing between a request and a
row. On 2026-08-21 each role held 252 table grants in `public`.

Nothing leaked, because the D7 posture already covers it from the other
side: all 36 tables in `public` have row-level security enabled with zero
policies, and zero policies means deny-all for any role that does not
bypass RLS. `postgres` bypasses it; `anon` and `authenticated` do not.
The Supabase advisor reports those 36 tables as `rls_enabled_no_policy`
and always will — that lint is a description of the design, not a finding
against it.

What made this worth deciding rather than ignoring is the shape of the
dependency. One control was carrying the whole load, and the control
underneath it was wide open. PostgREST is running on the project right
now (`authenticator`, two idle backends): idle because nothing calls it,
not because it is switched off. A future table shipped with RLS relaxed,
or a Data API toggle flipped in the dashboard, would land directly on
live grants. The Supabase linter does not check grants at all, so nothing
in the existing gate network would have said a word.

## Decision

We revoke all privileges on tables, sequences and functions in `public`
from `anon` and `authenticated`, and revoke the default privileges that
would re-grant them to future objects. The app path is unchanged: it
connects as `postgres`, which bypasses row-level security. Row-level
security remains the primary gate; these grants are the second one.

No RLS policy may be added to satisfy a linter. A policy that grants
`anon` or `authenticated` read access to mail-derived data creates a path
to Gmail-derived rows that does not exist today, which D7 forbids.

## Alternatives considered

- **Leave the grants, rely on RLS alone:** rejected because it makes a
  single control load-bearing for the product's central privacy promise,
  and because the failure mode is silent — no advisor, gate agent or test
  in this repo inspects grants.
- **Also revoke `USAGE` on the schema:** rejected because with no table,
  sequence or function grants, schema usage conveys nothing readable, and
  revoking it reaches into Supabase's own dashboard introspection for no
  additional safety.
- **Add explicit deny policies:** rejected as a misreading of Postgres.
  RLS is deny-by-default; zero policies already denies everything, and a
  written policy could only widen access.
- **Drop the roles entirely:** rejected because they are Supabase
  platform roles; removing them is unsupported and would break project
  provisioning.

## Consequences

### Positive

- Two independent controls now stand between the public internet and
  mail-derived rows, and they fail independently.
- Turning the Data API on becomes a deliberate act that must also grant
  privileges, rather than a switch that exposes what is already granted.

### Negative

- Anyone who later wants a genuine Data API surface must grant privileges
  explicitly and write policies for it. That is more work than it would
  have been, which is the point.
- `ALTER DEFAULT PRIVILEGES` binds to the role that runs it. Migrations
  run as `postgres` via `SUPABASE_SESSION_DSN`, which is also the role
  that creates tables, so the path that matters is covered — but an
  object created by `supabase_admin` would still inherit Supabase's own
  defaults.

### Neutral

- The 36 `rls_enabled_no_policy` advisor notices do not change. They
  describe the deny-all design and should not be treated as a backlog.
- The migration guards on role existence: `anon` and `authenticated` do
  not exist on vanilla Postgres, so the local dev database and the D183
  testcontainers suite skip the revoke rather than aborting the run.
