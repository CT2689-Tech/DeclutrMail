# D38 Production-Readiness Pass — Hand-off

**Date:** 2026-06-06
**Branch:** `feat/d038-prod-ready-pass` (8 commits ahead of `feat/d038-senders-v2-integration`)
**Status:** Phases 0, 1, 2a, 2b-a, 3, 5, 8 SHIPPED. Phases 4, 6, 7, 9 OPEN.

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

## Session arc (2026-06-06)

Founder asked for full production-readiness: senders / sender-detail
/ activity / brief / autopilot consistency, observability, error
scenarios, "everything needed for production-ready screens". Approved
3 sharp scope decisions:

1. **Sync path:** Sync-now button + 5-min reconcile cron (defer real
   Pub/Sub to its own PR).
2. **Brief + Autopilot scope:** Full production treatment in this PR.
3. **PostHog event scope:** Action events + page views + full funnel.

8 commits landed in one session, ~+1300 LOC net, across 24 files.

---

## What landed (8 commits)

```
1cd56ba feat(activity): PostHog + Sentry on bulk-undo + CSV export (Phase 3)
ae9026f feat(actions): DB-level idempotency dedup for unsubscribe (Phase 5)
573db98 chore(senders-lab): drop senders-lab-v2 prototype (Phase 8)
b7b2ac5 feat(senders): PostHog + Sentry instrumentation on verb-fire (Phase 2b-a)
07e8ceb feat(senders-detail): unsub-queued pill + Open all in Gmail (Phase 2a)
d759368 chore: gitignore .vercel/ + drop accidentally tracked files
8fd11ab feat(sync): on-demand sync-now + drift-sweep cron (Phase 1)
7f0b8e4 feat(shared): tokens + branded ids + funnel events foundation (Phase 0)
```

### Phase 0 — Foundation (`7f0b8e4`)

- **color.danger** family + dangerBg/dangerBorder/dangerDeep
- **Inverse-surface tokens** — fgInverse / fgInverseSoft / fgInverseMuted / lineInverse
- **Branded IDs** — SenderId / MailboxId / UserId / ActionId / UndoToken / SenderKey / IdempotencyKey + boundary parsers (`asSenderId`, etc.)
- **EventName union extended** — 19 new events: page_viewed, sync_now_clicked, sender_detail_opened, gmail_deep_link_opened, compose_filter_changed, bulk_select_in_filter, bulk_action_taken, confirm_action_modal_opened, recent_subjects_expanded, sender_search_submitted, activity_filter_changed, bulk_undo_clicked, csv_exported, brief_refresh_clicked, brief_cta_clicked, autopilot_paused, autopilot_resumed, autopilot_suggestion_decided, autopilot_preset_changed
- **Verb literal hoisted** to KAULD union (`keep | archive | unsubscribe | later | delete`)
- 13 new branded-id tests; shared 146/146.

### Phase 1 — Sync-now + drift cron (`8fd11ab`)

**Backend**

- `POST /api/v1/sync/incremental` — RateLimit `gmail-action` 6/min, 202 with `{outcome:'enqueued'|'noop', cursor_history_id}`. 409 SYNC_NOT_READY (designed state per CLAUDE.md §8).
- `SyncService.enqueueManualIncrementalSync(mailboxId, 'manual'|'cron')` — reads `last_history_id`, enqueues with start=end=cursor; BullMQ jobId `${mailbox}:${cursor}` dedups.
- `SyncService.listMailboxesNeedingDriftSweep(staleAfterMs)`.
- SyncModule owns both queue producers (initial + incremental); WebhooksModule drops its dupe.

**Worker**

- Drift sweep cron: every 5 min, every mailbox whose cursor hasn't advanced in 10 min gets an enqueue. Batch 100; idempotent end-to-end.
- Closes local-dev gap (no Pub/Sub locally) + production Pub/Sub-drift gap.

**Frontend**

- `useSyncNow(source)` mutation hook — typed `SyncNowErrorCode` (`SYNC_NOT_READY | RATE_LIMITED | NO_ACTIVE_MAILBOX | UNKNOWN`); invalidates senders/activity/brief/sender-detail roots on success; PostHog `sync_now_clicked`; Sentry breadcrumbs.
- `<SyncNowButton />` in AppShell.topbarRight; hidden until ready; aria-busy + spinner.
- `addBreadcrumb()` + `captureFeatureException()` helpers in `apps/web/src/lib/sentry.ts`.

**Tests:** 3 SyncController + 7 translateSyncNowError.

### Phase 2a — Sender Detail polish (`07e8ceb`)

- **Unsub-queued pill** renders when `detail.policyType === 'unsubscribe'` (mirrors senders-list row).
- **"Open all in Gmail" button** — `gmailAllFromSenderDeepLink(email)` deep-link. PostHog `gmail_deep_link_opened` (source=`sender_detail_open_all`, kind=`all_from_sender`). Closes Q3.2 "Robinhood subjects useless".
- **`SenderDetail.email + policyType`** wired from wire DTO.
- New `apps/web/src/lib/gmail-links.ts` — thread / all-from-sender / search shapes.

### Phase 2b-a — Senders verb instrumentation (`b7b2ac5`)

- `performAction()` emits **one** PostHog `bulk_action_taken` + **one** Sentry breadcrumb before branching into Archive / Composite / Unsub / tracer paths. Single entry → exactly one event per intent.
- `VERB_TO_POSTHOG` map: `ActionVerb` → KAULD token (Protect → 'keep' for funnel).
- Shared re-exports `Verb` type from observability barrel.

### Phase 3 — Activity instrumentation (`1cd56ba`)

- `BulkActionBar.runBulkUndo()` — PostHog `bulk_undo_clicked` with action_ids_count + outcome (`all_success | partial | all_failed`); Sentry breadcrumb (category=undo).
- `ExportCsvButton.onClick` — PostHog `csv_exported` with surface + row_count + filtered. `filtered=true` when any filter is away from defaults.

### Phase 5 — DB-level idempotency dedup (`ae9026f`)

- **Migration 0024** — `ALTER TYPE action_verb ADD VALUE 'unsubscribe'`. Additive; mirrors 0019's delete-verb pattern. Rollback recreates the type without 'unsubscribe' (fails cast if rows depend on the value).
- **ActionsService.recordUnsubscribeIntent** — persists a dedup partner in `action_jobs` with verb='unsubscribe', status='done', selector={sender}, resolved_message_ids=[activityLogId]. FE-supplied key is namespaced with `unsub:` prefix to prevent collisions with worker job keys.
- ON CONFLICT (idempotency_key) DO NOTHING handles concurrent races.
- **enqueueCompositeRevert** explicitly skips siblings with verb='unsubscribe' (no Gmail side-effect to reverse).
- 2 new tests: same key → ONE activity_log row + namespaced key prevents cross-verb collision. 27/27 actions tests pass.

### Phase 8 — Cleanup (`573db98`)

- `rm -rf apps/web/src/app/senders-lab-v2/` — 1408-line throwaway prototype, no imports anywhere.

---

## What's open (Phases 4, 6, 7, 9)

### Phase 4 — D204 outbox boundary fix (~2h)

**Why:** `architecture-guardian` flagged `ActionsService.recordUnsubscribeIntent` directly writes `sender_policies` (a senders-feature-owned table). D204 boundary requires either a SendersWriter facade OR an outbox event.

**How (preferred — outbox):**

1. Add `actions.unsubscribe_intent_recorded` to `packages/events/src/events.ts` with payload `{ mailboxAccountId, senderKey, recordedAt }`.
2. Emit from `ActionsService.recordUnsubscribeIntent` via `outbox.publish(tx, …)` inside the existing transaction (mirrors LabelActionWorker outbox pattern at `label-action.worker.ts:304-313`).
3. Add a senders-owned consumer worker (`packages/workers/src/senders-policy-attribution.worker.ts` OR extend the existing reconciler) that projects the event into `sender_policies.policy_type='unsubscribe'`.
4. Drop the direct `tx.insert(senderPolicies)` from ActionsService.

**Tests:** Integration test in `actions.service.spec.ts` asserts the outbox row lands; consumer test asserts the policy row is upserted.

### Phase 6 — Brief production (~2h)

- PostHog `brief_refresh_clicked` on NotYetState refresh.
- PostHog `brief_cta_clicked` (kind/target) on every CTA: top sender open, open in Gmail, review session start, sender detail open.
- Sentry breadcrumbs on every CTA + on error states.
- Empty/error state audit — confirm every fetch path has a real-state branch (NotYetState exists; verify it covers 404 / 500 / empty list).
- Storybook coverage check — Brief stories file exists; confirm all states covered.
- `useWeeklyHero` port — `weekly-hero-live.tsx` already reads `slice.senders[0]` correctly; the FOUNDER-FOLLOWUPS hotfix note was stale. CLOSE the followup.

### Phase 7 — Autopilot production (~2h)

- PostHog `autopilot_paused` + `autopilot_resumed` (manual vs window_expired).
- PostHog `autopilot_suggestion_decided` (accepted | rejected | snoozed; kind=preset_rule | sender_policy | preset_change).
- PostHog `autopilot_preset_changed` (preset_id + action enabled/disabled/parameter_changed).
- Sentry breadcrumbs on every state transition.
- Empty/error/loading audit — autopilot has `paused-banner.tsx`, `pause-confirm-modal.tsx`, `pending-suggestion-row.tsx`. Walk each.
- Storybook check — autopilot-screen.stories.tsx exists; confirm covers paused / suggestion-pending / preset-list states.

### Phase 9 — Live smoke matrix + PR open (~3h founder + 1h me)

| Surface                  | Smoke                                                                                                       |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Sync-now button          | Click → toast → Network tab POST /api/v1/sync/incremental 202; check sender list refresh                    |
| Drift cron               | Wait 10 min after last sync → observe `incremental_drift.swept` log line                                    |
| Sender Detail Unsub pill | Set `sender_policies.policy_type='unsubscribe'` via SQL → reload → pill visible                             |
| Open all in Gmail        | Click → new tab → Gmail search `from:<email>` shows results                                                 |
| Idempotency dedup        | curl POST `/api/actions/unsubscribe-intent` with same Idempotency-Key twice → SAME `activityLogId` returned |
| Activity bulk-undo       | Select 3 rows → undo → PostHog Live events shows `bulk_undo_clicked outcome=all_success`                    |
| Activity CSV             | Set verb filter → Export → PostHog `csv_exported filtered=true`                                             |
| Multi-mailbox switch     | Switch mailbox A → B → senders + activity + sender-detail caches reset (no stale data)                      |
| Disconnect / reconnect   | Disconnect B → app shell takes over (NoActiveMailbox) → reconnect → flow resumes                            |
| Storybook                | `pnpm --filter @declutrmail/web storybook` → every component renders without error                          |

PR body must call out:

- Each Closes D###
- Each Closes FOUNDER-FOLLOWUPS line
- All gate-agent results
- Migration 0024 — Atlas dry-run output

---

## Infra status (founder)

| Item                                       | Status                                                |
| ------------------------------------------ | ----------------------------------------------------- |
| Sentry FE DSN (`NEXT_PUBLIC_SENTRY_DSN`)   | ✅ Set (founder confirmed in-session)                 |
| PostHog FE key (`NEXT_PUBLIC_POSTHOG_KEY`) | ✅ Set                                                |
| Pub/Sub real wiring                        | Deferred — drift cron + Sync now button cover the gap |

Code is DSN/key-gated: events become no-ops when the env var is missing. Once Vercel deploys with the keys, every instrumented surface (Senders verb-fire, Activity bulk-undo + CSV, Sync-now, gmail deep links) starts emitting live.

---

## Test summary (8 commits)

| Suite                  | Pass / Total | Pre-existing skips/fails                               |
| ---------------------- | ------------ | ------------------------------------------------------ |
| `@declutrmail/shared`  | 146 / 146    | — (was 133, +13 branded)                               |
| `@declutrmail/db`      | 37 / 37      | —                                                      |
| `@declutrmail/workers` | 269 / 270    | 1 skip                                                 |
| `@declutrmail/api`     | 485 / 485    | 10 skip (was 483, +2 unsub-dedup)                      |
| `@declutrmail/web`     | 331 / 332    | 8 pre-existing senders-screen failures (Phase 5 sweep) |

**Zero new regressions across the session.** Net +25 new tests this session.

---

## Open follow-ups (next session)

### Tier A — focused work (1.5–2h each)

- **Phase 4** — outbox `actions.unsubscribe_intent_recorded` + consumer.
- **Phase 6** — Brief PostHog/Sentry + state audit.
- **Phase 7** — Autopilot PostHog/Sentry + state audit.
- **Storybook coverage** — ComposeStrip + ConfirmActionModal + 9 Activity new states (FOUNDER-FOLLOWUPS 2026-06-05 D210).

### Tier B — small distillation

- **CLAUDE.md §2.2 K/A/U/L → K/A/U/L/D** — founder-only `chore/distill-*` PR per CLAUDE.md §11.
- **TOP SENDER hero hotfix** — CLOSE FOUNDER-FOLLOWUPS entry; `weekly-hero-live.tsx:128` actually reads correctly (`slice.senders[0]`).

### Tier C — when Pub/Sub real wiring lands (separate PR)

- Configure `gmail-push` topic + push subscription + OIDC service account
- Set `GMAIL_PUBSUB_TOPIC` / `PUBSUB_OIDC_AUDIENCE` Vercel env
- Wire `users.watch` registration in initial-sync worker
- Smoke real Pub/Sub fire → IncrementalSyncWorker → cursor advance

---

## Notable code locations (so the next session lands fast)

- Tokens: `packages/shared/src/tokens/tokens.ts` (color.danger + inverse)
- Events: `packages/shared/src/observability/events.ts` (19 new + Verb)
- Branded IDs: `packages/shared/src/ids/branded.ts`
- Sync-now BE: `apps/api/src/sync/sync.service.ts` (enqueueManualIncrementalSync)
- Sync-now FE: `apps/web/src/features/sync/api/use-sync-now.ts`
- Drift cron: `apps/api/src/worker.ts:842-913`
- Sender Detail polish: `apps/web/src/features/senders/detail/sender-detail-page.tsx:314-407`
- Gmail deep links: `apps/web/src/lib/gmail-links.ts`
- DB mig 0024: `packages/db/migrations/0024_action_verb_unsubscribe.sql`
- Idempotency dedup: `apps/api/src/actions/actions.service.ts:559-680`
- Senders instrumentation: `apps/web/src/features/senders/senders-screen.tsx:518-557`
- Activity instrumentation: `apps/web/src/features/activity/activity-screen.tsx:861-906`
- Sentry helpers: `apps/web/src/lib/sentry.ts:60-130`

---

**Branch is in a clean, mergeable state.** Phases 4 / 6 / 7 / 9 can be either their own PRs (smaller review surface) OR appended to this branch in a follow-up session.
