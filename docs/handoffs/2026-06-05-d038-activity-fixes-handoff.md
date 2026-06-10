# D38 Activity Fixes + Revert Recovery — Hand-off

**Date:** 2026-06-05
**Branch:** `feat/d038-senders-v2-integration` (33 commits ahead of `main`)
**Last commit:** `cedc4bc fix(activity): Delete verb support + retry stranded reverts`
**Status:** All BE/worker code green. FE smoke + merge are the remaining hands-on steps.

---

## Quick-resume command

```bash
git checkout feat/d038-senders-v2-integration
git pull
./scripts/dev-up.sh
pnpm --filter @declutrmail/web dev
```

Dev test-login:

```
http://localhost:4000/api/auth/dev/login?email=chintan.a.thakkar@gmail.com
```

---

## Session arc (2026-06-05)

1. Founder approved Thread A (BE Phase 1 finish) — replied_count + auto-protect + recent-subjects + IncrementalSyncWorker
2. 10 commits banked across replied_count, IncrementalSyncWorker contracts + impl, 7-agent code review
3. **1 BLOCKING fix:** webhook enqueue moved OUTSIDE the PG tx (architecture-guardian)
4. 8-of-9 code-review follow-ups fixed inline (`9309f75`)
5. Live smoke Archive + Undo (LinkedIn 2 emails) → ✅ full round-trip
6. Live smoke Delete + Undo (DKNY 64 → 86 → 49 emails, Abercrombie 60 emails)
7. **3 bugs surfaced + fixed** in the founder's Activity screenshot:
   - App-shell trust strip lied: "Nothing deleted · Reversible for 7 days" (Delete IS a verb; recovery is 30d Trash, not 7d)
   - Delete rows rendered as `· N emails` (no verb prefix — `ACTION_LABEL.delete` missing)
   - Stats line missing `deleted` count
8. **Stuck-Trash bug** (109 emails): `enqueueRevert` returned cached failed row + BullMQ silently dedup'd on stale failed-job hash. Fix: reset row + `getJob().remove()` + re-enqueue
9. **109 emails recovered** live: DKNY 49 + Abercrombie 60 back in INBOX

---

## What landed this session (10 commits, e850d74 → cedc4bc)

```
cedc4bc fix(activity): Delete verb support + retry stranded reverts (D38, D227)
7bc0a67 fix(dev-up): sweep orphan worker.ts / main.ts pids on stop (D38)
9309f75 fix: address 8 of 9 code-review follow-ups (D38)
c0299b5 docs: D38 code-review closeout — 6 follow-ups + MISTAKES entry (D38)
04c8546 fix(webhook): move incremental-sync enqueue OUTSIDE the PG tx (D8, D229)
5999f2b docs: D38 closeout — LEARNINGS + FOUNDER-FOLLOWUPS (D38)
326f4af feat(workers): IncrementalSyncWorker + webhook enqueue close (D8, D229)
808f48a feat(workers): incremental-sync contracts (D8, D229)
4deeb91 test(workers): trust-canary auto-protect ≥3 + idempotency (D38)
e850d74 feat(senders): replied_count + auto-protect + recent-subjects (D38)
```

Net diff vs `main`: ~33 commits, +12,700 / -1,100 LOC across 86 files.

---

## What's working end-to-end (verified live)

| Surface                             | Wire                                      | Status                                     |
| ----------------------------------- | ----------------------------------------- | ------------------------------------------ |
| Compose strip `you replied N`       | filterCounts.repliedTo                    | ✅ 1040 honest (was lying as 0)            |
| Compose strip `protected N`         | filterCounts.protected                    | ✅ 459 auto-protected via engagement_based |
| Modal `Show what will move ▾` panel | preview.recentSubjects                    | ✅ real subjects per window                |
| Sender Detail "you replied N×"      | senders.replied_count on row              | ✅ wired                                   |
| Archive 30d+ + Undo round-trip      | LabelActionWorker forward + reverse       | ✅ 2 emails restored                       |
| Delete 30d+ + Undo round-trip       | LabelActionWorker delete + reverse        | ✅ 64 emails restored                      |
| Stuck-revert recovery               | enqueueRevert reset + remove + re-enqueue | ✅ 109 emails recovered                    |
| Activity Delete verb label          | ACTION_LABEL.delete = 'Deleted'           | ✅ no more naked `· N emails`              |
| Activity stats `deleted` count      | aggregateStats() emits deleted            | ✅                                         |
| Trust strip canonical copy          | AppShell TRUST_CLAIMS                     | ✅ Recoverable + Metadata only             |

---

## Still NOT verified (need founder hands)

| Item                                                               | Why founder                       | When                           |
| ------------------------------------------------------------------ | --------------------------------- | ------------------------------ |
| Real Gmail Trash via Delete (live OAuth)                           | Need actual Gmail account writes  | Before merge                   |
| Composite Later + Delete past worker                               | Real-user composite flow          | Before merge                   |
| Real Pub/Sub webhook fire → IncrementalSyncWorker → cursor advance | Gmail account change + Pub/Sub    | Before merge                   |
| Cursor-too-old recovery (force-stale historyId)                    | SQL backdate + Gmail webhook fire | Optional — wired but un-smoked |
| Activity UI screenshot review (post-fix)                           | Visual confirmation               | Before merge                   |
| Multi-mailbox switch w/ active compose preserved                   | URL state + AppRouter behavior    | Before merge                   |

---

## Tests state

| Package | Pass / Total | Pre-existing skips/fails                                                                   |
| ------- | ------------ | ------------------------------------------------------------------------------------------ |
| events  | 75 / 75      | —                                                                                          |
| shared  | 133 / 133    | —                                                                                          |
| db      | 37 / 37      | —                                                                                          |
| workers | 269 / 270    | 1 skip                                                                                     |
| api     | 466 / 476    | 10 skip                                                                                    |
| web     | 315 / 323    | 8 pre-existing senders-screen failures — retired-surface assertions per Phase 5 sweep plan |

**Zero new regressions across the session.** Total +14 new tests this session: 2 trust-canary auto-protect, 10 incremental-sync, 1 recentSubjects shape, +2 webhook ordering, +2 first-advance, +1 demote-stays-demoted, +1 revert-retry, +2 Delete stats / verb counting, +1 user-agency-wins, +1 monotonic cursor guard.

---

## Open follow-ups (next session candidates)

### Tier A — quick wins (~2-4h each)

|     | Item                                                                                    | Effort | Notes                                                                                           |
| --- | --------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------- |
| 1   | `senders-lab-v2` rm -rf                                                                 | 5 min  | Permission denied to agent. `rm -rf apps/web/src/app/senders-lab-v2/`                           |
| 2   | CLAUDE.md §2.2 K/A/U/L → K/A/U/L/D distillation                                         | 30 min | Founder-only `chore/distill-` PR. CLAUDE.md §11 enforces                                        |
| 3   | `TOP SENDER` hero hotfix                                                                | 1h     | `weekly-hero-live.tsx:128` renders user's monogram instead of slice's top sender. Spec mentions |
| 4   | useWeeklyHero observability port to Brief                                               | 1h     | Pending Brief surface; no consumer until Brief lands                                            |
| 5   | Schema future-compat: DB CHECK for `(is_protected=false) = (protection_reason IS NULL)` | 2h     | Migration + spec amend. Forward-compat against future "unprotect" path                          |
| 6   | Cursor-too-old live smoke (force-stale + observe recovery)                              | 1h     | onCompleted hook already wired in worker.ts; needs live verification                            |

### Tier B — Activity power-options (~1d each)

|     | Feature                                            | Why                                                                        |
| --- | -------------------------------------------------- | -------------------------------------------------------------------------- |
| 7   | Multi-select rows + bulk undo                      | Recover N stuck items in one click; the founder's screenshot scenario      |
| 8   | Filter by VERB (Archived/Deleted/Unsub/Later/Kept) | Currently filter by source only                                            |
| 9   | Sender search in activity                          | Find "Abercrombie" across time                                             |
| 10  | Custom date range picker                           | "Last 30 days" preset only                                                 |
| 11  | Group by sender toggle                             | Collapses 3 DKNY rows to 1 expandable parent                               |
| 12  | "Open in Gmail" per row                            | Jump to affected thread                                                    |
| 13  | Retry-failed-revert UI surface                     | Currently fires silently via re-click after BE fix; surface the affordance |
| 14  | Export CSV                                         | Compliance / personal audit                                                |
| 15  | Permanent delete (skip Trash)                      | Power-user, post-Plus tier                                                 |
| 16  | All-time totals across history                     | Window-bound today                                                         |

### Tier C — older follow-ups (existing FOUNDER-FOLLOWUPS Open)

These predate this session. Sequence per priority:

- Activity D56 status filter + D57 row accordion + D58 undo wire (2026-05-29)
- Activity feed schema gaps — outbox + sync-complete row variants (2026-05-29)
- Brief D68 Pro-tier gate (pending billing)
- ARCH-DRIFT — 3 controllers missing `@RateLimit`, envelope-via-`ok()`, full Idempotency-Key wire
- Dependabot D-trailer blocker (CLAUDE.md §6)
- Vitest 4 upgrade
- Account hard-delete execution (D205 + D232)

Plus a stack of D-CANDIDATE items (DB CHECK constraints, limiter cache, recipient_emails CHECK, etc.) — all advisory.

---

## Smoke matrix for next session

### Web FE smoke — Activity UI fixes (most important; visible delta)

```
1. ./scripts/dev-up.sh && pnpm --filter @declutrmail/web dev
2. http://localhost:4000/api/auth/dev/login?email=chintan.a.thakkar@gmail.com
3. /activity (with manual + 30d filters)
4. Verify trust strip top says "Recoverable · Metadata only" (no more "Nothing deleted")
5. Verify DKNY rows show "Deleted · 64 emails" not "· 64 emails" (verb prefix present)
6. Verify stats line includes "X deleted" between archived and unsubscribed
7. Click Undo → on a recoverable Delete row → wait → row should flip to "Undone"
```

### Compose strip smoke (already shipped + verified live)

```
1. /senders
2. Verify `you replied 1040` chip count (was 0 before)
3. Verify `protected 459` chip count (was 0 before)
4. Click a sender → Delete → modal opens
5. Click "Show what will move (5 of N) ▾" → see REAL subjects (e.g. "We've received your payment" for Amex)
```

### Real Gmail Delete + Undo (founder hands only)

```
1. Pick a low-stakes newsletter (e.g. abercrombie@em.abercrombie.com)
2. Click Delete → Confirm 30d+
3. Verify in Gmail Trash UI (web mail)
4. Click Undo → in DeclutrMail
5. Verify message back in INBOX in Gmail
```

---

## Known blockers / gotchas

### Stale dev-worker leak (FIXED but flag for awareness)

`./scripts/dev-up.sh --stop` previously didn't kill orphan `worker.ts` processes — May 29's worker.ts process was alive 7+ days later, intercepting BullMQ jobs alongside the freshly-restarted one. The May 29 graph predated ADR-0019's Delete verb addition, so its `labelChangeForVerb('delete')` threw `unknown action verb delete` — a phrase that doesn't exist in current source, making the bug nearly impossible to grep into.

**Fix in `7bc0a67`:** `dev-up.sh stop()` now `pkill`s `node ... worker.ts` / `main.ts` processes scoped via `lsof` cwd check.

**MISTAKES.md** entry encodes the "grep ps before greping source" rule for future debugging.

### IMPLEMENTATION-LOG auto-flip

D8, D38, D227, D229 will flip ⬜→🔵 on merge per `pr-merged.yml`. Don't pre-flip.

### FOUNDER-FOLLOWUPS hygiene

8 of the 9 code-review items I added 2026-06-05 are now FIXED inline (commits 9309f75 / cedc4bc / 04c8546 / 7bc0a67). On next session, move them from Open → Done with the relevant commit refs. Items still genuinely Open:

- `senders-lab-v2 cleanup` — founder hands
- `Schema future-compat: protection_reason stale on is_protected=false` — Tier A #5
- All Tier C items (older)

---

## Pre-merge checklist

- [ ] Founder smoke: Activity UI shows Delete verb + recoverable copy + stats
- [ ] Founder smoke: Live Delete on throwaway sender + Gmail Trash visible + Undo restores
- [ ] PR opened with `Closes D8, D38, D227, D229` in body
- [ ] Branch rebased on `main` if conflicts surface
- [ ] All gate agents green (privacy / architecture / schema / webhook / typescript / silent-failure / flow-completeness)
- [ ] CI green
- [ ] Merge → IMPLEMENTATION-LOG auto-flips ⬜→🔵
- [ ] Post-merge: `pnpm verify-d D38` to flip 🔵→🟢

---

## Critical reminders for next session

- Spec v1.3 is the contract — re-read before changes touching Senders V2 decisions
- ADRs 0016-0020 signed; do NOT relitigate
- Migration apply = founder hands only (CLAUDE.md §9)
- CLAUDE.md K/A/U/L → K/A/U/L/D distillation = founder-only `chore/distill-` PR
- 8 pre-existing senders-screen.test.tsx failures are NOT regressions (retired surfaces; Phase 5 sweep retires)
- Compose strip URL params: `activity / unsub_ready / window / domain / protected / replied` — negation via `not-*` (activity) or `not` (booleans)
- `useComposeState` falls back to local state in test environments without AppRouterContext — do NOT mock the router
- `ps aux | grep worker.ts` before debugging any "code-doesn't-match-behavior" worker mystery (MISTAKES.md 2026-06-05)
- BullMQ `removeOnFail: false` means failed jobs persist in Redis; a fresh `queue.add` with same jobId silently no-ops — drop the hash first (the failed-revert retry pattern)
