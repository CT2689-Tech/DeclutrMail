## 2026-09-29 — Adopting an abandoned PR: check commit distance, not just file overlap

**Context:** Adopted PR #763 (stuck-sync detection + error-reason-code
recovery on the onboarding sync gate), open since 2026-09-21 with no
owning session. The brief framed this as "PR #763 vs PR #797 both touch
`sync.controller.ts`/`sync.service.ts`/`mailbox-health.ts`/`sync-gate.tsx`
— check for redundancy, then reconcile." That framing implied a normal
two-PR conflict.

**Finding:** #763's branch was 50 commits behind `main`, and one of
those 50 was `#765 "feat: revamp product and public site for launch"` —
a full "Apple-simple" redesign that had already rewritten
`sync-gate.tsx` (dropped `Eyebrow`/`PrivacyBadge`, changed the `eyebrow`
prop to `readyEmail`, restyled every heading to a shared `titleStyle`,
moved the escape hatch from a dismiss-toggle widget to an inline
button). `git merge origin/main` still only produced 7 conflicted files
and ~13 conflict hunks — small by line count — but resolving them
correctly required reconstructing the *current* file's design intent
first (read the post-redesign file in full, not just the diff hunks),
then re-porting #763's actual feature (stuck-heartbeat detection via
`isStaleInitialSync`, the `initialSyncRecovery` reason-code mapping)
onto that current structure, rather than three-way-merging text. A
mechanical resolution would have reintroduced dead `Eyebrow`/`PrivacyBadge`
UI the redesign deliberately removed.

Two defects only surfaces this way caught before commit: a duplicate
`export const FailedReconnect` in `sync-gate.stories.tsx` (git merged
two textually-distinct blocks with the same identifier — a real
TypeScript compile error, invisible to `git status`) and two test
assertions still asserting the pre-redesign title ("Reading your
inbox…" vs the shipped "Reading your Gmail…") that `git merge` left
green because neither side's diff touched that exact line.

**Rule (provisional):** Before resolving a stale branch's conflicts,
run `git log --oneline <branch>..origin/main` and skim for anything
that reads like a redesign/rewrite PR, not just count the conflicted
files. If one shows up, read the CURRENT full version of every
conflicted file end-to-end (not just the diff hunks) before writing any
resolution — the file's own already-auto-merged regions are the best
evidence of what the current design intends. Then typecheck + run the
PR's own full test suite (not just the files git marked conflicted);
duplicate identifiers and stale string assertions in unconflicted
regions are the two failure modes a clean `git status` won't show.

**Distillation trigger:** promote to CLAUDE.md §8 "Smoke before merge"
if a future PR-adoption task hits the same "small conflict count, large
semantic distance" shape a second time.
