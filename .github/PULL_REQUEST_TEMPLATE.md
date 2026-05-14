## Summary

<!-- 1–3 bullets: what changed and why. Focus on the why; the diff shows the what. -->

## Verification

<!-- Replace bracketed values with actual command output. Stale results don't count. -->

- `npm run typecheck` → [exit code]
- `npm run test` → [N passed / M skipped / 0 failed]
- `npm run lint` → [0 errors / X warnings]
- `npm run build` → [success; bundle delta +Y KB gzipped]
- [feature-specific] curl `<endpoint>` → [response status + shape]
- [UI features] [screenshot attached vs design source]

For pure-docs PRs (no `.ts`/`.tsx`/`.css` touched), state: "No code changed, no verification commands run."

## Definition-of-done checklist

<!-- Tick each box. Items that don't apply, mark N/A with a reason. Full reference: docs/feature-checklist.md -->

**UI**

- [ ] Route exists, reachable, lazy-loaded
- [ ] Pixel-matches design source
- [ ] Keyboard accessible (axe-clean, focus rings, tab order)
- [ ] Responsive ≤375 / 768 / ≥1280 px
- [ ] Loading / empty / error states implemented
- [ ] `prefers-reduced-motion` respected

**Data**

- [ ] Edge function exercisable via curl
- [ ] Migration applied; RLS on every table
- [ ] Query keys centralized
- [ ] Optimistic UI + rollback for mutations > 200 ms

**Quality**

- [ ] 0 TypeScript errors; no `any` without `// @explained: …`
- [ ] 0 ESLint errors on touched files
- [ ] Tests: happy + edge + error
- [ ] New-file coverage ≥ 70%
- [ ] Bundle delta ≤ +25 KB gzipped
- [ ] Lighthouse ≥ 90 P/A/BP/SEO on affected route

**Production safety**

- [ ] Error boundary around route
- [ ] Loading state ≤ 5 s without explanation copy
- [ ] Error messages name what failed + what user can do
- [ ] Privacy oath upheld (see docs/security-and-privacy.md)
- [ ] No `console.log` in committed code

**Docs**

- [ ] `.env.local.example` updated if new env vars
- [ ] CLAUDE.md updated if a critical invariant changed

## Reviewer notes

<!-- Anything to focus on, or "NA" if straightforward. -->

---

### Branch + commit conventions

Branch: `feat/`, `refactor/`, `fix/`, `docs/`, `chore/` + `<short-name>`.

Commit (conventional, present-tense imperative):

```
feat(auth): wire Google OAuth callback
fix(triage): debounce keyboard handler to avoid double-decide
chore(deps): bump vite to 7.2
refactor(senders): extract row component
docs(claude-md): tighten subagent playbook
```

AI-coauthored commits include:

```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

### Size

A PR is the smallest unit that meets the feature contract. Diff > 600 lines (excluding lockfile + design-copied CSS) → split. Stacked PRs are fine if each layer is independently reviewable.

### `main` is protected

Vercel auto-deploys `main` to production. Never push directly. Pre-commit hooks (Husky + lint-staged) auto-fix lint + format. Never use `--no-verify`.
