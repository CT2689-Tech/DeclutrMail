# ADR-0014: Centralized error-code registry

- **Status:** Accepted
- **Date:** 2026-05-29
- **Deciders:** founder (chintan), Claude (backend session)
- **Related D-decisions:** D168 (error envelope), D169 (severity tiers), D170 (critical-trust scenarios), D202 (response envelope), D209 (trust-first microcopy)

## Context

D168 standardized the error envelope _shape_ (`{ error: { code, message,
correlationId, traceId, displayId, retryable, severityTier } }`) and D169
named the three severity tiers. But the error `code` _values_ themselves
were never given a home: they live as bare string literals at each throw
site — `current-mailbox.guard.ts` (`NO_ACTIVE_MAILBOX`, `MAILBOX_NOT_OWNED`),
`auth-signup.orchestrator.ts` (`MAILBOX_OWNED_BY_OTHER_WORKSPACE`), the
Gmail webhook controller, and inline in the plan (`CURSOR_EXPIRED`,
`GMAIL_QUOTA_EXCEEDED`). The frontend additionally repeats several of
these codes in comments and will soon branch on them at runtime for the
D170 critical-trust banners.

Two concrete problems followed. First, drift: a code is duplicated across
BE throw sites and FE handling with nothing tying them together — exactly
what the shared `envelope.ts` contract (D202) exists to prevent for the
success shape. Second, a latent bug: the `AllExceptionsFilter` derived a
non-`AppException`'s code from the HTTP _status_, so a guard throwing
`new ConflictException({ code: 'NO_ACTIVE_MAILBOX' })` actually emitted
`code: 'CONFLICT'` on the wire — the domain code was silently dropped.

The per-code severity tier and retryability (D169) were also re-decided ad
hoc at each throw site rather than defined once.

## Decision

We will keep a single typed registry, `ERROR_CODES`, in
`packages/shared/src/contracts/error-codes.ts`, mapping every domain error
code to its default `{ status, severityTier, retryable, message }`. It is
the source of truth shared by the NestJS API and the web client. `AppException`
defaults its classification from the registry, and `AllExceptionsFilter`
preserves a registered code carried in any thrown response body (falling
back to the status-derived code for unregistered values).

## Alternatives considered

- **Leave codes decentralized:** rejected — drift between BE and FE is
  already starting, and the filter was silently dropping domain codes.
- **A runtime `.json` / `.yaml` config file** (literally what was asked):
  rejected — error codes are a compile-time vocabulary, not environment
  config. A `.ts` registry gives the `ErrorCode` union (typos become
  compile errors) and is importable by both apps as a shared type; JSON
  would forfeit both.
- **Migrate every throw site to `AppException`:** deferred — it changes the
  thrown exception type and would churn the load-bearing
  `CurrentMailboxGuard` (and its specs) on the §8 409-storm path. Instead
  the filter reads the body code, so existing `ConflictException({ code })`
  throws keep working and now surface correctly.

## Consequences

### Positive

- One place to add/rename a code; the `ErrorCode` union turns a typo at a
  throw site or in FE handling into a compile error.
- Domain codes now actually reach the client (latent filter bug fixed).
- D169 tier + retryability are defined once per code, not re-derived.
- A natural home to enforce D209 trust-first microcopy on default messages.
- D170 critical-trust work can import `ERROR_CODES.OAUTH_REVOKED` etc.

### Negative

- One more shared module that BE + FE depend on (acceptable: it is a leaf,
  pure data + types, no runtime deps).
- Default messages in the registry currently duplicate the explicit
  messages still passed at a few throw sites until those are migrated.

### Neutral

- Codes raised via plain `HttpException` subclasses without a body code
  continue to resolve from HTTP status — unchanged behavior.
- Validation/contextual messages (Zod, `BadRequestException`) stay at
  their throw sites; they are intentionally out of the registry.

## Implementation notes

- Registry + `isErrorCode` guard: `packages/shared/src/contracts/error-codes.ts`.
- `AppException` (`apps/api/src/common/app-exception.ts`) takes an
  `ErrorCode` and defaults status/tier/retryable/message from the registry.
- `AllExceptionsFilter.registeredBodyCode()` preserves registered body codes.
- Existing domain throw sites annotate their literal with `satisfies ErrorCode`
  for compile-time safety without changing the exception type.
- Tests: `error-codes.test.ts`, plus filter cases for body-code preservation
  and unregistered-code fallback.

## References

- ADR-0008 (API envelope + module template)
- `packages/shared/src/contracts/error-envelope.ts` (D168/D169)
