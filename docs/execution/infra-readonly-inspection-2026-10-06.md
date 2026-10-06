# Scoped infrastructure inspection

Owner/integration: current launch-readiness chat in its isolated worktree, branch
`codex/infra-readonly-inspection`, fresh main `950b7d5c`. Declared files are the new
inspection workflow, runner and tests; the existing encrypted-report helper's
optional purpose; one CI contract step; this audit and the implementation-log
entry. Only the independent dependency PR #895 was open at preparation. No shared
ownership register is changed. Existing launch workstream responsibilities remain
distinct; this is an access diagnostic requested by the current infrastructure
assessment, with no mailbox, checkout or provider-account mutation.

## Gap and bounded implementation

The October 5 full vendor watchdog failed before acquiring a hosted runner. A
successful October 6 Sentry-only run does not publish its daily heartbeat. The
collector absence incident remains open at the last authenticated browser read.
No new full scheduled run was listed through the current October 6 inspection.
Manual full collection currently binds production payment credentials, outside
this task's exploratory-read boundary. Existing credentials for other provider
reads remain available through repository secrets and Google Workload Identity.

The new manual, main-only workflow reuses nine non-payment vendor metadata reads.
It binds no payment credential or payment environment variable. The runner
enumerates environment names and removes every Paddle/Razorpay-prefixed variable
without reading its value before starting the existing collector. Both payment
rows must be unconfigured with no numeric data; they are excluded from the
diagnostic. The default/scheduled watchdog is unchanged. No monitoring metric,
finance report, alert, IAM policy, runtime deployment or provider setting is
written by this inspection. Anthropic administrative setup remains human-deferred;
any stored credential's read failure stays unavailable, not an invitation to
request replacement credentials.

Repository metadata confirmed it is public. The existing collector may print
provider error bodies, so child stdout/stderr are discarded and its step-summary
path is disabled. Only the existing numeric snapshot is consumed, with a 64 KiB
cap, closed provider/status names and known numeric usage fields. Unknown usage
names are omitted with a count. Missing, duplicate, malformed or unexpectedly
configured payment rows make the diagnostic unavailable. No raw error, query,
endpoint, mailbox content, credential, invoice or arbitrary provider string is
exported. Detailed error causes are deliberately unavailable in this projection.

The public artifact contains only an authenticated encrypted envelope, retained
for one day. A caller-generated RSA public key is validated before authentication
and again before collection; the private key stays local and is never sent to
GitHub. The established AES-256-GCM/RSA-OAEP-SHA256 helper gains one closed context
for this report. Its default Sentry envelope stays unchanged. Different contexts
cannot be substituted without authentication failure. Temporary plaintext numeric
metadata is removed after projection. Child execution has a configured 120-second
timeout with SIGKILL, so an intercepted SIGTERM cannot prevent parent cleanup.
Only ETIMEDOUT establishes a deadline; other terminations remain collector failure.

## Evidence meaning and verification

`collectionStatus=collected` means a scoped snapshot was parsed, including
unconfigured/read-error rows. It does not mean all nine providers were readable,
that costs are complete or that the infrastructure is healthy. Collector exit
status and each source's status remain visible inside the encrypted report.
`paymentProvidersRead`, `monitoringPublished` and `dailyCollectorRecoveryVerified`
are false. This workflow cannot clear the daily missing-collector incident.
Browser dashboard rendering/freshness and actual notification receipt remain
separate observations.

Local verification passed all 24 new/existing encrypted diagnostic contracts:
payment-value access/forwarding exclusion, public-key validation before process
launch, numeric projection/redaction, a native noisy child with preserved failure
exit, invalid/missing/oversized/deadline evidence, authenticated context
roundtrip/substitution rejection, and a native zero-credential CLI proving
encrypted-only output with no step-summary change. A native pair separates child
self-termination from an actual timeout, including a child that handles SIGTERM.
Independent review identified the original SIGTERM classification and timeout
signal limitations; both are repaired and covered by that regression.

Three old-behavior controls each failed the intended single targeted test: removing
the payment environment filter, substituting the Sentry encryption context, and
using the original signal-based timeout classification. These controls used owned
temporary source copies; original source hashes stayed unchanged and the copies
were removed. The existing vendor-limit/observability suites passed 40 tests,
changed-file lint and workspace typecheck passed, and the merge-policy audit
matched required repository checks. Actual external queue statuses remain a CI
gate. No local provider calls were made. Required PR/queue/exact-main checks and
an actual corrected-main scoped read are recorded in the PR and private launch
evidence when complete. No full payment-enabled collector is manually dispatched
by this chat.

The launch gate still requires actual sandbox/later approved live billing,
verified isolated webhook delivery, fresh admin OAuth, named mailbox fixtures,
delivery approvals, Sentry headroom/live-event/source-map proof, large-export
completeness and hydration diagnosis. Deletion/expiry remains expressly deferred.
