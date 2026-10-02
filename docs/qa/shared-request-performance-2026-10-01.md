# Shared request performance: auth bootstrap and request phases

Production on API 00450-pez after the approved Micro resize still records
Senders median 838.87 ms (N=4), Activity 634.09 ms (N=3), Screener queue
789.35 ms (N=3) and auth/me 373.43 ms (N=23). These are small, unequal HTTP
cohorts, not browser rendering times or SLO proof. The 200 ms goal is unmet.

## Change and ownership

Root performance session is integration owner. Base main 5b2c7340 (#848).
Owned files are AuthController and its tests, JWT/session/mailbox/rate-limit
operation wrappers, the closed request-performance allowlist, performance
summarizer/tests and this record. No overlap with the open readiness PR #836.
No schema, cache, pool, routing, billing, Gmail action or log-level changes.

Auth bootstrap formerly waited for user, mailbox list and quota together,
then started sync health. Sync health depends on the verified user and mailbox
list, so it can overlap quota's serial reads. All successful reads are awaited
before returning the same envelope. Missing users skip health. After a known
bootstrap failure, do not start a new health read; previously started reads can
finish. Existing session revocation, ownership, mailbox preference and reconnect
rules remain intact.

Existing optional 10% sampling gains closed timings for local JWT verification,
session total/cache/database reads, mailbox resolution, rate-limit consumption,
and auth profile/mailbox/quota reads. Timings include dependency/pool/network
waits, not SQL CPU time. Session total overlaps its cache/row child timings;
parallel auth/stat operations overlap too. Do not sum or subtract overlapping
timings as a decomposition. A caught Redis outage is a successful fallback
operation, not an authentication bypass or an operation failure count.

The summarizer now retains the already deployed four Senders phase names as
well as the new closed names. It excludes arbitrary fields, SQL, raw URLs,
identifiers, tokens, errors and unknown operation names. Sampling zero preserves
product behavior. No new user-facing telemetry dependency is added.

## Reproduction and validation

A deferred quota test on the original controller failed: health did not start
when the user and mailbox list were ready. It passes with overlap. Independent
review found a newly scheduled health read after an earlier quota failure; a
regression reproduced it, then the request-local failure guard fixed it.

Five sequential original/current controller pairs with identical synthetic
dependency delays (user/mailboxes 10 ms, quota 160 ms, sync health 100 ms):

| Controller bootstrap | Median ms | Maximum ms |
| -------------------- | --------: | ---------: |
| Original             |   264.541 |    265.532 |
| Overlap              |   161.976 |    162.760 |

Exact auth envelope parity passed in all five pairs. This measures controller
bootstrap under controlled delays, excluding real guards, production SQL and
browser rendering. It establishes removal of the waterfall; it does not
predict a production percentage or prove a 200 ms page load. The disposable
benchmark and original controller copy were removed from the source checkout.

Real local HTTP/Nest smoke uses actual JWT, session, mailbox, user, entitlement
and sync read services over a fully migrated private PGlite fixture. It checks
the auth envelope, closed phase metrics without fixture data, mailbox ownership,
unowned-header 409, optional Redis outage fallback, sampling zero and immediate
revocation 401. No OAuth grants, Gmail requests, real mailbox content or
production credentials are used. This is an isolated HTTP harness; the shared
dev-up script is not run because it starts unrelated workers and kills shared
ports. Existing mailbox, sync, session and rate-limit suites cover additional
state paths.

Affected local subset: 91 tests passed across 10 files; Node summarizer tests
3 passed. API typecheck, changed-file lint/format and diff checks are required
before PR readiness. Independent architecture/privacy/security review must
finish on the final source. CI/queue, merge, deployment and authenticated
production verification are separate states and must be recorded after they
actually complete.

## Production comparison

After deployment, verify exact revision/digest and health/readiness/auth boundary,
open authenticated Senders, Activity and Screener, and read bounded HTTP samples
with the new phases. Compare representative route/status cohorts on the same
account, retaining sample count and maximum. Do not attribute a production
change to the controller fix from unequal cohorts. Use observed shared-phase
costs to choose the next optimization while preserving auth and ownership.
