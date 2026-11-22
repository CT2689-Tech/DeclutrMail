<!--
DeclutrMail PR Template

See CLAUDE.md §6 (naming conventions) and §8 (definition of done) for full rules.
-->

## What changed

<!-- 2-3 sentences. The "why" is more useful than the "what". -->

## Integration handoff

- Owner:
- Shared files / dependencies (or none):
- Ready commit:
- Remaining risks (or none):

## Verification

<!-- Tick at least one verification source. -->
- [ ] Unit / integration tests added (list test names: ``)
- [ ] Playwright E2E added (for user flows)
- [ ] Gate subagent: [ ] privacy-auditor / [ ] architecture-guardian / [ ] schema-migration-reviewer / [ ] design-system-agent / [ ] webhook-security-auditor
- [ ] Manual smoke (describe): 

## PR-type-specific (tick the row that applies)

<!-- Migration PR -->
- [ ] **Migration PR:** Atlas dry-run output attached. Rollback path: 

<!-- API PR -->
- [ ] **API PR:** Contract tests pass. OpenAPI updated. Response uses the shared API envelope.

<!-- Worker PR -->
- [ ] **Worker PR:** Policy: [ ] webhook / [ ] perMailbox / [ ] batch / [ ] cron / [ ] admin. Idempotency key: 

## Definition of done

<!-- All required for merge. CI enforces what it can; you certify the rest. -->
- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint` passes
- [ ] Affected unit + integration tests pass
- [ ] Affected E2E tests pass (or N/A)
- [ ] No unresolved [BLOCKING] comments from gate agents
- [ ] No new TODOs unless linked to a GitHub issue
- [ ] No new secrets in code (`gitleaks`-clean)

## Stop conditions (review carefully)

<!-- If this PR touches any of these, flag the founder before merge. -->
- [ ] N/A — no high-stakes surfaces touched
- [ ] Gmail OAuth scopes
- [ ] Token encryption/decryption
- [ ] Production migration
- [ ] Billing webhook
- [ ] Account deletion logic
- [ ] Privacy/retention behavior
- [ ] Destructive Gmail action without preview/undo

<!--
Review evidence (record actual reviews; the scope workflow does not run reviewers)
-->

## Gates

<!-- Record applicable review results; mark non-applicable reviews N/A. -->
- privacy-auditor: ⏳
- architecture-guardian: ⏳
- schema-migration-reviewer: ⏳
- design-system-agent: ⏳
- webhook-security-auditor: ⏳
