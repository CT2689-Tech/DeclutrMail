# Sandbox callback target attribution

Owner and integration: current launch-readiness chat in its isolated worktree,
branch `codex/paddle-sandbox-callback-targets`, based on fresh main `72654a38`.
Owned files: existing inspection script/tests, this audit and implementation-log
follow-up. Depends on merged PR902/903. Only the independent dependency update
PR was open at preparation. No runtime SDK, checkout, provider configuration,
payment, deployment, secret, IAM, OAuth or public-exposure change.

## Evidence and bounded repair

The first sanitized sandbox report completed catalog/destination collection but
called all four notification origins `other_url`: its only production-origin
reference was `https://api.declutrmail.com`. That did not prove that the active
callback belonged to an isolated sandbox runtime. An authenticated Cloud console
read as the existing admin identity on October 6 shows two services in the
unfiltered project inventory: the production API and worker. No separate sandbox
service is listed in this project. This is not a claim about other projects,
external services or local fixtures.

The API networking metadata, confirmed in the authenticated browser immediately
after the 2026-10-06 12:36:39 UTC clock read, verifies these two additional
production URLs:

- `https://declutrmail-api-387835380133.us-central1.run.app`
- `https://declutrmail-api-dg2ex7eepa-uc.a.run.app`

Sources are the authenticated [service inventory](https://console.cloud.google.com/run/services?project=declutrmail-ai-prod)
and [API networking metadata](https://console.cloud.google.com/run/detail/us-central1/declutrmail-api/networking?project=declutrmail-ai-prod).
The visible revision history shows API00547-fon serving 100%; the first 30 rows have
no revision tags. That view alone does not establish that all 401 historical
revisions lack tags. Several native metrics panels failed to query data; their
usability remains unverified despite readable service/configuration metadata.

The inspector now matches all three exact production origins, excluding URLs
with embedded credentials. It never trusts host prefixes, lookalike suffixes,
other Cloud Run services, alternate ports or a downgrade to HTTP as the verified
production origin. Other Cloud Run, tunnel-provider and loopback URL shapes gain
closed category labels. These generic shapes prove neither ownership nor runtime
environment, endpoint lifetime, reachability, delivery or safety. No destination
URL/address is printed and no callback target is contacted. API-key validation,
sandbox-only GET host, redirect rejection, pagination reconstruction, time/body
caps and unread-error connection cleanup remain intact.

The report also exposes the configuration's `include_sensitive_fields` only as
true, false or null. Missing/malformed values remain unknown, never silently
disabled. It emits none of those sensitive fields themselves. The flag is
documented in Paddle's [notification-settings API](https://developer.paddle.com/api-reference/notification-settings/list-notification-settings/).
It is a configured switch, not proof of actual payload contents or receiver
storage. Collection completeness remains distinct from rehearsal readiness.

## Verification and next gate

Focused cases cover both verified aliases, credential-bearing URLs, host
lookalikes, HTTP/alternate ports, unverified Cloud Run URLs, three tunnel host
families and their lookalikes, IPv4/IPv6/localhost, redaction and true/false/null
field preservation. All 13 local cases passed. Both old-behavior controls failed
as expected (canonical-origin-only matching and missing sensitive switch treated
as false); the source was restored byte-for-byte after each control. Independent
review approved the implementation with a nonblocking naming correction, which
was applied as `tunnel_url`. Required CI/queue and a fresh corrected-main sandbox
read are recorded separately when complete.

Workspace typechecks, formatting and implementation-log validation (249 D-rows)
passed. Lint passed with six existing unused-disable warnings. The read-only
merge-queue policy audit matches required repository checks; the actual external
Vercel queue check still requires runtime evidence.

Before any purchase, verify the actual callback's runtime/environment and secret
binding and use an isolated rehearsal account/database. A recognized production
URL must not be used as a sandbox purchase target. No webhook is activated,
disabled or retargeted by this diagnostic. Current Razorpay availability choice,
admin OAuth, real outcome/receipt approvals and live cutover remain pending.
Deletion/expiry is expressly deferred.
