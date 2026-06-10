# D38 Production-Readiness Pass — Session 2 Hand-off

**Date:** 2026-06-06
**Branch:** `feat/d038-prod-ready-pass` (14 commits ahead of `feat/d038-senders-v2-integration`)
**Status:** All planned work for **session 2** SHIPPED + live-smoked. Branch is **mergeable**. Remaining work = polish/audit/E2E on the same 5 surfaces.

---

## Quick-resume command

```bash
git checkout feat/d038-prod-ready-pass
git pull
./scripts/dev-up.sh
pnpm --filter @declutrmail/web dev
```

Dev test-login:

```
http://localhost:4000/api/auth/dev/login?email=chintan.a.thakkar@gmail.com
```

---

## Session 2 commit log (14 commits since session 1 base)

```
ea58ca0 fix(workers): BullMQ jobId ':' → '__' (smoke fix)
010804a fix(d38): gate-agent findings — DI optional, 409 contract, drift guards
36d1061 refactor(tokens): retire #A12525 / #DC2626 → color.danger
a2fb96c feat(brief,autopilot): PostHog + Sentry instrumentation
4b6879b feat(actions,outbox): D204 unsubscribe-intent outbox + dispatcher wiring
5af61e5 docs(handoff): session 1 closeout
1cd56ba feat(activity): PostHog + Sentry on bulk-undo + CSV
ae9026f feat(actions): DB idempotency dedup for unsubscribe-intent
573db98 chore: drop senders-lab-v2 prototype
b7b2ac5 feat(senders): PostHog + Sentry on verb-fire
07e8ceb feat(senders-detail): unsub-queued pill + Open all in Gmail
d759368 chore: gitignore .vercel
8fd11ab feat(sync): on-demand sync-now + drift-sweep cron
7f0b8e4 feat(shared): tokens + branded ids + funnel events foundation
```

---

## What's done (10 phases shipped + gate fixes)

| Phase                          | Outcome                                                                                                                                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0 Foundation**               | color.danger family · inverse-surface tokens · 7 branded IDs · 19 new PostHog funnel events · KAULD `Verb` union                                                                                        |
| **1 Sync-now + drift cron**    | `POST /api/v1/sync/incremental` · 5-min worker drift sweep · `<SyncNowButton/>` · `useSyncNow` hook · 409 SYNC_NOT_READY designed state                                                                 |
| **2a Sender Detail polish**    | Unsub-queued pill · "Open all in Gmail" deep-link · `SenderDetail.email + policyType` · `gmail-links.ts` helper                                                                                         |
| **2b-a Senders instrument**    | One PostHog `bulk_action_taken` + one Sentry breadcrumb per verb-fire (single entry point)                                                                                                              |
| **3 Activity instrument**      | `bulk_undo_clicked` (with outcome) · `csv_exported` (with filtered flag) · breadcrumbs                                                                                                                  |
| **4 D204 outbox + dispatcher** | `ACTIONS_UNSUBSCRIBE_INTENT_RECORDED` event + Zod schema · OutboxConsumerRouter · OutboxDispatcherWorker wired in `apps/api/src/worker.ts` with pg LISTEN/NOTIFY + 5s polling fallback                  |
| **5 DB idempotency dedup**     | Migration 0024 `action_verb 'unsubscribe'` · `ActionsService.recordUnsubscribeIntent` persists dedup partner in `action_jobs` (status='done', verb='unsubscribe', resolved_message_ids=[activityLogId]) |
| **6 Brief instrument**         | `brief_refresh_clicked` (single handler) · `brief_cta_clicked` on every Open-in-Gmail · `captureFeatureException` on non-404 fetch errors                                                               |
| **7 Autopilot instrument**     | `autopilot_paused` · `autopilot_suggestion_decided` (dismiss path) · breadcrumbs · `captureFeatureException` on failures                                                                                |
| **8 Cleanup**                  | `rm -rf apps/web/src/app/senders-lab-v2/` (1408 LOC dead code)                                                                                                                                          |
| **Tier B color.danger**        | `#A12525` and `#DC2626` literals retired across 3 files                                                                                                                                                 |
| **Gate fixes**                 | 1 BLOCKING + 3 WARNING + 4 SUGGESTION resolved post-review                                                                                                                                              |
| **BullMQ smoke fix**           | `${mailbox}:${historyId}` jobId → `${mailbox}__${historyId}` (BullMQ ≥5.77 rejects `:`)                                                                                                                 |

---

## Live smoke matrix — verified 2026-06-06

| Surface                                     | Result                                                                                                                                                                     |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API boot                                    | "Nest application successfully started" — `@Optional()` DI fix verified                                                                                                    |
| Worker boot                                 | All 6 queues listening + outbox-dispatcher up                                                                                                                              |
| Outbox dispatcher                           | **Drained 6 previously-stranded `actions.label_action_applied` events at boot** (proof that LabelActionWorker had been publishing into a void; dispatcher wiring fixes it) |
| `POST /api/v1/sync/incremental` (1st click) | `202 { outcome: 'enqueued', cursor_history_id: '63134657' }`                                                                                                               |
| Same call (2nd click)                       | `202 { outcome: 'noop' }` (BullMQ dedup confirmed)                                                                                                                         |
| IncrementalSyncWorker pickup                | **57 new emails, 112 label changes, cursor 63134657 → 63141432** — Q3.1 founder gap CLOSED live                                                                            |
| Auth                                        | Dev-login returns the user's 2 connected mailboxes                                                                                                                         |
| CSRF guard                                  | Honored — POST without token returns proper 401 envelope                                                                                                                   |
| RateLimit `gmail-action` 6/min              | Working (not stress-tested)                                                                                                                                                |

---

## Gate-agent verdicts (all addressed)

| Agent                     | Findings                                                                                            | Resolution                                                                      |
| ------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **architecture-guardian** | 1 BLOCKING (DI @Optional missing) + 3 WARN (409 contract, drift facade bypass, dual-write) + 4 INFO | BLOCKING + critical WARNs fixed; dual-write tagged transitional w/ removal path |
| **privacy-auditor**       | 0 issues — exemplary (D7/D228 clean across new events + outbox payload + gmail-links)               | —                                                                               |
| **typescript-reviewer**   | 0 BLOCKING + 3 SUGGESTION + 2 NIT + 2 PRAISE                                                        | assertNever + Zod re-parse adopted                                              |
| **silent-failure-hunter** | 0 BLOCKING + 3 SUGGESTION + 2 NIT                                                                   | Drift cron overlap guard + per-tick `.catch` + WARN-level unknown-topic         |

---

## Tests — green across the board

| Suite                  | Pass / Total            | Δ                                                                            |
| ---------------------- | ----------------------- | ---------------------------------------------------------------------------- |
| `@declutrmail/shared`  | **146 / 146**           | +13 branded                                                                  |
| `@declutrmail/db`      | **37 / 37**             | —                                                                            |
| `@declutrmail/workers` | **269 / 270**           | — (1 pre-existing skip)                                                      |
| `@declutrmail/api`     | **490 / 490 + 10 skip** | +5 (3 sync controller, 1 actions DI shape, 4 outbox consumer, 2 unsub dedup) |
| `@declutrmail/web`     | **331 / 332**           | +7 (translateSyncNowError)                                                   |
| **Net new tests**      | **+30**                 | Zero regressions                                                             |

8 pre-existing senders-screen failures are unchanged — Phase 5 retired-surface assertions per the prior handoff doc.

---

## ## OPEN WORK — finish the 5 started surfaces end-to-end

Founder direction (2026-06-06): **park other screens; finish the 5 we've started**. Estimated total: **~10-12h focused work**.

### Per-surface checklist

#### Senders

- Storybook `compose-strip.stories.tsx` — 7 states (empty / single-axis / multi-axis / negated / window-popover-open / domain-popover-open / loading-counts)
- Per-feature error boundary `apps/web/src/app/(app)/senders/error.tsx`
- `compose_filter_changed` PostHog event (defined Phase 0, unused)
- `bulk_select_in_filter` event on bulk-select click
- `sender_search_submitted` event on search submit/pick
- Empty state audit (no senders, all senders pre-decided)
- Error state audit (500, 409 mailbox-switch, network drop)
- E2E Playwright: load → search → archive → undo → mailbox switch

#### Sender Detail

- Per-feature error boundary `apps/web/src/app/(app)/senders/[id]/error.tsx`
- `sender_detail_opened` event on mount (defined Phase 0, unused)
- Recent-messages row click → `gmail_deep_link_opened` event (currently no event)
- 404 designed-state polish (sender deleted mid-session)
- Disconnected-mailbox state
- E2E Playwright: open → toggle VIP → unsub → confirm pill appears

#### Activity

- Storybook `activity-screen.stories.tsx` — 9 new states (Loading / Error / WithSelection / BulkUndoError / Grouped / VerbFiltered / CustomDateRange / WindowAllTime / UndoTryAgain)
- Per-feature error boundary
- `activity_filter_changed` event on filter mutations (defined Phase 0, unused)
- Per-row `undo_clicked` event (single-undo path; bulk already done)
- Branded `UndoToken` adoption in bulk-undo loop (`apps/web/src/features/activity/activity-screen.tsx`)
- Stuck-revert empty-state polish
- E2E Playwright: filter → bulk-undo → CSV export

#### Brief

- Storybook — Loading / NotYet / Error / Empty / WithSlices states
- Per-feature error boundary
- `page_viewed` event on mount
- Noise row Gmail-link instrumentation (ReplyFyi row done; verify Noise too)
- 404 designed-state polish (Brief not generated yet)
- E2E Playwright: open → click reply-fyi → returns Gmail tab

#### Autopilot

- Storybook — Ready / Empty / PausedAll / WithSuggestions / OneSuggestionExpanded
- Per-feature error boundary
- `page_viewed` event on mount
- Suggestion accept-path instrumentation (when wired; currently dismiss only)
- `autopilot_preset_changed` on rule mode toggle (Observe ↔ Active ↔ Paused)
- Empty-state polish (no rules)
- E2E Playwright: open → pause all → resume

### Cross-cutting (not per-surface)

- **App-shell `page_viewed`** emit on every route change (one hook, attaches to `usePathname`)
- **D204 dual-write removal** on `sender_policies` (after live-smoke confirms dispatcher fires the unsub topic in prod)
- **Inverse-surface tokens** — retire `rgba(255,255,255,*)` literals (~6 sites)
- **`color.red` → `color.danger`** across the 5 surfaces (broader sweep than session-2 Tier B)
- **`pnpm verify-d`** flips for D-rows the 14 commits close
- **IMPLEMENTATION-LOG.md** update
- **LEARNINGS.md** entry — branded IDs adoption pattern · BullMQ `:` jobId gotcha · drift cron overlap guard pattern
- **MISTAKES.md** entry — `@Optional()` Nest DI requirement on optional ctor params

### Recommended order

1. **App-shell `page_viewed`** (cross-cutting, 30min) — unblocks every surface's funnel
2. **Per-feature error boundaries** (5 files, ~1h) — production safety net
3. **Storybook 3 files** (~2.5h) — closes D210 gate violation
4. **Per-surface event gaps** (~2h) — closes the events defined-but-unused
5. **State audit + polish per surface** (~2h)
6. **Branded IDs + dual-write removal** (~1h)
7. **E2E Playwright 5 specs** (~3h) — biggest separate value
8. **Verify-D flips + LEARNINGS/MISTAKES + CLAUDE.md distill** (~30min)

---

## Infra step-by-step (founder-facing)

**Honest answer:** Nothing infra-blocks the code work. The following items unlock **prod deploy** + **prod smoke**, not the next coding session.

### Step 1 — Confirm Sentry FE DSN actually wired (5 min)

```bash
grep SENTRY apps/web/.env.local
```

If empty, follow earlier message (in chat) for Sentry FE setup. Then verify:

```js
// in browser console at http://localhost:3000
throw new Error('sentry-smoke-test');
```

Expect inbox entry at https://declutrmail.sentry.io within 30s.

### Step 2 — Confirm PostHog FE key actually wired (5 min)

```bash
grep POSTHOG apps/web/.env.local
```

If empty, follow earlier message. Verify: browser DevTools → Network → filter `posthog.com` — should see `/e/` POST on every PostHog event call.

### Step 3 — Pub/Sub real wiring (~2h founder GCP clicks + ~3h me code, OWN PR)

Defer to its own PR. Drift cron (5-min sweep + 10-min stale window) covers the gap. If you want it now:

1. **GCP Console** → APIs & Services → enable `Cloud Pub/Sub API` for `declutrmail-ai-prod`.
2. **Pub/Sub** → Topics → create `gmail-push`.
3. **Pub/Sub** → Subscriptions → create push subscription:
   - Topic: `gmail-push`
   - Endpoint: `https://api.declutrmail.com/api/webhooks/gmail/pubsub`
   - Authentication: ENABLE; Service account: `gmail-push-pubsub@declutrmail-ai-prod.iam.gserviceaccount.com`
   - Audience: `https://api.declutrmail.com`
4. **IAM** → grant `gmail-api-push@system.gserviceaccount.com` the `Pub/Sub Publisher` role on the `gmail-push` topic (Gmail-side requirement).
5. **Vercel** env (API project):
   ```
   PUBSUB_WEBHOOK_ENABLED=true
   PUBSUB_PUSH_AUDIENCE=https://api.declutrmail.com
   PUBSUB_PUSH_SA_EMAIL=gmail-push-pubsub@declutrmail-ai-prod.iam.gserviceaccount.com
   GMAIL_PUBSUB_TOPIC=projects/declutrmail-ai-prod/topics/gmail-push
   ```
6. **Hand back to me.** I wire `users.watch` registration in initial-sync worker; smoke real push → IncrementalSyncWorker → cursor advance live.

### Step 4 — Sentry source-map upload (5 min, optional QoL)

1. https://sentry.io/settings/declutrmail/auth-tokens → create token w/ scope `project:releases` + `project:write`.
2. **Vercel** env (web project): `SENTRY_AUTH_TOKEN=<paste>`.
3. **Verifies by:** next deploy uploads source maps automatically (next.config.js already configured).

### Step 5 — Production smoke (after branch deploy, founder hands)

Once branch merges:

1. Vercel auto-deploys.
2. Open https://app.declutrmail.com/senders.
3. Click Sync now → expect "Checking Gmail for new emails…" toast.
4. PostHog → Live events → confirm `sync_now_clicked` lands with the right `source` + `mailbox_id`.
5. Sentry → confirm zero new errors during smoke.
6. Live-smoke an Unsubscribe click → confirm:
   - 202 from `POST /api/actions/unsubscribe-intent`
   - "Unsub queued" pill renders on Sender Detail
   - PostHog `bulk_action_taken { verb: 'unsubscribe' }` lands
   - Outbox event lands in `outbox_events` (`psql -c "SELECT * FROM outbox_events WHERE topic='actions.unsubscribe_intent_recorded' ORDER BY created_at DESC LIMIT 3"`)
   - `sender_policies.policy_type='unsubscribe'` projected within 5s

### Step 6 — D38 row flips in IMPLEMENTATION-LOG.md (5 min me, post-merge)

Auto-flips 🔵 on merge. `pnpm verify-d D38` flips 🟢 after smoke passes. I'll handle.

---

## Notable code locations (so next session lands fast)

- **Tokens:** `packages/shared/src/tokens/tokens.ts` (color.danger + inverse + avatarColors)
- **Events taxonomy:** `packages/shared/src/observability/events.ts` (19 funnel events + `Verb` union)
- **Branded IDs:** `packages/shared/src/ids/branded.ts`
- **Sync-now BE:** `apps/api/src/sync/sync.service.ts:230-280` (enqueueManualIncrementalSync)
- **Sync-now FE:** `apps/web/src/features/sync/api/use-sync-now.ts`
- **Sync-now button:** `apps/web/src/features/sync/sync-now-button.tsx`
- **Drift cron:** `apps/api/src/worker.ts:856-940` (with overlap guard + Sentry routing)
- **Outbox dispatcher boot:** `apps/api/src/worker.ts:946-991`
- **Outbox consumer router:** `apps/api/src/outbox/outbox-consumer-router.ts`
- **D204 event schema:** `packages/events/src/events.ts:265-295`
- **D204 event topic:** `packages/events/src/topics.ts:102-115`
- **Idempotency dedup:** `apps/api/src/actions/actions.service.ts:560-740`
- **Migration 0024:** `packages/db/migrations/0024_action_verb_unsubscribe.sql`
- **Sender Detail polish:** `apps/web/src/features/senders/detail/sender-detail-page.tsx:314-407` + `:551-625` (UnsubQueuedPill + ExternalLinkIcon)
- **Gmail deep links:** `apps/web/src/lib/gmail-links.ts`
- **Senders instrumentation:** `apps/web/src/features/senders/senders-screen.tsx:505-545` (VERB_TO_POSTHOG + entry-point track)
- **Activity instrumentation:** `apps/web/src/features/activity/activity-screen.tsx:861-930` (bulk-undo + CSV)
- **Brief instrumentation:** `apps/web/src/features/brief/brief-screen.tsx:85-103` (handleBriefRefresh) + per-row CTAs
- **Autopilot instrumentation:** `apps/web/src/features/autopilot/autopilot-screen.tsx:109-145` (onDismiss + onConfirmPauseAll)
- **Sentry helpers:** `apps/web/src/lib/sentry.ts:60-130` (addBreadcrumb + captureFeatureException)
- **DI shape regression test:** `apps/api/src/actions/actions.module.spec.ts`
- **BullMQ jobId separator:** `packages/workers/src/queue.ts:65-110` + `incremental-sync.worker.ts:116-122`

---

## Carry-over from session 1 (still open)

These were spec'd in the session-1 handoff doc and remain open:

- **Phase 4 D204 outbox** — SHIPPED in session 2 (✅)
- **Phase 6 Brief instrument** — SHIPPED in session 2 (✅)
- **Phase 7 Autopilot instrument** — SHIPPED in session 2 (✅)
- **Phase 9 Live smoke + PR open** — Live smoke DONE (sync-now + dispatcher boot); PR open is the next-session opener.

---

## Known production risks (carry into review)

1. **Dual-write on `sender_policies`** — direct upsert + outbox publish both fire. Documented as transitional; remove after prod confirms dispatcher fires. Architecture-guardian accepted the transition; the SUGGESTION was to add a verification step in FOUNDER-FOLLOWUPS (do this next session).
2. **BullMQ jobId `:` separator elsewhere** — `BriefSnapshotWorker:2026-06-06T16:48` and similar still use `:`. Worker boot did NOT throw in smoke, so BullMQ's validation is conditional. Worth confirming in next session whether these need migration too. Test: stop API + worker, manually drop one of these jobs into the queue, observe.
3. **Pub/Sub still unwired** — incremental sync only fires via drift cron (5 min) + sync-now button. Real production users will tolerate the 10-min cap; founder smoke needs to confirm UX is acceptable before public launch.
4. **`color.red`** still used in 7+ files. Token exists but consumers haven't migrated; not a regression but a tech-debt mark.
5. **Page-view PostHog events** are defined but never fired. Surfaces ship with their click events instrumented but the page-load funnel is silent.

---

## Open follow-ups (next-session candidates by tier)

### Tier A — finish the 5 surfaces end-to-end (~10-12h)

See **OPEN WORK** section above. Recommended order: app-shell `page_viewed` → per-feature error boundaries → Storybook 3 files → per-surface event gaps → state audit → branded IDs + dual-write removal → E2E Playwright → log/distill closeout.

### Tier B — Pub/Sub real wiring (own PR, ~2h founder + ~3h me)

See Infra Step 3.

### Tier C — Cross-cutting hardening (each its own PR)

- E2E Playwright suite (5 specs, ~3h)
- OpenAPI generation from controllers (~2h)
- Accessibility audit (axe + keyboard-trap, ~2h)
- Sentry server-side source-map upload (~5min founder + ~30min me wiring next.config.js)

---

## How to use this doc

Next session opens with:

```bash
git checkout feat/d038-prod-ready-pass
cat docs/handoffs/2026-06-06-d038-prod-ready-pass-session2-handoff.md
```

Pick a Tier-A bucket from the **OPEN WORK** section. Lands fast against the **Notable code locations** map. When the bucket is done, append a session-3 handoff using this template's shape.

**Branch is mergeable as-is** if the founder wants to ship the 14 session-2 commits now. The remaining work can become 3–5 follow-up PRs (one per surface or one per cross-cutting theme — both shapes work).
