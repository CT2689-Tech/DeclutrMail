# Admin onboarding and reconnect audit

## Scope and flow contract

Owner and integration: the current production-readiness chat. This isolated
`codex/admin-onboarding-audit` worktree is based on `origin/main` at
`acc9ae31`. It owns the triage read-time explanation guard, its focused tests,
and this record. There is no code dependency on another open PR.

The requested story was a production first connection with the DeclutrMail
administrator account: sign in, grant the existing Gmail permission, wait for
sync to reach a terminal state, review the first queue, verify settings and
activity, sign out, and return. Production actions were limited to OAuth
connection, metadata sync, and read-only navigation. No cleanup action, rule,
email send, unsubscribe, plan/payment change, mailbox reset, or deletion was
performed. Deletion and expiry verification remain explicitly pending.

A true fresh user should enter the promise and connect steps, see honest sync
progress or recovery, reach the first-review handoff only after readiness, and
retain completed onboarding on revisit. An existing onboarded user should
return to the application, preserve the active mailbox and queue, and receive
truthful current statistics while any background rescore completes. The active
identity must be visible before testing; provider completion and persisted
application state are the terminal evidence.

## Production evidence

The built-in browser visibly confirmed the intended administrator identity
before and after Google consent. Consent used the repository's existing
`gmail.modify` scope. The callback reached Home, the mailbox became Active and
Ready, an explicit Gmail refresh completed as "Inbox up to date", Triage loaded
ten review rows, Settings showed the intended active mailbox and Pro plan, and
Activity truthfully showed no recent actions. Sign-out and a return sign-in
preserved the ready queue and refreshed sync timestamp. A phone-width return
view used the collapsed navigation without horizontal overflow or blocked
content.

Production data established that this was a reconnect rather than first-run
onboarding. The user, workspace and mailbox were created and onboarded on
2026-08-16; the original successful sync indexed 525 messages and 42 senders.
The 2026-10-07 run refreshed the provider connection and completed another
sync. No production rows were reset or deleted to manufacture a first-user
state.

The repository's synthetic onboarding suites cover pre-auth entry, OAuth
result recovery, authed resume, sync gating, preset and first-review handoff,
strict completion routing, inactive mailbox recovery, trusted destinations,
and return visits. These are local contract results, not a claim that a fresh
production account completed the flow.

## Findings and disposition

### Fixed: stale explanation invented a measured engagement rate

Severity P2. On the first expanded Triage row, live statistics correctly showed
no mail in the last 90 days and an unknown marked-read rate, while older stored
LLM prose briefly claimed a 0% read rate. The background explanation refresh
later replaced it, but the intermediate contradiction was user-visible.

The Triage queue and Sender Detail now check stored LLM prose against their
current denominator through one pure helper. If current mail supplies no
measurable read rate, prose that states a numeric read/open percentage is
replaced at read time with an explicit unknown-state sentence. Valid no-activity
prose and real measured 0% values remain unchanged. No stored decision, verdict,
confidence, Gmail data, provider state, or LLM policy changes.

### Deferred: repeat sign-in forces Google consent

Priority P2 product/architecture follow-up. A normal sign-out and return login
again opened Google's permission screen. Source confirms that the OAuth start
always sends `prompt=consent`, while callback exchange requires a newly returned
refresh token. Removing the prompt alone could break returning sign-in because
Google may omit that token. A safe repair needs a designed distinction between
ordinary sign-in and mailbox connection/reconnection plus preservation of the
existing encrypted refresh token. This audit did not silently change the OAuth
or token contract.

### Closed: production first-run verified with an unused Google identity

The founder supplied a Google identity that had never connected to DeclutrMail.
The first callback attempt failed closed before creating a user or workspace;
the immediate retry completed consent and created the account. The onboarding
gate showed live progress while one first-attempt worker run scanned 23,378
Gmail message ids in about ten minutes. The durable sync result finished with
status `succeeded`, readiness and stage both `ready`, progress 100%, zero
unreadable messages, 303 indexed senders and no error code.

The browser then reached the five-sender first-review handoff, completed setup
through `Finish for today` without taking a Gmail action, and landed on Home.
A full reload preserved the authenticated account and ready Home data; Triage
then rendered its five real rows. The persisted user has a completed onboarding
timestamp and an active mailbox. No administrator rows were reset or deleted,
and no email was moved, deleted or unsubscribed during this verification.

### Observed: one callback arrived without the OAuth state cookie

Priority P2 reliability follow-up. The first fresh-account callback recorded
`login.failure` with the closed reason `missing_state_cookie` and returned the
generic retry message. Database readback confirmed that attempt created no user,
workspace or mailbox. An immediate retry in the same built-in browser, with the
same account and permission, succeeded end to end. The state cookie has a signed
ten-minute lifetime; this failure occurred well inside that window. One
successful retry does not identify whether the loss was browser-specific or a
general callback reliability defect, so it remains an observed risk rather than
a proven server repair.

### Fixed during integration: transient implementation-log API reads

The merge-group gate twice received a GitHub GraphQL 502 while listing merged
PR metadata. Its fail-closed behavior correctly blocked both candidates, while
the identical strict command passed locally. The reader now makes three bounded
attempts with short backoff before retaining the same exit-3 failure. It still
never interprets an unreadable PR list as an empty list.

## Verification

- Production built-in-browser reconnect: identity, consent, callback, ready
  state, ten-row Triage queue, Settings, Activity, manual refresh, sign-out,
  return sign-in, persistence, and narrow layout passed.
- Production fresh signup: unused Google identity, consent, safe failure before
  persistence on the first missing-state callback, successful retry, live
  23,378-message scan progress, single-attempt ready transition, five-sender
  first-review handoff, completion without a Gmail action, Home reload and
  Triage persistence passed.
- API integration: 116 Triage and Sender read-service cases passed, with ten
  unrelated native-PostgreSQL cases skipped by their existing environment gate.
  Coverage includes the reproduced unknown-denominator/stale-prose contradiction,
  both percentage word orders, and the Sender Detail sibling surface.
- API TypeScript check passed.
- Web synthetic onboarding: 95 cases across page, step derivation, and sync gate
  passed.
- Web TypeScript check passed.
- Strict implementation-log derivation passed locally after the bounded-retry
  repair; persistent GitHub read failure remains fail-closed.

The read-time guard merged in PR #907, passed its merge queue and post-merge CI,
and was deployed to the production API. Production readback showed an unknown
marked-read value beside the no-mail explanation instead of the stale numeric
claim. No production mailbox mutation requires restoration; both authorized
connections remain active. Deletion and expiry verification remain pending by
explicit request.
