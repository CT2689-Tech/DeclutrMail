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

### Production first-run remains unverified

Priority P1 launch evidence gap. The designated administrator account was not
new, so its successful reconnect cannot prove the production promise-to-first-
review journey. A separate unused Google Workspace test identity, or an
explicitly authorized reversible staging fixture, is required for that exact
production evidence. Resetting the administrator's live rows would be a
destructive substitute and was excluded.

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

The changed behavior is server-side and is verified at the database-backed read
service boundary. The unmerged local guard has not yet been observed in
production. No production mailbox mutation requires restoration; the authorized
administrator connection remains active. Independent review, PR checks, merge,
deployment, and production readback are recorded separately as they complete.
