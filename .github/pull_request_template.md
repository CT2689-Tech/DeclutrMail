<!--
DeclutrMail PR Template

See CLAUDE.md §6 (naming conventions) and §8 (definition of done) for full rules.
Bootstrap PRs (branch `chore/bootstrap-*`) may omit the Closes section.
-->

## Closes

<!-- One or more D-numbers from the plan. Required (bootstrap branches exempt).
     Shipping: `Closes D###` (flips IMPLEMENTATION-LOG).
     Follow-up that must not flip a row: `Relates to D###`. -->
- Closes D###
<!-- - Relates to D### -->

## What changed

<!-- 2-3 sentences. The "why" is more useful than the "what". -->

## Integration handoff

- Owner:
- Shared files / dependencies (or none):
- Ready commit:
- Remaining risks (or none):

## Verification

<!-- Tick at least one verification source per D# closed. -->
- [ ] Unit / integration tests added (list test names: ``)
- [ ] Storybook story added (for new components)
- [ ] Playwright E2E added (for user flows)
- [ ] Gate subagent: [ ] privacy-auditor / [ ] architecture-guardian / [ ] schema-migration-reviewer / [ ] design-system-agent / [ ] webhook-security-auditor
- [ ] Manual smoke (describe): 

## PR-type-specific (tick the row that applies)

<!-- Migration PR -->
- [ ] **Migration PR:** Atlas dry-run output attached. Rollback path: 

<!-- Component PR -->
- [ ] **Component PR:** Storybook story covers default + loading + error + empty states.

<!-- API PR -->
- [ ] **API PR:** Contract tests pass. OpenAPI updated. Response follows D202 envelope.

<!-- Worker PR -->
- [ ] **Worker PR:** Policy: [ ] webhook / [ ] perMailbox / [ ] batch / [ ] cron / [ ] admin. Idempotency key: 

## Definition of done

<!-- All required for merge. CI enforces what it can; you certify the rest. -->
- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint` passes
- [ ] Affected unit + integration tests pass
- [ ] Affected E2E tests pass (or N/A)
- [ ] `IMPLEMENTATION-LOG.md` is current for the cited decisions (or N/A)
- [ ] No unresolved [BLOCKING] comments from gate agents
- [ ] No new TODOs unless linked to a D-decision or GitHub issue
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
