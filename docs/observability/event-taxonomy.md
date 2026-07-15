# Event taxonomy (D159)

Canonical list of PostHog events emitted by DeclutrMail. The TypeScript
union in `packages/shared/src/observability/events.ts` is the source of
truth for event NAMES and PAYLOAD SHAPES; this document is the source
of truth for WHEN they fire and HOW they're aggregated.

## Privacy contract (D7, D228)

Every event payload below is checked against the no-body / no-PII rules:

- No full or partial message body, snippet, attachment, MIME, or
  non-allowlisted header — at any depth in the property graph.
- No raw email addresses. Identifiers are internal UUIDs from our DB.
- The shared scrubber (`scrubObject`) runs at the call site (first
  defense) and again inside PostHog's `sanitize_properties` hook (second
  defense). Any new field added below MUST be verifiable as scalar +
  privacy-safe before it ships.

## Identifier conventions

| Identifier   | Format           | Origin                  |
| ------------ | ---------------- | ----------------------- |
| `user_id`    | internal UUID v7 | `users.id`              |
| `mailbox_id` | internal UUID v7 | `mailboxes.id`          |
| `sender_id`  | internal UUID v7 | `senders.id`            |
| `sync_id`    | internal UUID v7 | `syncs.id`              |
| `rule_id`    | internal UUID v7 | `rules.id`              |
| `action_id`  | internal UUID v7 | `actions.id` (for undo) |

Gmail `messageId`, `threadId`, raw email addresses, and message body
content are NEVER sent.

When optional analytics consent exists, the authenticated shell identifies
PostHog with `users.id` (the internal UUID) and retries if consent is granted
mid-session. Sign-out resets that identity before navigation. Gmail addresses
and mailbox addresses are never used as analytics identities.

---

## Events

### `onboarding_step_viewed`

**When fired.** When an onboarding step (D106 machine: promise →
connect → sync gate → preset pick → first triage) first renders in a
page session. Fires once per step per page load — a refresh that
resumes the flow re-emits for the resumed step, so drop-off points
stay visible in the funnel.

**Payload.**

| Field  | Type                                                                                             | Notes                          |
| ------ | ------------------------------------------------------------------------------------------------ | ------------------------------ |
| `step` | `'promise' \| 'connect_gmail' \| 'sync_gate' \| 'choose_preset' \| 'first_triage' \| 'finished'` | D106 step machine stage (D107) |

**Retention / aggregation.** PostHog default (7y). Paired with
`onboarding_step_completed` for the per-step conversion funnel. The
`promise` + `connect_gmail` views fire PRE-AUTH (anonymous PostHog id)
— no `user_id` exists yet by design.

### `onboarding_step_completed`

**When fired.** As soon as the user finishes a discrete onboarding step
in the D106 / D109 / D224 flow. Fires once per step per user; replays
of the flow re-emit (so the funnel reflects retries). `finished` fires
after `POST /api/onboarding/complete` succeeds (D113).

**Payload.**

| Field         | Type                                                                                             | Notes                              |
| ------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------- |
| `step`        | `'promise' \| 'connect_gmail' \| 'sync_gate' \| 'choose_preset' \| 'first_triage' \| 'finished'` | D106 step machine stages           |
| `duration_ms` | `number`                                                                                         | Time on the step (client-measured) |

**Retention / aggregation.** PostHog default (7y). Built into the
onboarding funnel insight. No per-user breakdown beyond `user_id`.

### `sync_started`

**When fired.** Client-side today: the FE sync gate (`useSyncGateFunnel`)
fires it on its FIRST in-progress observation (`queued`/`syncing`) of
the D224 status poll — once per gate view, ref-guarded against the 3s
poll re-fires; a mailbox already `ready` on mount fires nothing. A
future server-side emitter (`POST /api/sync/start` accept, Pub/Sub
delta-sync) will carry a non-null `sync_id` — analysis discriminates FE
vs BE fires on that field.

**Payload.**

| Field        | Type                                          | Notes                                                     |
| ------------ | --------------------------------------------- | --------------------------------------------------------- |
| `sync_id`    | `string \| null`                              | UUID; `null` for FE gate fires (no id on the status poll) |
| `mailbox_id` | `string`                                      | UUID                                                      |
| `trigger`    | `'initial' \| 'manual' \| 'pubsub' \| 'cron'` | What kicked it off; FE gate fires are always `initial`    |

**Retention / aggregation.** 90 days for raw, rolled up into the
"syncs per mailbox per day" cohort weekly.

### `sync_completed`

**When fired.** Client-side today: the FE sync gate fires it on an
observed transition into `ready` (`success`) or `failed` — only AFTER
an observed start (never an unpaired completion), once per transition
(ref-guarded). A transient `failed` that recovers to `ready` emits a
second completion with `outcome: 'success'` — analysis takes the
mailbox's last outcome. Per D224 the readiness is real worker state —
not a fake-progress trigger. A future server-side emitter adds
`partial` + real counts.

**Payload.**

| Field              | Type                                 | Notes                                                                           |
| ------------------ | ------------------------------------ | ------------------------------------------------------------------------------- |
| `sync_id`          | `string \| null`                     | UUID; `null` for FE gate fires                                                  |
| `mailbox_id`       | `string`                             | UUID                                                                            |
| `messages_indexed` | `number`                             | Final count; `-1` when unknown (FE — no counts on the poll)                     |
| `duration_ms`      | `number`                             | FE: observed wait (first in-progress poll → terminal); BE: full sync wall-clock |
| `outcome`          | `'success' \| 'partial' \| 'failed'` | Terminal state; FE fires never emit `partial`                                   |

**Retention / aggregation.** 90 days raw. Powers sync-success-rate and
sync-duration-p50/p95 dashboards.

### `triage_action_taken`

**When fired.** When the server accepts a preview-confirmed decision:
the intent POST for Keep/Unsubscribe or the composite enqueue for
Archive/Later. This is a decision/enqueue event, not proof that the
worker completed or that a sender honored an unsubscribe request. It is
never fired on preview open or on a rejected POST. One decision → one
event (the unsubscribe sheet's optional backlog archive does not emit a
second event).

**Payload.**

| Field                    | Type                                                          | Notes                                                                       |
| ------------------------ | ------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `verb`                   | `'keep' \| 'archive' \| 'unsubscribe' \| 'later' \| 'delete'` | Canonical K/A/U/L/D (D227)                                                  |
| `sender_id`              | `string`                                                      | UUID                                                                        |
| `matched_recommendation` | `boolean`                                                     | User's verb equals the engine verdict for the row (D21/D29)                 |
| `requested_messages`     | `number`                                                      | Count accepted for enqueue; `0` for Keep/Unsubscribe; `-1` when unavailable |
| `source`                 | `'sheet' \| 'inline' \| 'shortcut'`                           | Confirm surface; Keep (no preview, D40) records as `inline`                 |

**Retention / aggregation.** 1y raw. Powers the "triage decisions per
user per week" cohort and K/A/U/L mix dashboard. Never use this event
for affected-message value; use terminal worker-confirmed Activity data.

### `undo_clicked`

**When fired.** At CLICK time on the undo affordance — the D35 tray's
per-row Undo button or the Z (undo-last) shortcut — once per attempt
(the tray's single-in-flight guard dedupes re-clicks). Fires whether or
not the revert later succeeds: the click IS the regret signal. No
`action_id` is sent — the FE only holds the undo TOKEN at click time,
and a live capability token must never reach telemetry.

**Payload.**

| Field    | Type                                                                          | Notes                                         |
| -------- | ----------------------------------------------------------------------------- | --------------------------------------------- |
| `verb`   | `'keep' \| 'archive' \| 'unsubscribe' \| 'later' \| 'delete' \| 'apply-rule'` | The undone action's kind (`undo_action_kind`) |
| `age_ms` | `number`                                                                      | Time from action to undo click                |

**Retention / aggregation.** 1y raw. Drives "regret rate" (undo within
60s) and the undo-window sizing decision.

### `unsubscribe_attempted`

**When fired.** When an unsubscribe action enters the unsubscribe
worker. Per D230 mailto unsubscribes are manual at launch, so `method`
will only ever be `http` or `mailto_draft` (draft prepared, not sent)
or `manual` (user takeover).

**Payload.**

| Field       | Type                                   | Notes         |
| ----------- | -------------------------------------- | ------------- |
| `sender_id` | `string`                               | UUID          |
| `method`    | `'http' \| 'mailto_draft' \| 'manual'` | Per D230      |
| `outcome`   | `'success' \| 'failed' \| 'queued'`    | Worker result |

**Retention / aggregation.** 1y raw. Powers the unsubscribe success
rate dashboard.

### `rule_fired`

**When fired.** Each time an Autopilot rule (D99–D105) matches and
performs an action. Fires once per rule-match per execution, NOT once
per affected message (to keep cardinality bounded).

**Payload.**

| Field               | Type                                              | Notes                                  |
| ------------------- | ------------------------------------------------- | -------------------------------------- |
| `rule_id`           | `string`                                          | UUID                                   |
| `rule_is_preset`    | `boolean`                                         | Custom rules are deferred at V2 (D234) |
| `verb`              | `'keep' \| 'archive' \| 'unsubscribe' \| 'later'` | The rule's action                      |
| `affected_messages` | `number`                                          | Count this firing covered              |

**Retention / aggregation.** 6mo raw. Drives "rules saving users time"
metric — affected_messages aggregated per user per week.

### `billing_event`

**When fired.** On every billing-provider webhook (Stripe, etc.) the API
processes. Fires from the verified webhook handler only — never from
client-side billing UI (clients can't see real subscription state).

**Payload.**

| Field  | Type                                                                                                                     | Notes         |
| ------ | ------------------------------------------------------------------------------------------------------------------------ | ------------- |
| `kind` | `'subscription_created' \| 'subscription_updated' \| 'subscription_canceled' \| 'payment_succeeded' \| 'payment_failed'` | Webhook event |
| `tier` | `'free' \| 'plus' \| 'pro'`                                                                                              | Per D19       |

**Retention / aggregation.** 2y raw (overlaps with billing audit
retention). Drives MRR cohort, churn cohort, free-to-paid funnel.

### `page_viewed`

**When fired.** Once per mount of an instrumented page. The public route
tracker covers the landing, product-story, comparison, education, changelog,
FAQ, and sign-in families; public pages with richer local islands (pricing,
legal/support, and the inbox simulator) emit from those islands. Authenticated
surfaces emit after their own screen mounts.

**Payload.**

| Field        | Type                                          | Notes                                                                        |
| ------------ | --------------------------------------------- | ---------------------------------------------------------------------------- |
| `page`       | Closed enum in `EventPayloads['page_viewed']` | Product surface or bounded public content family; dynamic slugs are not sent |
| `mailbox_id` | `string \| null`                              | UUID; `null` on public pages (landing has no auth)                           |

**Retention / aggregation.** PostHog default. Top of the
landing → OAuth → onboarding funnel insight.

### `landing_cta_clicked`

**When fired.** On click of any acquisition CTA across the public site
(D134), before the browser follows the link — fire-and-forget, navigation never waits on
telemetry. Anonymous visitors are expected; no identify call precedes
this event.

**Payload.**

| Field       | Type                                                           | Notes                                                                                      |
| ----------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `cta`       | `'connect_gmail' \| 'open_app' \| 'see_pricing' \| 'try_demo'` | `connect_gmail` is the OAuth-start conversion; `try_demo` enters the synthetic walkthrough |
| `placement` | `'nav' \| 'hero' \| 'pricing_teaser' \| 'final' \| 'demo'`     | Positional section; `page_viewed` identifies the public route family                       |

**Retention / aggregation.** PostHog default. `connect_gmail` clicks
vs the matching `page_viewed` family give each public route's conversion
rate; filtering `page_viewed{page='landing'}` retains the original
landing-only view. Placement breakdown ranks positions within a page.

### `demo_preview_opened` / `demo_decision_confirmed` / `demo_reset`

**When fired.** The synthetic inbox simulator emits `demo_preview_opened`
when a visitor chooses a K/A/U/L verb, `demo_decision_confirmed` only after
the explicit preview confirmation, and `demo_reset` when the local walkthrough
is cleared. No Gmail data or sender identity is captured.

**Payload.** Preview/confirm carry the verb and one-based decision index;
confirm also carries the synthetic affected-message count. Reset carries only
the number of completed sample decisions.

**Retention / aggregation.** PostHog default. The preview→confirm ratio is the
demo comprehension funnel; join to `page_viewed{page='inbox_simulator'}` for
demo engagement. Never compare synthetic affected counts to production impact.

### `autopilot_paused`

**When fired.** When the user confirms the D105 master pause (after
the D226 preview modal) and the `POST /api/autopilot/pause-all`
mutation is dispatched. Fires once per confirmed pause, not per rule.

**Payload.**

| Field           | Type                                           | Notes                                                 |
| --------------- | ---------------------------------------------- | ----------------------------------------------------- |
| `duration_kind` | `'24h' \| '7d' \| 'until_resumed' \| 'custom'` | V2 only emits `until_resumed` (no timed pause UI yet) |

**Retention / aggregation.** 1y raw. Pause frequency is a trust
signal — users who pause often don't trust the rules.

### `autopilot_resumed`

**When fired.** When the user resumes a paused rule from the rules
list (`PATCH /api/autopilot/rules/:id` with `mode='observe'`). Fires
once per resumed rule.

**Payload.**

| Field     | Type                           | Notes                                                   |
| --------- | ------------------------------ | ------------------------------------------------------- |
| `trigger` | `'manual' \| 'window_expired'` | V2 only emits `manual` (paused rules never auto-resume) |

**Retention / aggregation.** 1y raw. Pairs with `autopilot_paused`
for the pause→resume gap metric.

### `autopilot_suggestion_decided`

**When fired.** When the user decides a D104 Observe-mode suggestion:
per-row Dismiss (`decision='rejected'`, `count=1`), or a confirmed
approve — approve-all / approve-selected — after the D226 preview
modal (`decision='accepted'`, `count=N`). Batch approves fire ONE
event per mutation, not per row (bounded cardinality, like
`rule_fired`).

**Payload.**

| Field             | Type                                                  | Notes                                |
| ----------------- | ----------------------------------------------------- | ------------------------------------ |
| `decision`        | `'accepted' \| 'rejected' \| 'snoozed'`               | V2 emits accepted/rejected only      |
| `suggestion_kind` | `'preset_rule' \| 'sender_policy' \| 'preset_change'` | V2 emits `preset_rule` only (D234)   |
| `count`           | `number`                                              | Suggestions covered by this decision |

**Retention / aggregation.** 1y raw. Accept rate per rule is the
"are the presets trustworthy?" metric that gates Active-mode adoption.

### `autopilot_preset_changed`

**When fired.** When a rule mutation commits from the rules list:
enable/disable toggle, threshold slider commit, or the explicit
Observe → Active switch from the day-7 banner (after its D226 preview
modal). There is no auto-promotion — `activated` is always a user act.

**Payload.**

| Field       | Type                                                            | Notes                              |
| ----------- | --------------------------------------------------------------- | ---------------------------------- |
| `preset_id` | `string`                                                        | Internal rule UUID                 |
| `action`    | `'enabled' \| 'disabled' \| 'parameter_changed' \| 'activated'` | `activated` = explicit D104 switch |

**Retention / aggregation.** 1y raw. Drives preset adoption + the
share of rules that ever reach Active mode.

### `quiet_hours_updated`

**When fired.** From the Quiet screen after
`PUT /api/mailboxes/:id/quiet-hours` succeeds (U18 — D92/D95) — i.e.
after the server confirmed the save, never optimistically. One event
per saved mailbox config.

**Payload.**

| Field              | Type      | Notes                                        |
| ------------------ | --------- | -------------------------------------------- |
| `mailbox_id`       | `string`  | Internal UUID — never the Gmail address      |
| `enabled`          | `boolean` | Config state AFTER the save                  |
| `crosses_midnight` | `boolean` | `startLocal > endLocal` (e.g. 22:00 → 06:00) |

Window times and the timezone are NOT attached — `crosses_midnight`
answers the product question (do users set overnight windows?) without
shipping per-user schedule details.

**Retention / aggregation.** PostHog default. Quiet-hours adoption
(enabled=true saves per mailbox) + the overnight-window share. The
worker-side deferral signal is the structured log line
`autopilot.action.quiet_deferred` (Cloud Run logs), not a PostHog
event.

### `pricing_plan_selected`

**When fired.** When a visitor clicks a Free, Plus, Pro, or Founding Pro
CTA on public pricing, before the lazy session probe and any OAuth/billing
navigation. This is paid/free intent, not checkout or revenue.

**Payload.** `tier` (`free|plus|pro`), `cycle` (`monthly|annual`), and
`promo` (`foundingPro|null`). No identity or email fields are attached.

**Retention / aggregation.** 2y raw. Joins consented pricing page views to
plan interest, then to `checkout_started` and terminal `billing_event` once
the server-side outcome sink is live.

### `waitlist_joined`

**When fired.** From the marketing client after `POST /api/waitlist`
returns 202 — i.e. after the server accepted the submission. The
endpoint responds identically for new and duplicate emails (no
email-exists oracle), so this event counts SUBMISSIONS, not unique
signups; the `waitlist` table is the source of truth for unique counts.

**Payload.**

| Field           | Type                                                          | Notes                                                  |
| --------------- | ------------------------------------------------------------- | ------------------------------------------------------ |
| `tier_interest` | `'free' \| 'plus' \| 'pro' \| 'team' \| 'enterprise' \| null` | D19 tier the form was attached to; null = generic form |
| `source`        | `string`                                                      | App-chosen attribution slug (`pricing`, `landing`, …)  |

The submitted email address is NEVER attached (D7 — no raw email
addresses in event payloads).

**Retention / aggregation.** 2y raw. Drives the Team-waitlist ≥ 50
build trigger (D19) and marketing-form conversion funnels.

### `followup_dismissed`

**When fired.** When the user clicks "Mark resolved" on a Followups row
(D88) and `POST /api/followups/:id/dismiss` succeeds. Fires from the FE
mutation's `onSuccess` — never on the optimistic removal alone, so a
rolled-back failure does not pollute the funnel. Idempotent replays
(flaky-network retry hitting an already-dismissed row) still fire,
flagged via `already_dismissed`.

**Payload.**

| Field               | Type                                     | Notes                                   |
| ------------------- | ---------------------------------------- | --------------------------------------- |
| `followup_id`       | `string`                                 | Internal `followup_tracker.id` UUID     |
| `priority`          | `'high' \| 'medium' \| 'low' \| 'fresh'` | D85 age bucket at dismissal time        |
| `already_dismissed` | `boolean`                                | BE idempotent-replay hint (D88 Phase-1) |

**Retention / aggregation.** 1y raw. Drives the "resolved manually vs
replied" ratio for the Followups feature; the `priority` breakdown shows
how stale rows are when users resolve them by hand.

### `screener_queue_viewed`

**When fired.** When the Screener queue (D73) renders in the `ready` or
`empty` state — once per mount, not per refetch. Under-tier visitors
(D77 Pro gate) never fire it: the upsell state renders before any
Screener query runs.

**Payload.**

| Field           | Type     | Notes                                            |
| --------------- | -------- | ------------------------------------------------ |
| `pending_count` | `number` | Pending first-time senders (the D74 badge count) |

**Retention / aggregation.** 1y raw. Sizes the typical Screener backlog
and how often Pro users open the surface relative to badge growth.

### `screener_decision_taken`

**When fired.** When a Screener decide confirm succeeds —
`POST /api/screener/decide` resolved the quarantine row and the verb
was recorded/enqueued. Fires from the FE mutation's `onSuccess`, never
on click alone (the D226 preview → confirm gap must not pollute the
funnel).

**Payload.**

| Field       | Type                                                          | Notes                                 |
| ----------- | ------------------------------------------------------------- | ------------------------------------- |
| `verb`      | `'keep' \| 'archive' \| 'unsubscribe' \| 'later' \| 'delete'` | The K/A/U/L/D decision                |
| `sender_id` | `string`                                                      | Internal `senders.id` UUID, not email |

**Retention / aggregation.** 1y raw. Drives the keep-vs-cleanup ratio
for first-time senders — the signal D75's onboarding handoff copy and
the engine's Phase-B confidence band are tuned against.

### `beta_gate_denied`

**When fired.** On mount of the public `/beta` page when the URL
carries `?reason=not_invited` — i.e. the user was 302'd there by the
OAuth callback because the private-beta invite gate (buildout F7)
denied a brand-new signup. Organic visits to `/beta` (no reason param)
do NOT fire it. The denied email is NEVER in the payload (D7/D159 — no
raw email addresses in telemetry); the audit trail with the email
lives in the `security_events` table (`signup.denied`, D181).

**Payload.**

| Field    | Type               | Notes                                       |
| -------- | ------------------ | ------------------------------------------- |
| `source` | `'oauth_callback'` | Only producer today — the callback redirect |

**Retention / aggregation.** 90 days raw. Counts denied-signup demand
while the gate is up; pairs with the `security_events` rows for the
"who to invite next" list.

### `snooze_set`

**When fired.** When the user sets or extends a sender's wake timer on
the Snoozed screen (D79/D82) and the PATCH succeeds. One event per
successful write — an idempotent no-op replay on the BE still fires
(the user made the gesture).

**Payload.**

| Field        | Type                                                                                  | Notes                                             |
| ------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `sender_id`  | `string`                                                                              | UUID                                              |
| `preset`     | `'later_today' \| 'tomorrow' \| 'weekend' \| 'next_week' \| 'next_month' \| 'custom'` | D82 preset (`custom` = date picker)               |
| `has_reason` | `boolean`                                                                             | Whether a note was attached — never the note text |

**Retention / aggregation.** PostHog default. Drives preset popularity
(do users want different D82 defaults?) and snooze adoption per cohort.

### `snooze_cleared`

**When fired.** When the user cancels a wake timer (`until: null`
PATCH succeeds) on the Snoozed screen (D80 "Cancel snooze"). Not fired
by wakes — wakes clear the timer server-side and emit no client event
beyond `wake_now_clicked`.

**Payload.**

| Field       | Type     | Notes |
| ----------- | -------- | ----- |
| `sender_id` | `string` | UUID  |

**Retention / aggregation.** PostHog default. Paired with `snooze_set`
for set-vs-abandon ratio.

### `wake_now_clicked`

**When fired.** When the user confirms the Wake-now inline confirm on
the Snoozed screen (D80) — at click time, before the queued restore
completes in the worker.

**Payload.**

| Field         | Type     | Notes                                            |
| ------------- | -------- | ------------------------------------------------ |
| `sender_id`   | `string` | UUID                                             |
| `later_count` | `number` | Mirror count at click time; `-1` = count syncing |

**Retention / aggregation.** PostHog default. Wake-now vs timer-expiry
ratio tells us whether D82's presets match real wake behavior.

### `settings_pref_changed`

**When fired.** When a user-level preference flip persists successfully
(the PATCH resolved — never on optimistic state). Two sources: the
Settings → Action preferences / Email preferences cards
(`source: 'settings'`), and the action sheet's D34 "remember this"
toggle confirming with a changed value (`source: 'action_sheet'`).

**Payload.**

| Field     | Type                                       | Notes                                               |
| --------- | ------------------------------------------ | --------------------------------------------------- |
| `pref`    | `'action_sheet_skip' \| 'email_reminders'` | Which preference flipped                            |
| `verb`    | `Verb \| null`                             | KAULD verb for `action_sheet_skip`; null otherwise  |
| `enabled` | `boolean`                                  | State AFTER the change (skip prefs: true = skipped) |
| `source`  | `'settings' \| 'action_sheet'`             | Where the flip happened                             |

**Retention / aggregation.** PostHog default. D34 adoption signal — how
many power users opt into the skip-sheet path, and from which surface.

### `data_export_requested`

**When fired.** When a Privacy & Data export download attempt reaches a
terminal client-side state — the blob saved (`success`) or the fetch /
stream failed (`failed`). One event per attempt.

**Payload.**

| Field     | Type                    | Notes                        |
| --------- | ----------------------- | ---------------------------- |
| `format`  | `'json' \| 'csv'`       | Which export artifact        |
| `outcome` | `'success' \| 'failed'` | Terminal client-side outcome |

**Retention / aggregation.** PostHog default. DPDP-export usage +
failure-rate alarm (a spike in `failed` flags a broken export stream).

### `activity_support_bundle_exported`

**When fired.** When an Activity support-bundle download reaches a terminal
client-side state: the ZIP is saved (`success`) or the request/download fails
(`failed`). One event is emitted per attempt, after the user reviews the
effective filters and privacy options.

**Payload.**

| Field                   | Type                    | Notes                                               |
| ----------------------- | ----------------------- | --------------------------------------------------- |
| `outcome`               | `'success' \| 'failed'` | Terminal client-side outcome                        |
| `full_sender_addresses` | `boolean`               | Whether the independent address opt-in was selected |
| `technical_details`     | `boolean`               | Whether the strict technical appendix was selected  |

No mailbox identifier, sender address, filter value, row count, or technical
identifier is sent to analytics.

**Retention / aggregation.** PostHog default. Measures support-bundle use,
privacy-option adoption, and client-visible export failure rate.

### `upgrade_prompt_shown`

**When fired.** When an entitlement gate (D19/D77/D81) surfaces an
upgrade affordance to the user: the global `UpgradeModal` opening on an
entitlement 402 — `FREE_CAP_REACHED`, `INBOX_LIMIT_REACHED`, or
`ACTION_TIER_REQUIRED` — routed
through the MutationCache handler (`source: 'upgrade_modal'`, U13), the
`TierGate` placeholder replacing a paid feature screen for an under-tier
workspace (`source: 'tier_gate'`, with `reason: 'feature_tier'` or
`'pro_feature'`, D68/D77),
the AccountMenu inbox-limit row replacing "Connect another"
(`source: 'account_menu'`), or the Triage empty-state free-cap nudge.
One emit per appearance, not per render. (`source: 'actions_402'` was
the pre-U13 inline prompt, retired in favor of the modal.)

**Payload.**

| Field    | Type                                                                                        | Notes                    |
| -------- | ------------------------------------------------------------------------------------------- | ------------------------ |
| `reason` | `'free_cap' \| 'inbox_limit' \| 'action_tier' \| 'feature_tier' \| 'pro_feature'`           | Which gate triggered it  |
| `source` | `'actions_402' \| 'account_menu' \| 'triage_empty_state' \| 'upgrade_modal' \| 'tier_gate'` | Surface that rendered it |

**Retention / aggregation.** PostHog default. Drives the
prompt-shown → pricing-visit → checkout free-to-paid funnel alongside
`checkout_started` and `billing_event`.

### `checkout_started`

**When fired.** On the "Continue to checkout" click in the plan-change
modal (D120, U13), immediately before `POST /api/billing/checkout` —
i.e. checkout INTENT. Payment completion is never inferred client-side;
the paid-conversion signal is the BE's webhook-driven `billing_event`
(`kind: 'subscription_created'`).

**Payload.**

| Field          | Type                     | Notes                                  |
| -------------- | ------------------------ | -------------------------------------- |
| `tier`         | `'plus' \| 'pro'`        | Purchasable target (D19)               |
| `cycle`        | `'monthly' \| 'annual'`  | Billing interval                       |
| `provider`     | `'paddle' \| 'razorpay'` | User's explicit provider choice (D117) |
| `founding_pro` | `boolean`                | Founding Pro promo claimed (D126)      |

**Retention / aggregation.** 2y raw (funnel pairs with
`billing_event`). `checkout_started` vs webhook `subscription_created`
is the checkout abandonment rate, per provider.

---

## Adding a new event

1. Append the literal to the `EventName` union in
   `packages/shared/src/observability/events.ts`.
2. Add a matching entry to `EventPayloads` declaring the payload shape.
3. Add a section to this doc with **When fired**, **Payload table**,
   and **Retention / aggregation**.
4. Verify every payload field is a scalar / enum / internal UUID. If
   you're tempted to add a freeform string field, stop and check D7.
5. Open the PR with `Closes D159` referenced if it's the first event
   in a feature; subsequent events reference the feature's D-number.
