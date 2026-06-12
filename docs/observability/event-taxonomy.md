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

**When fired.** On `POST /api/sync/start` accept, after the worker has
enqueued the first batch. Also emitted by the Pub/Sub webhook handler
when a `historyId` advance enqueues a delta-sync.

**Payload.**

| Field        | Type                                          | Notes              |
| ------------ | --------------------------------------------- | ------------------ |
| `sync_id`    | `string`                                      | UUID               |
| `mailbox_id` | `string`                                      | UUID               |
| `trigger`    | `'initial' \| 'manual' \| 'pubsub' \| 'cron'` | What kicked it off |

**Retention / aggregation.** 90 days for raw, rolled up into the
"syncs per mailbox per day" cohort weekly.

### `sync_completed`

**When fired.** When the sync state machine reaches the terminal state
(`success` or `failed`), or when a partial-completion deadline elapses
(`partial`). Per D224, this matches the real `current_stage` reaching
the end — not a fake-progress trigger.

**Payload.**

| Field              | Type                                 | Notes                                 |
| ------------------ | ------------------------------------ | ------------------------------------- |
| `sync_id`          | `string`                             | UUID — matches `sync_started.sync_id` |
| `mailbox_id`       | `string`                             | UUID                                  |
| `messages_indexed` | `number`                             | Final count                           |
| `duration_ms`      | `number`                             | Wall-clock from start to terminal     |
| `outcome`          | `'success' \| 'partial' \| 'failed'` | Terminal state                        |

**Retention / aggregation.** 90 days raw. Powers sync-success-rate and
sync-duration-p50/p95 dashboards.

### `triage_action_taken`

**When fired.** After the preview-confirmed mutation succeeds and the
undo token is issued — per D226's strict order (sheet → preview →
mutation → undo). NEVER fired optimistically.

**Payload.**

| Field               | Type                                              | Notes                       |
| ------------------- | ------------------------------------------------- | --------------------------- |
| `verb`              | `'keep' \| 'archive' \| 'unsubscribe' \| 'later'` | Canonical K/A/U/L (D227)    |
| `sender_id`         | `string`                                          | UUID                        |
| `affected_messages` | `number`                                          | Count covered by the action |
| `source`            | `'sheet' \| 'inline' \| 'shortcut'`               | UI entry point              |

**Retention / aggregation.** 1y raw. Powers the "triage actions per
user per week" cohort and the K/A/U/L mix dashboard.

### `undo_clicked`

**When fired.** When the user clicks the undo affordance on a toast or
the activity log entry, and the undo succeeds server-side.

**Payload.**

| Field       | Type                                              | Notes                              |
| ----------- | ------------------------------------------------- | ---------------------------------- |
| `action_id` | `string`                                          | UUID — matches the original action |
| `verb`      | `'keep' \| 'archive' \| 'unsubscribe' \| 'later'` | The action being undone            |
| `age_ms`    | `number`                                          | Time from action to undo           |

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

**When fired.** Once per mount of an instrumented page. Currently
emitted by the marketing landing (`page: 'landing'`, D134) from its
always-mounted nav island; app surfaces adopt the same event as they
get instrumented (the `page` union in `events.ts` already enumerates
them).

**Payload.**

| Field        | Type                                                                                                                                         | Notes                                              |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `page`       | `'landing' \| 'senders' \| 'sender_detail' \| 'activity' \| 'brief' \| 'autopilot' \| 'triage' \| 'onboarding' \| 'settings' \| 'mailboxes'` | Closed union                                       |
| `mailbox_id` | `string \| null`                                                                                                                             | UUID; `null` on public pages (landing has no auth) |

**Retention / aggregation.** PostHog default. Top of the
landing → OAuth → onboarding funnel insight.

### `landing_cta_clicked`

**When fired.** On click of any landing-page CTA (D134), before the
browser follows the link — fire-and-forget, navigation never waits on
telemetry. Anonymous visitors are expected; no identify call precedes
this event.

**Payload.**

| Field       | Type                                             | Notes                                         |
| ----------- | ------------------------------------------------ | --------------------------------------------- |
| `cta`       | `'connect_gmail' \| 'open_app' \| 'see_pricing'` | `connect_gmail` is the OAuth-start conversion |
| `placement` | `'nav' \| 'hero' \| 'pricing_teaser' \| 'final'` | Where on the page                             |

**Retention / aggregation.** PostHog default. `connect_gmail` clicks
vs `page_viewed{page='landing'}` is the landing conversion rate;
placement breakdown ranks the sections.

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
