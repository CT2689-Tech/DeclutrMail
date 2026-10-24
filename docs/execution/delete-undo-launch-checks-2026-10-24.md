# Delete Undo recovery and Autopilot launch checks

Integration owner: this chat. Scope: durable Delete placement, one overdue-action
alert, existing monitoring verification and a separately approved mixed-mailbox
test. The active Autopilot visual work and PR #1100 notification-routing work
remain separate. No SQL migration, OAuth scope, message field, public response,
Undo window or billing change is included.

## Reproduction and fix

A deterministic synthetic test sends Delete successfully, crashes before the
terminal Undo journal transaction, applies a realistic Gmail-sync Trash state
to the local mirror, and retries. Both Inbox-only and Inbox-plus-archived
variants failed against the original code: their recorded Inbox subset was
empty. The fix captures and persists original placement before Gmail can
change it, atomically with the first executing mark. The same real worker
lifecycle now restores the Inbox subset and leaves originally archived mail
archived, including reviewed recovery. The harness verifies worker.succeeded
for both the completed Delete and Undo.

## State and reader contract

| State or reader                               | Behavior                                                                                               | Verification                                                      |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| Untouched root, first send                    | Capture current placement after quota admission and guards; commit with executing before provider call | Refused-request and provider-boundary tests                       |
| Provider succeeded, process crashed, sync ran | Reuse durable original partition rather than the changed mirror                                        | Inbox-only and mixed root retry regression                        |
| Reviewed recovery child                       | Inherit server-only selector metadata; reject any target expansion                                     | Both reviewed crash/sync variants and expansion rejection         |
| Known-empty Inbox subset                      | Preserve empty array as known archived origin                                                          | All-mail refused-request regression and existing mixed Undo tests |
| Legacy in-flight origin unavailable           | Record explicit unknown; Undo returns to Archive conservatively                                        | Unknown-origin Inbox-only regression                              |
| Hook skipped by broken client                 | Existing error/Sentry reporting; no post-provider snapshot capture                                     | Existing skipped-hook coverage                                    |
| Terminal journal writer                       | Read persisted pre-request snapshot; publish Undo only on terminal commit                              | Real worker lifecycle harness                                     |
| Reverse worker                                | Restore Inbox only for the saved subset; unknown never adds Inbox                                      | Mixed restoration and legacy journal regressions                  |
| API status and recovery                       | Status does not expose selector; recovery copies it with the frozen IDs                                | Source review and existing recovery suite                         |
| Sync                                          | Can update mirror after a crash without overwriting durable placement                                  | Crash/sync regression                                             |
| Logs and operational collector                | Closed aggregates and safe errors; never snapshot IDs or tokens                                        | Existing telemetry contracts; independent review                  |

## Monitoring

Consent-gated scalar custom-rule events already reach PostHog. Confirmation
means acceptance, not completed cleanup or adoption. Existing authoritative
action aggregates and eight dashboard panels cover completed, failed, pending,
overdue and reverse Undo jobs. A separate policy owner now detects overdue
cleanup/Undo using the existing distribution metric, exact snapshot sum/count
means and a maximum across revisions. It creates no metric, dashboard or
notification channel and does not modify PR #1100's routing files.

Final semantic review found that intentionally queued Quiet work could otherwise
page as stuck. After a successful resume publish, the worker now atomically
merges its promised due time into existing selector metadata. Only untouched
queued custom roots receive grace until that deadline plus 30 minutes. A lost
callback still becomes overdue, even while Quiet remains active. Executing work
uses its persisted provider-start transition; recovery uses its current attempt's
start. Reverse/recovery/executing jobs ignore inherited Quiet hints. Malformed
hints fall back to ordinary age, and raw pending counts/ages remain unchanged.
This adds no table, migration, collected message field or provider request.

The default command is an offline plan. Live verify/apply requires complete
policy/channel/snooze reads, a fresh successful actions collection, valid
native observations for Archive/Delete in both directions, no overlapping
policy and independent configuration readback. Manual production apply is
main-only, checks the exact reviewed SHA before existing WIF authentication,
and owns one named alert policy. Configuration verification does not prove
that an actual alert email was delivered.

## Verification and release status

- Negative control: both original crash/sync assertions failed before the fix.
- Monitoring negative control: both Archive/Delete deadline regressions failed
  against the old collector, and the new worker deadline assertion failed
  against the old deferral path.
- Worker suite: 84 tests passed, including four full-lifecycle crash/sync
  variants and existing Autopilot scope, protection, quiet, retry and Undo tests.
- Workspace typechecks passed serially to limit memory use.
- New alert contracts: 16 tests passed; existing alert/routing contracts also
  passed. Full lint passed with six existing unused-disable warnings; scoped
  lint and changed-file formatting passed. Existing action recovery suite:
  17 tests passed. Entitlement literal guard: two tests passed.
- Focused API monitoring, queue and recovery checks: 31 tests passed. These cover
  malformed hints, failed/successful extensions, the exact grace boundary, lost
  resume delivery, resumed execution and latest recovery age.
- Independent architecture, schema type-only, privacy and monitoring reviews
  cleared the final change. Review corrected provider object-order comparison,
  bounded pagination, active-snooze checks and the skipped-hook stale-snapshot
  fallback. The existing inventory's missing Gmail-label derivation reference
  is a documentation follow-up; no new data family is introduced.
- Production release and live policy activation/readback remain pending.
- Google Cloud's browser requires the founder's passkey checkpoint. Existing
  automated WIF serving reads work; dashboard usability is not yet verified.
- A two-email mixed Inbox/archived candidate has been identified privately.
  No email will move until the founder approves the exact batch after deployment.

Real mailbox identities, subjects, provider IDs, tokens and unredacted
screenshots remain outside the repository. Synthetic failure injection never
uses production Gmail. Historical Activity and retired test-rule audit records
are the expected residue after the approved live test.
