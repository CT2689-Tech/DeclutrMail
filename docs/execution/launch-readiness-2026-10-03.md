# Production launch-readiness audit — 2026-10-03

## Contract and scope

Goal: smoke the entire production account and give an evidence-based launch
recommendation. Account alias R must be visibly verified before testing. Its
current plan controls which routes can be exercised; paid-output and other-plan
behavior cannot be inferred from a gate. Onboarding/billing were previously
excluded; their inclusion is awaiting the user's launch-scope answer. No general
launch approval can silently omit them.

Root owns this audit and any reproduced bounded repairs, using the existing
isolated worktree on `codex/launch-smoke-readiness`, based on freshly fetched
main `c1b61eea6e4832e4da9571809a55d23bee71a365`. Root owns integration. No
dependency on or takeover of the independent readiness-timeout PR #836.
Optional telemetry must never affect behavior or receive mailbox content.

An end-to-end mail action requires preview, terminal provider result, persisted
Activity state, Undo/return, and restored Gmail state. A named disposable sender
and reversible-action approval are pending. Until then production tests are reads
and cancelled previews; existing synthetic CI is separate supporting evidence.
Unsubscribe, account deletion, permanent purge and new permissions are excluded
from automatic tests. Larger optional enhancements are not prerequisites solely
because they appear in the backlog.

## Release evidence

- Frontend: production deployment `dpl_8hLiscsn4LR8NUJWRhhnaCD4xtrg` READY at
  exact main `c1b61eea`, with `app.declutrmail.com` assigned and no alias error.
  Exact push CI 37143257545 and CodeQL 37143257603 pass.
- API/worker: release 37141106564 passes at API-source commit `76e1d238` (#870).
  Verified/promoted API `declutrmail-api-00498-lob`; worker
  `declutrmail-worker-00125-cv4` serves 100% and reports ready. Later main commits
  #871/#872 change only frontend reads; no newer API release is inferred.
- #869 post-merge CI 37109331698 and release 37109331733 have now passed.
- The prior goal work is classified as progress: fixes, merged source, deployment
  evidence and production disclosure/export checks. This pass starts with a newer
  release and does not use that older smoke as current release proof.

## Production coverage ledger

| Journey / boundary                   | Required proof                                                  | Current-pass state                                                                                                                                                                           |
| ------------------------------------ | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Returning sign-in / session recovery | Intended identity, same permissions, Home, revisit              | Passed: fresh renewal of the existing three Google permissions returned alias R to loaded Home                                                                                               |
| Home / navigation                    | Current tasks, historical/current scopes, no errors             | Passed: review tasks, separate history, sender navigation; no observed console errors                                                                                                        |
| Senders discovery                    | Search, filter, sort, paging/view recovery                      | Partial: empty-search recovery; stable all-senders paging 250 → 300; group expansion and sender navigation pass. Sort selection pending                                                      |
| Sender details / protection          | Freshness, counts, scope, Protected reason                      | Detail pass: current Inbox and archived counts separate from 90-day history; suggestion freshness and external-marked-read exclusion. Protection changes not executed                        |
| Archive / Delete previews            | Counts/destination/Undo; cancel leaves data intact              | Archive completed preview 8, account/destination/window/Undo shown; Delete scope/Trash/Undo shown but cancelled while preview still loading. No confirmation; detail counts remain unchanged |
| Triage Focus / List                  | Why, full identity, keyboard, selection, preview cancellation   | Both views and explanations load; 12 queued / 0 decisions. Reproduced timezone mismatch, repaired locally; production verification pending                                                   |
| Screener                             | Loaded vs pending counts, filter recovery, preview cancellation | Partial: 61 pending / 50 loaded, Protected filter has honest empty state; All loaded restores queue. Preview cancellation still pending this release                                         |
| Activity                             | Status/search/window, persistent receipts, Undo eligibility     | Partial: historical/current-window distinction and existing Undone receipt load; empty search and restoration pass. Other outcome/date filters pending                                       |
| Later                                | Current queue/recovery, scheduled return and persisted outcome  | Empty queue and active-inbox timezone pass; scheduled-return/provider test awaiting disposable sender                                                                                        |
| Autopilot                            | Rules/status/suggestions/backlog, preview, Quiet boundary       | Five inactive rules / zero suggestions; non-mutating match preview completed with actionable/checked/Protected counts, then closed. No activation or rule execution                          |
| Quiet Hours                          | Overnight/timezone and state; no accidental activation          | Read pass: off, 22:00 → 07:00 next day, account timezone, Save disabled. No preference mutation                                                                                              |
| Brief / Follow-ups                   | Eligible output or truthful plan gates                          | Plus account sees Pro gates on both routes; eligible output unverified                                                                                                                       |
| Sync                                 | Current health, freshness and completion; reconnect recovery    | Ready and periodic sync timestamp advances during audit; forced sync/reconnect failure cases unexecuted                                                                                      |
| Settings / Protected senders         | Loaded preferences, search/paging, account scope                | Preferences and inbox limit loaded; 133 Protected, no-match search/clear pass. Show more completes loading; expanded row-count proof pending. No preference/policy mutation                  |
| Privacy / exports                    | Inventory/scope, prepared outcome, actual file validation       | Inventory/scope/retention load; Senders CSV reaches prepared status. Download event did not surface; saved-file validation remains unverified                                                |
| Help / management exits              | Recovery routes and cancelled destructive confirmations         | Glossary/search/clear/recovery links pass; mailbox-management consequences inspected and Keep current setup cancels. No support message, disconnect or deletion                              |
| Consent / mailbox isolation          | Existing consent and account boundaries                         | Existing Accept all observed; shell and previews identify account R. Cross-account isolation and consent changes not executed on production                                                  |
| Narrow / keyboard / error recovery   | Usable controls, focus and truthful failures                    | Repaired synthetic Focus/List calendar boundary and 390px no-overflow pass; production current-release phone/keyboard sweep pending                                                          |
| Sentry / PostHog                     | Current failures, ingestion, exact authenticated dashboards     | Fresh encrypted Sentry read complete; PostHog/browser verification pending                                                                                                                   |
| GCP operations / notifications       | Fresh panels, ready services, actual alert receipt              | Shared authenticated URL renders fresh hour after reload; runtime freshness 1, action pending/overdue 0. Availability/latency/recovery concerns below; alert receipt still pending           |
| Onboarding / billing                 | Real onboarding; authoritative sandbox/approved live rehearsal  | Scope answer pending; previously excluded                                                                                                                                                    |

## Launch criteria and priorities

1. Complete current-release account smoke and reproduce any failure before repair.
2. Explain or repair recurring current-release Sentry fetch errors; do not mute
   them or treat an unaffected route as proof the problem is gone.
3. Prove provider outcome/restoration on approved disposable messages, plus
   worker/sync recovery and current telemetry/alert usability.
4. Verify onboarding, billing and relevant plans separately before a general
   launch recommendation. Mark missing coverage explicitly.
5. Keep full Screener browsing, richer Later receipts and visual refinements as
   enhancements unless current evidence makes one a safety/usability blocker.

No launch recommendation is established yet. Required observations and unresolved
states will be updated from current runtime evidence; green CI alone is insufficient.

## Current findings / diagnostic limits

- Read-only Sentry workflow 37155376051 succeeded at current main; collected
  21:31:09 UTC. WEB-N lifetime count487, latest Later/query TypeError18:30:38 UTC
  on63ac494a. No newer event is shown by this bounded issue read; this does not
  prove absence of errors onc1b61eea. Its latest approved frames have no usable
  source names. Two other older fetch events map to the common fetch call and
  Later-recovery / undo-in-flight callers. The production cause remains unknown.
  No issues were suppressed/resolved. Report is encrypted in GitHub and only the
  approved projection is retained locally; ephemeral private key removed.
- Vendor watchdog37138576116 failed in Update private finance report; collection
  and infrastructure publication did not fail. Its error intentionally omits
  private contents but does not identify the failing stage. Local read-only bucket
  inspection is blocked by expired gcloud reauthentication. No bucket/IAM change,
  finance-document write, or fabricated cost coverage has been performed.
- Sender empty-search recovery clears all filters, intentionally switching from
  active-only to all senders. An initial pagination control observation raced that
  query change; inspect settled scope before assigning a product defect. The
  stable all-senders Load more completes from 250 to 300. The initial stale-control automation deadline is not assigned as a product defect.

## Reproduced repair and verification

- Triage Focus Why used UTC by default while expanded List used the account's
  named timezone. The same sender therefore read today versus 1d around a date
  boundary. FocusStack now forwards the existing non-fetching account timezone
  through the pure FocusCard to the shared explanation block. Demo cards keep
  UTC. No timestamp policy, mailbox data, action lifecycle or scope changed.
- Calendar-boundary regression failed before repair with today instead of 1d;
  104 affected Focus/List/queue/stale-refresh tests pass after repair. Independent
  reviewer found no blockers and separately passed 47 tests including shared
  auth-query observers. Full typecheck/lint pass (six existing lint warnings);
  web production build, 51 route bundle budgets and public prerender checks pass.
- Isolated synthetic PostgreSQL/Redis/API/web stack: existing Playwright Keep
  journey passes 1/1, including preview cancellation, keyboard identity disclosure,
  durable activity/outbox and reload. This does not prove provider restoration.
  Manual browser boundary case shows 1d in both repaired views, zero observed
  console errors, meaningful Home navigation and no horizontal overflow at390px.
  Browser evidence is retained privately outside Git. Production account was
  only read, with previews cancelled and URL/view state restored; no Gmail action,
  rule activation, saved preference or protection mutation by this audit.
- Integration: local repair reviewed and validated; PR/merge/deployment not yet
  established. Production timezone behavior still reflects the old release.

## Fresh operations concerns

The exact shared authenticated dashboard was reloaded and rendered the current
20:46–21:46 UTC hour. Runtime collection freshness shows observations, while
cleanup pending/overdue and Gmail push backlog read zero. Missing terminal-latency
series with no recent terminal cohort are unavailable, not evidence of failure.

- API availability chart ranges roughly50.24–100%; latency reaches10.416s in
  this window. These are dashboard observations requiring regional/check and
  revision diagnosis; do not convert them into a current outage or root cause.
- Recovery logs show two older mailbox failures (669 and912 hours), including
  invalid grant, transient and rate-limit classifications. They are distinct
  from account R's Ready state; aggregate recovery health remains unresolved.
- The guide defines cost-availability encoding: 1 means available and 0 means
  unavailable. It does not establish how many vendors currently have measured
  costs; the wording could be clearer.
  The failed private-finance stage and unconnected cost sources remain separate.
- PostHog exact insight URL still requires browser sign-in; connector ingestion
  evidence is not proof the intended account can use that dashboard.

Launch recommendation remains withheld. Prioritize production recovery/availability
diagnosis, provider outcome and restoration proof, telemetry/alert usability, and
required plan/onboarding/billing coverage before optional visual or feature work.
