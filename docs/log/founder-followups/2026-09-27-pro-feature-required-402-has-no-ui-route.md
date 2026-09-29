### 2026-09-27 — `PRO_FEATURE_REQUIRED` 402s get no upgrade-modal route anywhere

**Source:** PR #808 (Quiet copy), design-system + architecture-guardian re-gate review.
**Why:** `CapabilityGuard`/`@RequiresCapability` (`apps/api/src/common/entitlements/capability.guard.ts`)
throws 402 `PRO_FEATURE_REQUIRED` for every under-tier request on a capability-gated route —
Quiet, Screener, Followups, Autopilot, Briefs. The web's global entitlement handler,
`upgradeGateHitFrom` (`apps/web/src/lib/entitlements/upgrade-gate.ts`), only recognizes
`FREE_CAP_REACHED`, `INBOX_LIMIT_REACHED` and `ACTION_TIER_REQUIRED` — confirmed by its own test
suite's "unrecognized code returns null" case. So a `PRO_FEATURE_REQUIRED` 402 opens no
UpgradeModal anywhere in the app today; whatever mutation hit it falls through to that
surface's own generic failure toast (or, for a surface with no per-call/hook-level `onError`
at all, nothing).

This surfaced while fixing Quiet's own save-failure signal: a design-system-agent review
assumed the global handler already covered this 402 and suggested skipping the toast on it.
It doesn't — verified against the guard's source and the store's own test. Skipping the toast
as suggested would have made a downgrade-mid-session save fail completely silently, so #808
left it un-special-cased and documented the gap in `use-update-quiet-hours.ts` instead of
guessing.

**How:** Decide whether `PRO_FEATURE_REQUIRED` should join the recognized-code list in
`upgradeGateHitFrom` (its `reason` would need its own `UpgradeGateHit` variant and modal copy —
"this feature needs a plan upgrade" rather than a specific cap/limit number), or whether each
capability-gated mutation's own toast is the intended UX and this is working as designed.
**Verifies by:** If yes — `upgradeGateHitFrom` gets a `PRO_FEATURE_REQUIRED` branch, and a test
mirroring the existing `FREE_CAP_REACHED`/`INBOX_LIMIT_REACHED` cases in
`upgrade-gate.test.ts` goes green. If no — this file moves to Skipped with that reasoning.
**Status:** Open
