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

### `onboarding_step_completed`

**When fired.** As soon as the user finishes a discrete onboarding step
in the D109 / D224 flow. Fires once per step per user; replays of the
flow re-emit (so the funnel reflects retries).

**Payload.**

| Field         | Type                                                                                | Notes                              |
| ------------- | ----------------------------------------------------------------------------------- | ---------------------------------- |
| `step`        | `'connect_gmail' \| 'choose_preset' \| 'sync_gate' \| 'first_triage' \| 'finished'` | Five lock-step stages              |
| `duration_ms` | `number`                                                                            | Time on the step (client-measured) |

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
