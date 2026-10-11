# Private probe exit reasons

Deploy #38119342171 (`9a21d50`, includes #948) and main-only diagnostic
#38118665413 both fail at `jobs_execute`, ~66 s and ~55 s after step start.
The private task exits non-zero, but every probe failure exited `1`, so the
task evidence that #952 surfaces could not say which failure it was.

Ruled out locally with the exact container command (`node
--import=@sentry/node/import --import=@swc-node/register/esm-register
src/billing/verify-billing-queue.ts`, cwd `apps/api`):

- Missing worker configuration: with only `BILLING_NOTICE_PROBE` and the Redis
  URL set (no `NODE_ENV`, `SENTRY_DSN`, `DATABASE_URL`), it passes against a
  compatible actor. Nothing in its import graph validates worker env.
- Startup exceeding the 60 s task timeout: 2.0 s pinned to one CPU; peak RSS
  344 MB against the 512 Mi limit.
- Command, args, entrypoint and imports: accepted by gcloud (#948) and pass
  end to end locally.

The production cause is still unverified. Every remaining candidate is on the
broker side: Redis unreachable or rejecting the job's connection, or the
broker reporting zero, unnamed or older `email-send` actors. These differ in
timing only by the probe's own 25 s deadline, which is within the observed
spread, so the run timings cannot tell them apart.

The probe now exits with a fixed code per reason. With #952 merged, the
deploy log's `billingProbeTask.exitCode` names it:

| Exit | Reason                      | Meaning                                              |
| ---: | --------------------------- | ---------------------------------------------------- |
|    0 | —                           | Every generic email actor is compatible              |
|    1 | `unclassified`              | Unexpected error                                     |
|   10 | `configuration_unavailable` | Probe flag or Redis URL missing in the task          |
|   11 | `redis_never_ready`         | No connection error, never ready within 25 s         |
|   12 | `redis_network_error`       | DNS, refused, reset or timed-out connection          |
|   13 | `redis_tls_error`           | TLS/certificate rejection                            |
|   14 | `redis_reply_error`         | Redis refused the connection (auth, limits)          |
|   15 | `broker_read_stalled`       | Connected, but the actor read did not finish in 25 s |
|   16 | `client_list_unavailable`   | Broker refuses `CLIENT LIST`; actors cannot be read  |
|   17 | `no_workers`                | No `email-send` actor visible                        |
|   18 | `incompatible_workers`      | An unnamed or older `email-send` actor is connected  |

Only the name or code of an error is classified; messages, URLs and client
rows are never read or printed. Every non-zero reason still refuses
deployment, and the compatibility predicate is unchanged. Exit 17 or 18 is a
correct refusal: find the stray or missing actor rather than loosen the check.
The main-only diagnostic still pins the pre-change image, so its tasks will
report `1`; the next push-triggered deploy builds an image with these codes.

Each reason except `client_list_unavailable` was reproduced through the real
subprocess against owned local Redis servers, a silent TCP listener and an
unresolvable host. `client_list_unavailable` is covered with BullMQ's
substituted row. No production resource, IAM binding or secret was touched.
