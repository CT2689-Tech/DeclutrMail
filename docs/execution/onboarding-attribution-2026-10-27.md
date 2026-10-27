# Optional onboarding survey and source-answer report

Follow-up to D108, D181 and D258; this does not change their decision status.

## Scope and ownership

The onboarding survey starts collapsed, explicitly says Optional, and keeps Skip
available outside the disclosure. Choosing a named channel saves immediately;
Other opens a focused field with an explicit Save answer action. Existing consent,
dialog and prompt-queue behavior remains covered by regression tests. Scan counts
and time estimates sit directly below the real progress bar.

The founder report at `/admin/acquisition` uses the existing JWT and admin-email
allowlist boundary. It returns only aggregate counts and an observation time,
with private/no-store caching. Answered, skipped and unanswered accounts remain
separate. Internal/test accounts are included and disclosed. Other text and account
identities never enter the response. There is no inferred response rate or date
filter: answer timestamps were not historically recorded. Tracked referral links
remain a separate signal.

This session owns the new report modules, shared attribution contracts, migration
0099, survey presentation, scan metadata placement, and generated bundle budget.
The parent session is the integration owner; there are no external PR dependencies.
Independent design, API/analytics and final review work was integrated in one
isolated worktree. Final review found no blocking issues after a runtime-discovered
guard dependency issue was fixed and given a module-composition regression test.

## Additional channels and rollout

The self-report enum gains Google/search, ChatGPT/AI, YouTube, Instagram and TikTok.
Existing choices and answers retain their meanings. Tracked ref values are unchanged.
Migration 0099 expands only the existing heard-from CHECK constraints on users and
subscription attribution snapshots. It changes no stored answer, column, index,
payment state or access policy. The file runs transactionally with a 3-second lock
timeout. Atlas checksum was generated with `atlas migrate hash`.

Atlas local dry-run result:

```text
Migrating to version 0099 from 0098 (1 migrations in total):
  -- migrating version 0099
    -> SET lock_timeout = '3s';
    -> ALTER TABLE users ... expanded heard-from CHECK;
    -> ALTER TABLE subscriptions ... expanded heard-from CHECK;
    -> RESET lock_timeout;
  -- 1 migration
  -- 4 sql statements
```

The normal release applies migrations before API rollout. The web renders only
legacy choices until `/auth/me` advertises the supported new values, covering a
Vercel-before-API deployment. Rollback refuses to restore old checks when either
table contains a new answer; recovery must preserve those answers. Production
migration approval is required by CLAUDE.md section 2.0 before merge/apply.

## Verification before PR

- Workspace typecheck and lint passed; lint retained six existing warnings.
- All 605 script tests passed before the final generated bundle refresh.
- Shared attribution/report contracts: 12 tests passed.
- Database parity, migration round-trip and prior attribution: 6 tests passed;
  new channel/rollback coverage: 4 tests passed.
- API report/guard/module tests: 36 passed; auth-controller/report focused run:
  36 passed. These runs overlap and are not additive.
- Survey/onboarding focused regression suite: 83 tests passed. Final directly
  affected web run: 37 passed; independent report/cache review: 6 passed.
- Production web build, generated bundle budgets, prerender checks and Storybook
  build passed. New report stories include empty, loading, unavailable, denied,
  failed refresh and unknown-category states.
- Native Codex browser inspected 26 states at 320px across light and dark themes:
  no horizontal overflow. Other receives focus when opened; controls retain native
  keyboard behavior. All choice, Skip, Save and report toggle targets are 44px tall.
- Full isolated API and web app booted against disposable Postgres and Redis,
  with billing disabled and no worker or Gmail provider. A synthetic account saved
  Google/search through the actual UI. The actual report then showed 6 accounts,
  5 answered, 1 skipped, 0 unanswered, including the new Google answer. A database
  read confirmed its original tracked `hn` referral was retained.

Browser screenshots and responsive measurements are held outside the repository
in this session's private visualization evidence directory. Real user answers,
mailbox data, credentials and free-text answers are not committed.

## Release status

This document records pre-PR evidence only. Merge, production migration, deployment
and production browser verification must be recorded separately after they happen.
Earlier scan, cleanup and Undo launch evidence is reused; this change does not
repeat mailbox mutations or live billing tests.
