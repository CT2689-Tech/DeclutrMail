# User journey review and repair — October 10, 2026

## Scope and flow contract

Reviewed all ten journeys in the supplied `user-journeys-oct10.md` against freshly
fetched main `56e53ab78920f70ecd39ecff178d2cf1b22e121d`, scoped production aggregates,
and the app in Codex's built-in browser. The attachment is evidence and proposals;
its historical read-only scope does not override the requested review and fixes.

The implemented slice makes entry and recovery consistent: public entry or an
expired session → permission/sign-in screen → validated OAuth destination →
unfinished setup when required → original app context. Account controls remain
available while Gmail scans. A feature upgrade retains its originating route and
query, waits for authoritative paid-subscription confirmation, then returns to work.

Ownership: this chat is integration owner for auth destination parsing, onboarding
gates, public entry, and upgrade navigation. Shared contract:
`packages/shared/src/contracts/app-navigation.ts`. No other open feature PR overlapped
at discovery; #895 was the only open PR. #916 had already merged. No prerequisite PR. Subsequent discovery found #918 (billing/deletion safety) and #919 (billing copy) in separate chats. Shared-file overlap is limited to Billing screen tests and the Upgrade modal; integrate each owner’s changes if they reach main first.
The existing isolated a4ca worktree owns branch `codex/user-journey-recovery`.

Outcomes are local/source-verified until the release is actually serving. Production
reads and browser inspection did not mutate mail, billing, accounts or settings.
Synthetic fixtures are the mutation boundary. Real OAuth grants, provider payments,
Gmail mutations, production deletion and email sending are outside verification.

## Corrections to the supplied report

- #916 merged at 01:00:04 PDT on October 10. Its mobile navigation is in current
  main. It also adds Home workflow reads and a ready/unopened Brief signal, so
  “no Brief discovery surface” is partly stale even though email delivery is absent.
- Failed first scans already offer **Disconnect Gmail** and **Sign out**. The genuine
  missing escape is Settings, export/deletion controls, Billing and support.
- Initial sync already uses bounded worker retries/backoff. The missing flow is
  recovery after terminal exhaustion, not the complete absence of automatic retries.
- A login creates a session; a return visit need not create a login. Session counts
  do not prove every visit saw Google consent. Actual OAuth starts force consent.
- Triage's empty state already explains that new decisions appear when senders send again.
- Checkout close intentionally retains an unresolved intent because a delayed provider
  payment may settle. Releasing it immediately would create a double-charge risk.
- Historical OAuth failures remain evidence. #909 isolates per-flow cookies and
  adds correlation, but that repair is not a reason to erase older failures or claim
  the complete real-browser OAuth matrix passed.

## Current production observations

Read-only aggregate query on October 10 confirmed two active mailboxes owned by
not-onboarded users remain failed: one `RateLimitError`, one `TransientError`.
Six active mailboxes belong to onboarded users and are ready. No addresses or
user identifiers were returned.

Since October 7 UTC: five `oauth.start` events, five successful login events,
one `missing_state_cookie` failure, latest failure October 8 at 01:18:32 UTC.
These small aggregate counts are not a paired start→callback success rate.
Brief runs: 135 generated, zero email sent, five opened. They establish a delivery
gap, not that users have no interest in Brief.

Cloud Run read at 08:05:29 UTC: API `declutrmail-api-00559-tet` and worker
`declutrmail-worker-00144-gbs`, each at 100% serving traffic. This observation is
separate from the new source and does not claim the repairs are deployed.
The existing signed-in browser account was observed as alias **live-A**; a visit
to `app.declutrmail.com/` rendered marketing. No real mailbox content or screenshots
are stored in this report.

## Findings repaired

| Journey / finding                         | Before                                                                                 | After                                                                                                                                                                  |
| ----------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1, 7, 10: first-sync account trap         | Every app route redirected unfinished users to onboarding                              | Exact user-scoped Settings, Privacy, Help and Billing routes remain reachable; sender-policy settings remain gated                                                     |
| 1, 10: scan recovery discovery            | Scan screen offered retry/disconnect/logout without account/help destinations          | Account, Billing and help links appear during scanning, terminal failures and authenticated read failures                                                              |
| 2, 4, 9: deep links lost on expired login | Terminal 401 started Google directly, then landed on Home                              | Returning sign-in keeps known local app path/query and reviewed Settings anchors through start, callback and error exits                                               |
| 1, 2, 5: onboarding dropped context       | Gate and completion accepted billing intent only or discarded the current route        | Shared validation preserves a destination and closed OAuth result; one-shot results are stripped from the eventual destination to prevent replay                       |
| 2: unfinished returning OAuth landing     | Returning callback sent users to Home before the gate bounced them                     | Real onboarding completion state sends unfinished returning users directly to onboarding; account recovery destinations bypass it                                      |
| 1: first completion landing               | First review ended on the daily Home scoreboard                                        | First completion opens Senders, whose default ordering is most received first; completed return visits retain Home                                                     |
| 3: signed-in public root friction         | Marketing offered Sign in and Start free to an existing session                        | Desktop/mobile header offers Open DeclutrMail from cookie presence as a hint; app-host root redirects to Home or sign-in, with authentication still checked by the app |
| 3, 10: typed URLs and 404                 | `/login`, `/signup`, `/dashboard`, `/app` were dead ends; authed 404 pointed to Triage | Known aliases redirect; authed 404 points to Home                                                                                                                      |
| 5, 8: wrong multi-inbox upgrade           | “Connect another” opened unspecified Billing, where Plus still allows one inbox        | CTA selects Pro monthly and carries the originating feature context                                                                                                    |
| 5: inconsistent upgrade routes            | Triage and compare links left the app for marketing Pricing                            | Feature gates, 402 modal and Triage nudges use in-app Billing; Free→Plus and Plus→Pro are preserved                                                                    |
| 5: post-purchase dead end                 | Webhook-confirmed upgrade left the user on Billing                                     | Confirmed upgrades return to the validated originating route/query; pending, close, unknown and complimentary-mismatch states retain existing locks                    |
| 2, 7: returning and logout copy           | Returning visitors saw first-connect instructions; logout opened marketing             | Welcome back / signed-out variants retain permission disclosure and a direct return action; intentional logout reserves its destination before cache-clearing 401s     |

These are improvements to complete journeys, not a claim that every report item was
a launch blocker. The redirect allowlist changes destinations only, not authorization,
Gmail scopes, token/cookie security, payment state or action preview/Undo behavior.

## Remaining improvements, ranked

| Priority          | Opportunity                                     | Current evidence and next useful slice                                                                                                                                                                                                                  |
| ----------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| High              | Terminal first-sync recovery                    | Two accounts still failed after existing bounded retries. Implement classified delayed recovery and clear retry scheduling, with rate limits respected; never requeue invalid grants indefinitely. Existing failures were not reset during this review. |
| High              | Deletion and subscription lifecycle             | Account deletion service has no provider-subscription cancellation path. Billing/account deletion is being addressed separately by PR #918; its merge/deployment/production verification state must be read independently.                              |
| High              | Reconnect continuity                            | `SyncService.markConnected` queues unhealthy ready mailboxes; `markQueued` clears their cursor. Preserve a valid history cursor, fall back on Gmail history expiry, and let onboarded users continue during refresh.                                    |
| High              | Payment attention outside Billing               | Past-due state remains visible primarily on Billing. Add a workspace banner with a server-proven deadline and billing lifecycle notices; do not infer deadlines from browser time.                                                                      |
| Medium            | Mailbox-specific email entry                    | Sync-ready/reminder templates still point to Triage without carrying the mailbox. Add an owned mailbox target, switch scope deliberately, and preserve it through login. Account-wide lapse counts must not claim to describe the active mailbox.       |
| Medium            | Returning Home value                            | Home has current review tasks and #916 workflow signals, but no defined “since last visit” delta. Specify per-mailbox visit boundary and source fields; then show changes and the existing server-provided quota without inventing counts.              |
| Medium            | Brief delivery                                  | In-app ready discovery now exists; zero delivered emails remains real. A morning email needs an explicit opt-in, processor/disclosure review and delivery lifecycle, or strengthen the in-app ritual instead.                                           |
| Medium            | Reconsent architecture                          | Actual OAuth login forces consent. Separate sign-in from grant recovery only with scope/token-preservation tests across revoked and secondary accounts; do not simply remove the prompt and assume a refresh token arrives.                             |
| Medium            | Razorpay loader failure                         | Hosted fallback still strands users. Replace it with recoverable rail selection / retry in a separate sandbox-checkout slice.                                                                                                                           |
| Small             | Home retry                                      | Home's failed-scan state still sends users to Settings. Reuse row-scoped retry and classified error/reconnect controls directly on Home.                                                                                                                |
| Product follow-up | First-backlog framing                           | The first landing now reaches Senders. A one-time biggest-backlog header and suggestion can follow using exact eligible counts; never preconfirm a mail-changing action.                                                                                |
| Product follow-up | Partial preview, unified hosts, checkout timing | Account routes are unlocked, while first-run mailbox routes stay gated. Partial preview, cross-host redirects for all app paths and anonymous checkout timing need separate acceptance criteria rather than being bundled into authentication repair.   |

## Verification

Verification completed locally on October 10; required CI remains authoritative for merge.

- Shared navigation, OAuth start/callback/error exits, account-gate, sign-in, public
  header, billing context/confirmation and failed-scan component regressions.
- Negative controls: three expired-session destinations and billing origin fail against old code; all four account-control gate cases fail once the actual onboarding read has settled.
- Full workspace typecheck/lint pass (six pre-existing unused-disable warnings); production web build and prerender checks pass. Bundle checks found new navigation imports on the initial load; the fix separates link formatting from server parsing and defers boundary validation to the transition that needs it. Plain sign-in/onboarding remain available if a navigation helper chunk cannot load. The final measured build is 269.9→270.1 kB on Billing. Its route-only ceiling increases 270→270.5 kB for the confirmed return flow; every public and other app route keeps its existing ceiling. Final local readback passes all 51 measured routes plus the declared redirect; the budget verifier’s 17 tests also pass.
- Built-in-browser synthetic smoke passed: Free Brief→Billing selects Pro monthly with its origin; failed first scan→Settings/help; Senders stays gated and retains its destination; ready→finish persists onboarding and opens Senders; signed-out recovery retains Settings query/anchor; logout shows its confirmation. HTTP readbacks verify all four aliases (308), and app-host root (307) for no cookie, access-cookie presence and refresh-cookie presence.
- Regression coverage preserves the original 715-line onboarding suite. Real completion-hook cache write-through and missing navigation-chunk fallbacks are tested (151 tests across the final billing/client/gate regression suites). Four isolated E2E journeys are added to the required CI lane, each with a separate server session so logout cannot revoke the suite session; local browser checks use Codex IAB, with no Chrome launch.
- Independent journey review plus applicable architecture/design gate review.

Release state: source changes under review; no deployment or production verification claimed. Required CI results will be recorded in the PR.

Historical validation failures are retained: initial CI had three outdated test expectations/mocks, an added logout test revoked the shared suite session, and initial bundle checks exceeded budgets. These prompted specific fixes; a later green run is proof only for its exact candidate. Assertions were retained. Shared imports were reduced to restore all public budgets; Billing alone receives the documented 0.5 kB feature allowance.
