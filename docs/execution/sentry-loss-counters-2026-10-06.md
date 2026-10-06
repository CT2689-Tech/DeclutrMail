# Sentry loss counters

Owner/integration: current launch-readiness chat, isolated branch
`codex/sentry-loss-counters` from fresh main `84097377`. Six declared files are the
vendor collector and its tests, scoped encrypted projection and its tests, this
audit and implementation-log entry. PR #905 is merged and supplies the scoped
non-payment read. Only independent dependency PR #895 was open at preparation;
no overlapping open PR or shared ownership-register edit.

## Observed gap

The scoped numeric snapshot included only accepted and combined invalid/client
losses. It could not distinguish server enforcement from SDK backoff, transport
failures or intentional filtering. An authenticated dashboard exposes those
separate outcome types, but direct aggregate-reason navigation was blocked by the
built-in browser. The existing scoped CI credential route remains available.
Actual provider measurements remain in the private launch evidence. Loss counts
must not be added to monthly accepted quota usage or equated with one endpoint's
exception count across different scopes/windows.

## Bounded change

The same fixed Sentry GET now groups aggregate error counts by outcome and reason.
It retains the previous credential/project selection and 24-hour window. Those
counts are not independently verified full-organization billing totals. It requests
no events, identities, messages or source context. Numeric usage gains
server-enforcement (`rate_limited` + `abuse` + `cardinality_limited`), invalid and
client-discard totals plus closed SDK loss
families: rate-limit backoff, network errors, queue/cache overflow, send errors,
SDK filtering and internal SDK errors. Unknown or absent reasons contribute only
to an unclassified numeric remainder. Provider reason strings never become
telemetry labels, details or encrypted report fields.

The previous combined `discarded_errors_24h` field is preserved. Existing severity,
cause text/values, thresholds and acknowledgment behavior stay intact for valid
data. Missing/non-array groups, unknown outcomes, malformed/fractional/negative
counts and unsafe sums are read failures rather than fabricated zero values.
Readable zero counts remain distinct from empty unavailable responses.

The scoped encrypted report permits exactly these additional numeric fields.
Existing daily collection can publish them under its already established usage
metric when it next runs; this change creates no schedule, dashboard, alert,
authentication or provider policy. This chat dispatches only the main-only
non-payment inspection, never the full collector that binds live payment keys.
The inspection publishes no heartbeat and cannot close the missing daily
collector incident. No production application behavior or billing flow changes.

## Verification

All 69 focused vendor, observability, scoped inspection and Sentry encryption
contracts pass. New fixtures cover grouped GET parameters, disjoint counts,
unknown reason redaction, missing/unfamiliar reasons, invalid aggregate failures,
genuine zero versus unavailable reads and the encrypted projection's whitelist.
Local requests use canned responses only; no provider credential is accessed.
Four intended regressions fail against the previous collector/projection source
in owned temporary copies; original hashes remain unchanged and copies were
removed. Changed-file lint/format and the current 249-row log pass. Independent
review, normal PR/queue/exact-main
checks and actual corrected-main counter read are recorded separately as they
complete. A successful diagnostic read does not restore Sentry capacity or
establish dashboard usability, daily collection recovery or launch readiness.

References: [Sentry Stats](https://docs.sentry.io/product/stats/),
[aggregate API dimensions](https://docs.sentry.io/api/organizations/retrieve-event-counts-for-an-organization-v2/).
