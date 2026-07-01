# Launch Gap Audit — 2026-06-09

> **Method.** 12 parallel audit agents (one per product area), each cross-checking
> plan text (`docs/execution/Implementation-Plan.md`, incl. patches) → `IMPLEMENTATION-LOG.md`
> → actual code. 527 tool calls, every status claim carries file-path evidence.
> **Scope.** Built-vs-planned for V2 launch. No fixes proposed here — this is the map.
>
> **Result.** 110 gaps found; 53 launch-critical. 12 IMPLEMENTATION-LOG drift cases.

---

## Executive summary

The repo is meaningfully further along than the last gap map (2026-05-30) suggested.
The destructive-action pipeline (ADR-0013/0020) is **built and tested** — composite
`POST /api/actions`, real-count previews, idempotency, undo tokens, label-action
worker, receipt strip — but it is wired **only to the Senders surface**. The product's
core ritual (Triage) still dead-ends at a fixture toast. Unsubscribe — the headline
verb of a Gmail-cleanup product — is intent-recording only; nothing ever POSTs to a
`List-Unsubscribe` URL. Billing does not exist at all (no provider, no schema, no
gating). No public surface exists (no landing page, no pricing, no legal pages — the
latter blocks Google OAuth verification). Autopilot's engine is built and tested but
never runs in production (seeder + apply worker not registered in `worker.ts`).

**The shape of the remaining work is mostly wiring, not invention** — the hard
backend primitives (actions, undo, preview, sync, scoring, autopilot matching) exist
with test coverage. The exceptions (genuinely new builds): unsubscribe execution,
billing, onboarding steps 1/2/4/5, Screener, account deletion execution, marketing site.

---

## The launch line

Three tiers. Items below the cut line ship after public launch or were explicitly
deferred by the plan.

| Tier                  | Definition                                            | Gate      |
| --------------------- | ----------------------------------------------------- | --------- |
| **A — Private beta**  | 10–20 invited users, free-only, real Gmail mutations  | Waves 1–4 |
| **B — Public launch** | Paying users, OAuth-verified app, compliance complete | Waves 5–6 |
| **C — Post-launch**   | Plan-deferred + growth surfaces                       | backlog   |

**Founder decision embedded here (D-candidate):** beta ships **without billing**
(free-only, founding-member waitlist). The plan assumes billing at launch; running a
free private beta first cuts ~3 weeks off time-to-first-user and de-risks the
mutation surface with real inboxes before money is involved. Same logic defers
Screener (Pro-gated per D77 — ungateable until tiers exist). Both flagged as
plan-drift for explicit founder sign-off, per CLAUDE.md §3.

---

## Wave plan

Effort scale: S = hours · M = 1–2 days · L = 3–5 days · XL = week+ (agent-days, not
founder-days; waves parallelize internally via workflows).

### Wave 1 — Close the core loop (Triage + Senders mutations land for real)

The pipeline exists; this wave is mostly FE wiring + two small API endpoints.

| Item                                                        | Effort | Status  | Evidence anchor                                              |
| ----------------------------------------------------------- | ------ | ------- | ------------------------------------------------------------ |
| Triage verb mutation wiring (confirm → `POST /api/actions`) | L      | stub    | `triage-screen.tsx:71-86` dispatchAction = toast only        |
| Undo tray mounted on triage (+ `Z` shortcut)                | M      | missing | `packages/shared/.../undo-tray/` has zero non-test consumers |
| Triage route error state (5xx/network)                      | S      | missing | no `isError` branch; skeleton renders forever                |
| Keep/Protect policy persistence endpoint                    | M      | missing | no controller writes `sender_policies` for keep/protect      |
| VIP/Protect toggle persistence (sender detail)              | M      | partial | `toggleVip`/`toggleProtect` = local state + toast            |
| Keep verb on Senders (currently tracer toast)               | S      | stub    | `sender-detail-page.tsx:~323`                                |
| Multi-sender bulk actions (selection-bar A/L/D)             | L      | stub    | `senders-screen.tsx:~728` fabricated receipt                 |

### Wave 2 — Unsubscribe execution (the headline feature)

| Item                                                                       | Effort  | Status  | Notes                                                                             |
| -------------------------------------------------------------------------- | ------- | ------- | --------------------------------------------------------------------------------- |
| RFC 8058 one-click POST pipeline (worker)                                  | XL      | stub    | `recordUnsubscribeIntent` only upserts policy; no code touches `List-Unsubscribe` |
| Mailto manual-compose affordance (D230: manual at launch, never auto-send) | (incl.) | missing | guardrail §2.6                                                                    |
| List-Unsubscribe header capture check (ADR-0004 allowlist)                 | (incl.) | verify  | dependency for both paths                                                         |

### Wave 3 — Autopilot wiring + onboarding completion + email infra

| Item                                                                                                                            | Effort | Status  |
| ------------------------------------------------------------------------------------------------------------------------------- | ------ | ------- |
| Register `AutopilotApplyWorker` + preset seeder in `worker.ts`; wire `MAILBOX_SYNC_READY` / `SCORE_RUN_COMPLETED` outbox topics | M      | partial |
| Active-mode action consumer (Gmail mutation + `undo_journal`)                                                                   | L      | missing |
| Observe-mode approve flow (approve all / selected)                                                                              | M      | missing |
| Preset rule management UI (toggle, threshold, last-run)                                                                         | L      | missing |
| Dry-run preview endpoint + UI (`POST /autopilot/rules/preview`)                                                                 | M      | missing |
| Autopilot attribution in Activity feed                                                                                          | M      | stub    |
| Gmail `users.watch` registration                                                                                                | M      | missing |
| `WatchRenewalWorker` (cronPolicy, 6h) + `cron_runs` table                                                                       | M      | missing |
| `FollowupCheckWorker` registration in worker runtime                                                                            | S      | partial |
| Onboarding steps 1/2/4/5 (promise, connect, preset pick, first triage)                                                          | XL     | missing |
| Strict sync gate on return/direct nav mid-initial-sync                                                                          | S      | partial |
| Transactional email infra (provider TBD — Resend recommended) + sync completion / +24h reminder emails                          | L      | missing |
| Fix banned copy: `sync-gate.tsx:327` "Bodies read: 0 — forever" → D228 `PrivacyBadge`                                           | S      | partial |

### Wave 4 — Beta gate (public surface minimum + prod infra)

| Item                                                                                   | Effort | Status  | Owner                         |
| -------------------------------------------------------------------------------------- | ------ | ------- | ----------------------------- |
| Public-route auth exemption mechanism (providers.tsx wraps everything today)           | M      | missing | agents                        |
| Landing page at `/` (D134 structure, D223 headline, trust strip) + waitlist capture    | XL     | missing | agents                        |
| Legal pages `/privacy` + `/terms` (D146) — **blocks Google OAuth verification**        | M      | missing | agents draft, founder reviews |
| Mount `PrivacyBadge` on onboarding + settings surfaces (D228)                          | S      | partial | agents                        |
| CSP + security headers (D175 nonce-based, middleware)                                  | M      | missing | agents                        |
| Custom domain cutover (app/api.declutrmail.com, cookies, OAuth redirect, Pub/Sub push) | M      | open    | **founder hands**             |
| Enable webhooks in prod (`PUBSUB_WEBHOOK_ENABLED` + fix env-name drift in deploy yml)  | S      | partial | agents + founder              |
| Sentry alert rules (error rate, new-error)                                             | S      | missing | founder hands (UI)            |
| API `min_instances=1` (D193)                                                           | S      | partial | agents                        |
| SEO basics (robots, sitemap, favicon, OG)                                              | S      | missing | agents                        |

**→ PRIVATE BETA SHIPS HERE.**

### Wave 5 — Monetization (during beta)

| Item                                                                                                      | Effort | Status  |
| --------------------------------------------------------------------------------------------------------- | ------ | ------- |
| Paddle + Razorpay integration (`BillingProvider` interface, D117/D126 — plan says no Stripe)              | XL     | missing |
| Billing webhooks + HMAC verification (D180)                                                               | L      | missing |
| Billing DB schema (`billing_customers`, `subscriptions`, `subscription_events`, `users.billing_region`)   | M      | missing |
| Server-side tier entitlement enforcement (402s, free caps, multi-inbox gate)                              | L      | missing |
| Pricing page `/pricing` (public, 4 tiers, Founding Pro offer)                                             | M      | missing |
| Billing screen (plan card, cancel/pause, plan-change)                                                     | L      | stub    |
| Web Pro-gating surfaces (upgrade modals, D83/D77 gates)                                                   | M      | missing |
| Screener feature (queue UI, BE module, `screen` verdict enum migration, soft quarantine, badge, Pro gate) | XL     | missing |

### Wave 6 — Compliance (before public launch)

| Item                                                                               | Effort | Status  | Notes                                                             |
| ---------------------------------------------------------------------------------- | ------ | ------- | ----------------------------------------------------------------- |
| Account deletion execution (persistence, cron job, sync pause, waiver, controller) | L      | partial | **CLAUDE.md §9 stop-condition — needs founder approval to build** |
| Deletion UI flow (typed confirm, waiver, grace banner, cancel)                     | L      | missing |                                                                   |
| Deletion confirmation + receipt emails                                             | M      | missing | rides Wave-3 email infra                                          |
| Data export (D217 Privacy & Data sub-page, DPDP)                                   | L      | missing |                                                                   |
| Settings index page (real cards)                                                   | S      | stub    |                                                                   |

### Wave 7 — Production-readiness audit → UI redesign → public launch

Per the agreed master plan: 10-dimension adversarial audit workflow → fix slate →
design-lab variants → redesign hardening → launch marketing pages (methodology,
/vs/_ comparisons, /how-to/_, FAQ, changelog) → Product Hunt / HN.

---

## Below the cut line (not beta/launch blocking)

57 non-critical gaps recorded by the audit. Notables, grouped:

- **Triage polish:** D34 preference persistence + Settings toggle (M) · D221 dual
  empty state (S) · triage on ADR-0019 verb registry + Delete verb (M) · RSC
  hydration prefetch (M)
- **Mutation polish:** offline draft intents D233 (M) · shell-level undo tray (S)
- **Autopilot depth:** D197 generic rule engine (L) · D102 all-inboxes fanout (M) ·
  7-day observe window mechanics (M) · D105 cross-inbox pause (S)
- **Onboarding depth:** D38 triage tour (M) · push notifications (M) · funnel
  instrumentation (S) · sync-gate E2E (M)
- **Screens:** Snoozed (L) · Quiet hours (L) · Activity remainder (M) · D211
  inventory staleness (M)
- **Platform:** dead-letter table + replay (L) · correlation-ID propagation (M) ·
  checkpointing hooks (M) · cursor HMAC (S) · D156 global IP ceiling (S) ·
  WorkspacesModule/UnitOfWork (M)
- **Observability:** Playwright E2E in CI (L) · server-side PostHog events (M) ·
  ~17 declared-never-fired FE events (M) · dashboards (L) · Lighthouse/bundle CI (M) ·
  source-map verification (S) · prod-migration approval gate regressed to auto-apply (S)
- **Security hardening:** Turnstile bot protection (M) · KMS local-key fallback
  unchecked in prod (S) · `RATE_LIMIT_ENABLED=false` ambiguity in deploy (S) ·
  CSRF on `/sync/incremental` (S)
- **Marketing growth (Tier C):** methodology page (L) · 5 /vs/_ pages (L) ·
  5 /how-to/_ pages (M) · inbox simulator (XL) · changelog+RSS (M) · FAQ (M) ·
  cookie consent (S) · copy-enforcement hooks (S)

---

## IMPLEMENTATION-LOG drift (12 rows need correction)

The log overstates in 9 cases and understates in 3. A correction pass should flip
these before they mislead another session:

| Row         | Logged | Reality                                                                                                            |
| ----------- | ------ | ------------------------------------------------------------------------------------------------------------------ |
| D226        | 🟢     | Lifecycle verified on Senders only; triage mutation+undo legs are fixture stubs                                    |
| D35         | 🟢     | BE undo service only; the decision's triage undo tray + Z shortcut unbuilt                                         |
| D34         | 🟢     | Sheet works; `skip_action_sheet` persistence, Settings toggle, conflict-reopen missing                             |
| D232        | 🟢     | Schedule computation only; no persistence, no deletion job, no controller                                          |
| D228        | 🟢     | Component verified in isolation; banned copy still live on sync gate; no surfaces mount it; no microcopy hook rule |
| D6          | 🟢     | Worker progress mechanics only; emails, push, funnel, strict gate missing                                          |
| D38         | 🔵     | Onboarding-tour capability absent; '(D38)' reused as umbrella tag in PRs #161–#178                                 |
| D101 et al. | 🟢     | Presets never seeded in prod; no per-preset UI; engine tested but unwired                                          |
| D211        | 🟢     | Inventory stale (`covered-by-pr-52` literal); omits post-PR-52 screens                                             |
| D225        | ⬜     | Understated — 5-policy set + cron idempotency implemented; only cron_runs/DLW missing                              |
| D158        | ⬜     | Understated — Cloud Run + WIF + Secret Manager + Supabase live; domain slice remains                               |
| D77         | ⬜     | Code ships a D77-labeled free-cap path; D-attribution itself looks wrong (D19 vs D77)                              |

---

## Founder decisions needed (blocking sequencing)

1. **Free-only private beta before billing?** Recommended yes. Flagged as plan-drift
   (plan assumes billing at launch).
2. **Screener deferred to Wave 5?** Recommended yes — Pro gate unbuildable without
   tiers. Plan-drift flag (plan lists it as a launch surface).
3. **Email provider.** Resend recommended (DX, React Email templates). Founder
   action: create account + domain DNS records.
4. **Domain + Google OAuth verification — start NOW.** Verification lead time is
   weeks and requires a hosted privacy policy on the verified domain (Wave 4 item).
   Founder action: buy domain, then agents wire DNS/cookies/redirects.
5. **Account deletion build approval** (CLAUDE.md §9 stop-condition). Wave 6 cannot
   start without explicit founder go-ahead.
6. **Log correction pass approval** for the 12 drift rows above.

---

_Raw audit output (full evidence, 12 areas × built summaries × 110 gaps):_
`/private/tmp/claude-501/-Users-chintant-projects-DeclutrMail/9846c0ce-78c7-4ae8-9d77-157347702abb/tasks/wy0i3x0ef.output` _(ephemeral — this doc is the durable record)._
