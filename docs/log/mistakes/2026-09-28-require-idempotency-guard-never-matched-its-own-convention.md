## 2026-09-28 — require-idempotency's regex never matched the convention every worker uses

**PR:** [#821](https://github.com/CT2689-Tech/DeclutrMail/pull/821)
**Caught by:** self, while closing the two `require-idempotency` findings PR #801's
`scripts/run-guard-hooks.mjs` had flagged (`domain-icon.worker.ts` real,
`support-request.worker.ts` a schema-text coincidence)
**What happened:** `.claude/hooks/require-idempotency.sh`'s grep
(`idempotencyKey\s*[:=(]|get\s+idempotencyKey\s*\(|@IdempotencyKey`) documented four
declaration shapes — a field, a plain method, a getter, a decorator — and never
included the one shape `BaseDeclutrWorker` actually declares:
`protected getIdempotencyKey?(payload: TPayload): string;`. `getIdempotencyKey(`
contains `IdempotencyKey` (capital I), not the lowercase `idempotencyKey` the first
alternative requires, and it has no space before `(`, so the getter alternative
(`get idempotencyKey(`) doesn't match either. Confirmed by running the unmodified
hook against `billing-verdict.worker.ts`, which already implements
`getIdempotencyKey()` correctly — it still printed `❌ require-idempotency: worker
class missing idempotencyKey declaration`. That is exactly why 16 workers
(every one of the 17 that override the method) sat in
`scripts/guard-hooks-allowlist.json` under the identical reason text "False
positive: the key is declared with getIdempotencyKey()… which the guard's
case-sensitive idempotencyKey pattern does not match" — the guard had been wrong
for the canonical case since PR #801, papered over one allowlist entry at a time
instead of the regex being fixed.
**Correct approach:** When a guard's own positive-control-style check
("does this file already comply?") disagrees with the codebase's actual, working
convention on 16 separate files, distrust the guard's pattern before writing a
17th allowlist entry with the same reason. `run-guard-hooks.mjs`'s own docstring
names this shape directly ("A guard that cannot fail is not a guard" is about
guards blind to an empty/absent subject; this is the sibling case — a guard blind
to the compliant subject, firing on it as if it were absent).
**Rule:** A repeated identical allowlist reason across N files is a signal to fix
the guard's pattern, not to keep matching it — grep the allowlist for entries
sharing one `reason` string before adding another one with the same text.
**Enforcement update:** Added the missing `getIdempotencyKey\s*\(` alternative to
the hook's regex (`.claude/hooks/require-idempotency.sh`) and removed all 16
now-dead `require-idempotency` allowlist entries. Verified against a full-repo
`--all` run (2,348 tracked files): 0 `require-idempotency` violations anywhere,
and the guard's own "missing key" positive control still correctly fails —
confirming the fix closes the false positives without opening a false negative.
