# Isolated free Upstash revocation test

The founder authorized an Upstash test within a strict $0 limit. This session owns
the provider fixture/workflow and release coordination; Grok owns the remaining
runtime source/gate integration and native tests. No worker, deployment manifest,
production credential, access policy, payment behavior or notice flag changes here.

The authenticated console only offers Pay as You Go and Fixed; its budget control
rejects caps below $20. The unsubmitted form was cancelled. Upstash's anonymous
`start-redis` route documents REST scratch storage and automatic three-day expiry,
but does not document the administrative reset and deletion controls needed here.
No anonymous fixture is created as a substitute for this proof.

This manually dispatched main-only workflow reuses the existing stored management
credential. It requests `plan=free` explicitly, with TLS, no read regions and no
eviction. It has no caller-selected resource, URL, plan or code ref. If creation is
refused, it stops; there is no paid fallback. The resource count must be below ten
before creation to avoid the documented additional database-count charge.

Every mutation targets a newly returned UUID with this run's exact unique name,
creation time and absence from the pre-create inventory. Cleanup can recover a lost
create response by that unique name. The report retains that safe recovery name
before creation. An unconfirmed/partial create with no visible owned fixture keeps
cleanup unresolved after bounded recovery reads; sampled absence is not settlement
proof. Only documented invalid/unauthorized/forbidden responses are treated as
explicit rejection. Unexpected paid responses receive no Redis
commands or reset and are cleaned up. Unproven ownership prevents mutations.

Two independent authenticated native TLS sessions and a REST control acknowledge
synthetic increments before reset. Only the owned fixture's password is reset.
Existing native sessions, new old-password sessions, new-password sessions and old
and new REST tokens are observed at 0, 1, 5, 15, 30 and 60 seconds. Reconnection,
offline queueing and automatic resend are disabled. A remote close is recorded
separately from authentication rejection and an uncertain error.

Credentials, endpoints, provider error bodies and client addresses remain in runner
memory. The artifact contains only bounded classifications, timing, the owned test
ID and cleanup status. Deletion needs inventory absence and an independent 404;
baseline IDs must remain present. Cleanup failures remain failures. A bounded
revocation observation does not establish a global propagation contract, stop
already accepted email sends, or certify production retirement. Every report keeps
`productionRetirementCertified=false`; app billing notices remain OFF.

Verification before dispatch: 15 guarded fixture lifecycle, negative-path,
native client settings and workflow/secret boundary tests pass. Repository typecheck,
scoped ESLint and formatting pass. The current runner's actual ioredis auth-error
classification and non-reconnecting sessions were also verified against an owned
loopback Redis: old sessions acknowledged after the local password change, new
old-password authentication was rejected, new-password commands acknowledged, and
the Redis process was stopped. That control mocked management/REST and made zero
provider calls; its report is `/tmp/upstash-free-native-control.json`.

Independent review reproduced an accepted create with a lost response and delayed
visibility being incorrectly labeled cleaned up. The RED report is retained at
`/tmp/upstash-review-late-create-red.log`; the repaired runner refuses that claim.
Negative tests cover invisible/partial responses and late recovery. Endpoint slugs
are normalized only into the fixed Upstash domain; arbitrary URLs remain refused.

Required CI and the normal merge queue remain prerequisites to main-only dispatch.
Actual provider results will be recorded after dispatch. No provider call has run
at preparation.

Primary provider contracts:

- [Explicit free plan creation](https://upstash.com/docs/devops/developer-api/redis/create_database_global)
- [Password reset](https://upstash.com/docs/devops/developer-api/redis/reset_password)
- [Owned database deletion](https://upstash.com/docs/devops/developer-api/redis/delete_database)
- [Pricing and count charges](https://upstash.com/pricing/redis)
- [Temporary scratch route](https://upstash.com/start-redis)
- [Management response codes](https://upstash.com/docs/devops/developer-api/http_status_codes)
