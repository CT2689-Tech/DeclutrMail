# User journeys and telemetry audit — 2 October 2026

## Scope and evidence

Returning-user journeys, excluding onboarding and billing. Account R was verified in
Chrome Incognito before production testing. It is an existing complimentary Plus
account; this is **not** evidence for first-time onboarding or a Free account.
Private mailbox content and addresses are intentionally omitted from this report.

Production exploration in this pass used navigation, filters, loaded previews and
Cancel. No additional Gmail mutations, rule activation, privacy changes, support
messages, disconnects or account deletion were performed. The earlier sender audit
completed Archive → Activity → Undo and checked Gmail restoration; see PR #851.

An isolated local API/web/Postgres/Redis stack used synthetic fixtures and a Pro
account. It had no Gmail worker, real provider credentials or PostHog collector.
Local saves prove application persistence, not Gmail delivery or worker execution.
Failure and concurrency cases were exercised through component/mutation tests.

## Changes prepared in this PR

| Priority | Before                                                                                                                                           | After                                                                                                      | Evidence                                                                                             |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| P1       | A failed Follow-up dismissal could restore an old mailbox's entire cached list, or resurrect a sibling already dismissed                         | Reconcile the active list from the server; a failed read has an explicit retry path                        | Two concurrency/account-switch tests and failed-write/failed-refetch recovery test                   |
| P1       | Autopilot changes and rejected suggestions could be counted before the server accepted them; approval telemetry could disappear after navigation | Emit successful mutation events from hook-level success handlers; use server-approved counts               | Rejected writes emit no success; successful writes emit once; unmount tests preserve approval counts |
| P2       | Preview telemetry omitted Senders, Screener, Brief and batch Triage; the single Triage lifetime set also suppressed legitimate reopenings        | Count each loaded opening/action once, exclude loading/error/stale refetch, allow reopening                | Hook and screen integration tests, including cached-preview failure                                  |
| P2       | Autopilot's affected account was hidden in collapsed Details                                                                                     | Account appears beside the decision without expanding Details                                              | Visibility test and local confirmation inspection                                                    |
| P2       | Gmail preview snippets showed encoded punctuation/markup                                                                                         | Decode entities once and render only React text; optional decoder chunk preserves original text on failure | Synthetic encoded markup creates no image/script elements; chunk-failure test; bundle budgets        |
| P2       | Taxonomy implied reserved events were collected and allowed success/intent confusion                                                             | Document actual emitters, reserved names, preview eligibility and accepted-versus-completed semantics      | Source audit plus live PostHog schema/aggregates                                                     |

PR #851 separately contains the prior manual-cleanup fixes: visible account in
previews, safe focus/Cancel behavior, Triage/Screener invalidation after Activity
Undo, unknown unsubscribe status and copy/filter corrections. Neither PR is proof
of deployment. This PR has no code dependency on #851; shared files may need a
small integration resolution. The current task owner is the integration owner.

## Journey coverage

| Journey                                        | Production evidence                                                                                           | Additional verification / limits                                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Overview → recommended next step               | Returning-user totals, review links and tier gates                                                            | Historical totals distinguish completed work; no new-user claim                                      |
| Senders → detail → action → Activity → Undo    | Earlier audit verified real Archive and Gmail restoration; snippets reproduced                                | Preview events, malformed encoded text, failed preview and reopen tests                              |
| Triage → preview → cancel                      | Focus view, live Inbox count, loading guard and Cancel                                                        | Single/batch loading, cached refetch failure and action tests                                        |
| Screener → expand → decision preview           | Loaded queue, unavailable unsubscribe explanation, Archive preview                                            | Decision/preview tests; no new production decision committed                                         |
| Autopilot → match preview → enable/watch/pause | Inactive rules and zero-match explanation inspected without enabling                                          | Synthetic rule saves, account visibility and rejected-write/navigation tests; workers not run        |
| Quiet Hours → save                             | Off state, active account, cross-midnight timezone explanation                                                | Synthetic enable/save/reload/disable; no real schedule changed                                       |
| Daily Brief → noise selection → preview        | Plus account shows Pro gate                                                                                   | Synthetic yesterday count 1 → current Inbox preview 2 → Cancel; component tests cover actions        |
| Follow-ups → resolve → reload                  | Plus account shows Pro gate                                                                                   | Synthetic resolve persisted as `dismissed`; failed writes, failed reads and mailbox switching tested |
| Later → return/recovery                        | Empty state, timezone and Senders path                                                                        | Existing snoozed tests; scheduled Gmail return not exercised without a worker                        |
| Activity → filters → empty → clear             | Failed filter produced honest empty state; clear restored history; separate date windows and undone exclusion | Prior Undo audit; lifecycle tests; no export shared                                                  |
| Settings → Protected senders                   | Correct account, protection reasons, all-filter link and pagination                                           | Production protection state left intact                                                              |
| Privacy & data                                 | Data inventory, retention, export scope, account identity, Essential-only analytics selection                 | Consent withdrawal/wire tests; no permanent deletion/disconnect or sensitive export                  |
| Help → glossary search → recovery              | Search for Undo surfaced recovery definitions and Activity route                                              | Support form inspected, no message sent                                                              |

This matrix is not an assertion that every device, provider error or long-running
background outcome passed. Provider completion, timed returns, large pending-rule
queues, additional accounts and production verification after deployment remain
separate evidence requirements.

## What should be tackled next

1. **P1: investigate Senders performance.** Production-host Web Vitals over the
   preceding 30 days showed LCP p75 **8,036 ms**, 26 samples, 13 rated poor. FCP p75
   was 2,720 ms across 47 samples. These include internal QA and mixed releases;
   reproduce on a controlled device/network before choosing a fix. Separate
   server/query time, route JS, rendering and image work. Do not raise bundle
   budgets to hide a regression.
2. **P1: measure outcomes, not only acceptance.** Define accepted → completed /
   failed / partial / overdue and Undo requested → restored / failed from the
   first-party action lifecycle. Show duration and failure reason using bounded
   categories. `action_confirmed` is not proof that Gmail changed. `undo_clicked`
   is not an Undo success. Browser sync events are not a backend health check.
3. **P2: make analytics comparable.** Choose a canonical page-view denominator;
   `$pageview` and custom `page_viewed` coexist and have different coverage (Home
   has no custom emitter). Segment production/QA, route, plan and release. Keep
   explicit sample sizes and freshness. Never infer lack of usage from an absent
   event without verifying the producer and consent.
4. **P2: make large queues easier to finish.** Explore search/filter/sort for
   Autopilot pending suggestions, with server-wide counts and clear loaded-versus-
   total scope. Current rules filters do not solve pending-suggestion discovery.
   Confirm expected queue sizes before designing another control surface.
5. **P2: explain eligibility before committing.** Age-bucket counts and selected /
   eligible / protected / already-cleared counts would reduce trial-and-error
   previewing. Reuse server preview results; avoid one request per row. Preserve
   the live confirmation count as the final authority.
6. **P2: show useful outcome receipts.** Later return success/failure and actual
   returned count; Autopilot last successful run, pending age and reason for a
   skip; Follow-ups last checked time. Surface only persisted facts, with recovery
   actions. Never manufacture time saved or exact Gmail storage savings.
7. **Product decision:** when a search has no results because filters exclude a
   matching sender, prefer an explicit “Search all senders” escape hatch over
   silently resetting filters. This remains a design choice, not an implemented
   behavior change.

## PostHog changes and findings

Project 456795, UTC. Read-only schema and aggregate queries were checked on
2026-10-02; rolling windows naturally change after this snapshot.

- Corrected **Active users — daily trend** description: its query counts distinct
  tracked people with any event, not necessarily active cleanup users.
- Renamed/described **Core loop — observed decisions and interactions**: opening
  sender detail is not an unsubscribe, and Undo clicks do not establish success.
  Both existing queries and dashboard placements were preserved.
- Added [Journey performance — production p75 and sample size](https://us.posthog.com/project/456795/insights/1lr26WZI)
  to [Daily Pulse](https://us.posthog.com/project/456795/dashboard/1935295). Rolling
  30-day production-host SQL includes at least 10 samples per surface/metric,
  p75, poor count and latest event. It deliberately labels internal QA and mixed
  releases; it is a diagnostic, not a customer benchmark. The exact insight URL
  was opened through the existing authenticated PostHog account: all 16 rows
  rendered, including Senders LCP 8,036 ms / 26 samples and the expected latest
  event age (13 hours). The exact Daily Pulse URL was also opened; the
  corrected descriptions and new performance tile rendered without errors.
  Its table showed the same 16 rows and freshness as the standalone insight.
- Production-host preview totals: Archive 2, Delete 5, Later 2, Unsubscribe 2.
  Confirmation totals: Archive 1, Delete 5, Keep 4, Unsubscribe 3. **Do not divide
  these totals into a conversion rate.** Keep can skip preview, events span
  releases and consent sessions, and these are unpaired counts.
- `rule_fired` and `unsubscribe_attempted` are reserved names without a current
  PostHog producer. Operational lifecycle/rule-match records remain authoritative.
- No replay, autocapture, consent bypass, server PostHog emitter or mailbox content
  properties were enabled. Local synthetic QA did not send production analytics.

Detailed recommended metrics and their denominators are in
[the journey metrics contract](../observability/user-journey-metrics.md).

## Verification

- 932 tests across 58 affected suites passed.
- Negative control: reverting the fixes made 15 assertions fail in six suites;
  implementation restored and the full affected selection passed.
- Workspace typecheck and lint passed; seven pre-existing lint warnings remain.
- Production web build passed; all 51 route bundle budgets and 45 static
  prerender checks passed. The decoder stays outside initial route JS.
- Storybook production build passed.
- Independent review covered design-system, flow completeness, telemetry privacy,
  failure behavior and TypeScript changes. Final decoder/report review recorded in
  the PR handoff.
- Desktop inspector and 390px sender-detail checks showed decoded snippet text,
  no injected images, and no horizontal overflow. A stale dev chunk error after
  replacing the isolated source snapshot cleared on reload; subsequent checks
  had no new console errors.
- Browser checks use the production and isolated environments described above;
  CI browser/accessibility checks are an additional gate, not replaced by unit tests.

No merge, queue or production deployment was performed. Code changes must be
production-verified after release before calling these live fixes.
