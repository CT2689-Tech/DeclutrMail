# User journey metrics contract

Use consent-gated PostHog for product interaction questions and first-party
operational state for Gmail outcomes. An SDK failure must never block product work.
No message bodies, snippets, subjects, recipients, addresses, search strings or
provider error text belong in event properties. Prefer enums, counts and durations.

## Existing signals and useful next measurements

| Journey               | Existing signal                                                                 | Useful metric and denominator                                                                                            | Gap / source of truth                                                            |
| --------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Enter a surface       | `$pageview`, custom `page_viewed`, `sender_detail_opened`                       | Distinct consenting people visiting each surface / distinct consenting production visitors                               | Pick one page-view convention; do not sum automatic and custom events            |
| Preview and decide    | `action_preview_viewed`, `action_confirmed` with journey/verb                   | Ordered person-level preview → accepted funnel for the same preview-bearing verb and journey, explicit window            | Keep may skip preview; server-accepted is not Gmail-completed                    |
| Finish cleanup        | Action job and lifecycle records                                                | Terminal outcomes / accepted operations; affected-message count; p50/p95 acceptance-to-terminal time; oldest pending age | Operational aggregate; terminal/partial/retry semantics must match durable state |
| Recover a change      | `undo_clicked`, Activity Undo records                                           | Restored / eligible Undo requests; failures by bounded reason; restoration latency                                       | Never label click rate “Undo success”; do not treat Undo use alone as distrust   |
| Autopilot             | `autopilot_preset_changed`, `autopilot_resumed`, `autopilot_suggestion_decided` | Successfully saved settings, approved/rejected suggestions, pending age, completed automatic actions                     | Browser changes emit after success; worker/rule-match records prove execution    |
| Quiet Hours           | `quiet_hours_updated`, mailbox schedule                                         | Successful saves; actions correctly held/released relative to local schedule                                             | Worker data needed for hold/release correctness, including timezone/DST          |
| Brief                 | `brief_refresh_clicked`, `brief_cta_clicked`, preview/confirmation              | Observed visits → useful action; generated-at freshness; actual completed noise cleanup                                  | Refresh click is intent; yesterday's count differs from current Inbox preview    |
| Follow-ups            | `followup_dismissed`                                                            | Successful resolves / observed visitors; awaiting age; last evaluation freshness                                         | Resolution hides a DeclutrMail record, not proof of an email reply               |
| Later                 | `snooze_set`, `wake_now_clicked`, durable snooze/action records                 | Scheduled → actually returned; overdue count, return latency, failed returns                                             | Timer and Gmail worker are authoritative; click is not completion                |
| Sync                  | `sync_started`, `sync_completed`, sync job records                              | First-party completion/error rate, queue age and last successful sync                                                    | Browser observations can miss closed tabs, failures and non-consenting users     |
| Performance           | `web_vital_reported`                                                            | p75 by surface/metric with n, poor count, release/device and latest event                                                | FCP/LCP/INP/TTFB milliseconds; CLS unitless; low samples/QA are explicit         |
| Settings/privacy/help | `settings_pref_changed`, `data_export_requested`, consent state                 | Committed preference changes; export request → successful delivery if implemented                                        | No sensitive payloads; support submission not tested by sending real messages    |

## Instrumentation rules

1. Emit a successful mutation at the hook-level committed result so navigation
   does not suppress it. Use response counts when they differ from selection.
2. Count previews after successful data loading, once per opening and verb.
   Exclude cached data during a required live refetch and failed previews. A
   valid zero-count preview is still a view, not an eligible action.
3. Keep intent, accepted, terminal and recovery events distinct. Proposed terminal
   events require a typed schema and an honest observation boundary; until then,
   use operational SQL/metrics rather than implying nonexistent PostHog coverage.
4. Use ordered funnels with explicit person/verb/journey/window matching. Raw
   event ratios are not conversion rates. Cross-tab and consent boundaries remain
   limitations even with matching properties.
5. Exclude localhost and explicitly identified QA from customer adoption reports.
   Do not silently discard QA from operational diagnostics. Maintain the project
   test-account definition; never infer customer status from mailbox contents.
6. Consent-off must produce no PostHog events; withdrawal clears its identifier.
   This browser-local consent cannot authorize a server emitter. Test absent keys,
   blocked SDK, slow loading and withdrawn consent without changing product behavior.
7. Record source, timeframe, sample size, plan/environment coverage, query version
   and freshness alongside every decision-making dashboard. A successful API
   creation is insufficient: open the exact shared URL and check rendered data.

## Prioritized delivery

- This audit ships loaded-preview coverage and successful Autopilot mutation
  timing, and corrects taxonomy/dashboard descriptions.
- Next: operational accepted/terminal/Undo quality dashboard, with exact lifecycle
  denominators; production Senders performance investigation; canonical page-view
  and internal-QA definitions. These are distinct follow-ups, not claimed shipped.
- Later: customer-facing freshness and outcome receipts, queue discovery controls,
  and selection eligibility counts. Validate usefulness before adding more events.

PostHog references: [ordered funnels](https://posthog.com/docs/product-analytics/funnels#how-to-create-a-funnel)
and [internal/test traffic](https://posthog.com/docs/data/test-accounts).
