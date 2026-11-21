### 2026-06-05 — Retire the last legacy verb types and bridges

**Source:** FOUNDER-FOLLOWUPS.md (root, deleted 2026-11-19; read with `git show cb785809:FOUNDER-FOLLOWUPS.md`), entry dated 2026-06-05.
**Why:** The Action Registry is in place (ADR-0015), but the web app still keeps two capitalised verb types (`apps/web/src/features/triage/types.ts`, `senders/data.ts`) and three bridges (`mapLegacyVerb`, `legacyVerbFromId`, `VERB_TO_REGISTRY`). Each new verb still has to touch every copy. Low priority: nothing is broken today.
**How:**
1. Derive `VerbId` (`packages/shared/src/actions/verb-registry.ts`) from `ACTION_VERBS`.
2. Move Triage and Senders to the lowercase registry verb, with labels read from the registry.
3. Keep `Protect` as a separate safety action, not a verb.
4. Delete the bridges and the two capitalised types.
**Verifies by:** `grep -rn "mapLegacyVerb\|legacyVerbFromId\|VERB_TO_REGISTRY" apps packages` finds nothing; typecheck and web tests pass.
**Who:** Engineering (an agent can do it)
**Status:** Open
