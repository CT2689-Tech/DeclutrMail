# ADR-0025: Centralized feature-flag manifest with env-var kill switches

- **Status:** Accepted
- **Date:** 2026-07-04
- **Deciders:** chintan.a.thakkar@gmail.com (requested), session agent (design)
- **Related D-decisions:** D19 (entitlements — the OTHER gating axis,
  deliberately separate), D200 (state boundaries — flags are neither
  server nor client state), D2 (dark mode rides the first flag)
- **Related ADRs:** none

## Context

The founder asked (2026-07-04) for "a gater/config file so that
complicated features are centralized and can be easily
enabled/disabled." Complicated surfaces were accumulating (dark mode,
grid peek, with E1–E6 enhancements queued) with no way to switch one
off in production short of a revert PR. Three existing mechanisms
almost-but-don't fit:

- **Entitlements (D19)** gate by PLAN — who may use a feature, not
  whether it exists. Conflating "kill switch" with "tier" would put
  operational toggles in the billing model.
- **User preferences** are per-user choices; a kill switch must win
  over any stored preference.
- **Env vars ad hoc** (`DEV_AUTH_ENABLED`) work but scatter — the exact
  centralization problem the founder named.

A vendor flag service (LaunchDarkly etc.) is rejected outright: new
billable dependency (ADR-0023 guardrail burden), runtime fetch on the
hot path, and solo-founder scale doesn't need percentage rollouts.

## Decision

1. **One manifest** — `packages/shared/src/flags/manifest.ts`
   (`FLAG_MANIFEST`), mirroring the D19 tier-manifest idiom: typed keys,
   ship-on defaults, a description that says exactly what disappears
   when the flag is off. Flipping in code is a one-value change there.

2. **Pure resolution** — `resolve.ts` takes an env record (never reads
   `process.env` itself): `DM_FLAG_<SNAKE_CASE>` overrides the default;
   unrecognized/unset values fall back to the manifest default so a
   typo can never silently flip a feature.

3. **Web wiring** — `apps/web/src/lib/flags.ts` lists one literal
   `process.env.NEXT_PUBLIC_DM_FLAG_*` read per flag (Next.js only
   inlines literal keys; a computed lookup would be `undefined` in the
   browser). A test fails if the manifest and this map drift. Flipping
   without a commit = set the Vercel env var + redeploy.

4. **API/worker wiring** — none until a server-side feature registers a
   flag; the pattern is `resolveFlag(flag, process.env[flagEnvKey(flag)])`
   at the consuming module.

5. **Semantics** — flags are OPERATIONAL kill switches. Off must
   degrade cleanly (feature affordance disappears; nothing else
   changes) and must win over stored user preferences — e.g.
   `darkMode` off skips `theme-init.js` entirely, so a stored dark
   preference cannot apply.

## Consequences

- A flag row + a mount-point guard is the entire cost of making a new
  complicated feature killable; E1–E6 land behind flags from day one.
- Web flag flips require a redeploy (build-time inlining). Accepted:
  Vercel redeploy is one click and takes ~2 minutes; runtime flag
  delivery would need an endpoint + fetch + cache semantics nobody
  asked for.
- Two flags exist at adoption (`darkMode`, `senderPeek`). Retired
  features do NOT get flags — dead code gets deleted, not gated.
- If percentage rollouts or per-user targeting are ever needed, that is
  a new ADR (likely a real flag service); this manifest stays the
  registry either way.
