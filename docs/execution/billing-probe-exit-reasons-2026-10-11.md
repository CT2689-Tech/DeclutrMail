# Private probe exit reasons

The first task-metadata release, #38120027471 at `f78c43ec`, failed with an
actual task exit code `1`, status code `10` and `NonZeroExitCode`, with no
memory-limit or timeout hint. Cleanup reported `probeDeleted:true`; neither
producer deployed. Memory-hint fixtures printed by safety-contract tests in
that log are not observations of the real task. The actual failure still
needs the fixed reason codes below.

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

The production cause is still unverified. Broker-side candidates include
Redis unreachable or rejecting the job's connection, or the broker reporting
zero, unnamed or older `email-send` actors. These differ in
timing only by the probe's own 25 s deadline, which is within the observed
spread, so the run timings cannot tell them apart.

The probe now exits with a fixed code per reason. The deploy log's
`billingProbeTask` adds `probeReason`, derived from that exit code, and
`runSeconds`, from the container's start/completion timestamps. These bounded
fields do not forward container stdout, actor rows or provider messages:

| Exit | Reason                      | Meaning                                              |
| ---: | --------------------------- | ---------------------------------------------------- |
|    0 | —                           | Every generic email actor is compatible              |
|    1 | `unclassified`              | Unexpected error or startup/import crash             |
|  101 | `configuration_unavailable` | Probe flag or Redis URL missing in the task          |
|  102 | `redis_not_ready`           | No classified error; not ready at the 35 s deadline  |
|  103 | `redis_network_error`       | DNS, refused, reset or timed-out connection          |
|  104 | `redis_tls_error`           | TLS/certificate rejection                            |
|  105 | `redis_reply_error`         | Redis reply error observed; cause unverified         |
|  106 | `broker_read_stalled`       | Connected, but the actor read did not finish in 35 s |
|  107 | `client_list_unavailable`   | Broker refuses `CLIENT LIST`; actors cannot be read  |
|  108 | `no_workers`                | No `email-send` actor visible in any sample          |
|  109 | `incompatible_workers`      | Missing, malformed or mismatched actor evidence      |

Only fixed error names/codes are classified; error messages and URLs are not
inspected. The compatibility predicate reads actor names and the exact BullMQ
fallback sentinel, but client rows and names are never logged. Every non-zero reason still refuses
deployment, and the compatibility predicate is unchanged. Exit 108 or 109 is a
correct refusal: find the stray or missing actor rather than loosen the check.
Exit 107 requires BullMQ's exact singleton fallback sentinel; other missing or
malformed actor names remain incompatible evidence rather than establishing
that the broker refuses `CLIENT LIST`.
The main-only diagnostic still pins the pre-change image, so its tasks will
report `1`; the next push-triggered deploy builds an image with these codes.

Each reason except `client_list_unavailable` was reproduced through the real
subprocess against owned local Redis servers, a silent TCP listener and an
unresolvable host. `client_list_unavailable` is covered with BullMQ's
substituted row. No production resource, IAM binding or secret was touched.

Classified exits use 101-109 to avoid Node native exit-code collisions. An
unsettled top-level await exits 13 without observing any TLS error; native 13
therefore has no mapped probe reason. Unexpected/startup errors retain exit 1.

## Sampled actor reads (run 447)

Deploy #38123008533 (`07e65bf`) refused with `exitCode:108`,
`probeReason:"no_workers"`, `runSeconds:12`, 23 minutes after #446 (`bc26bdc`)
had found compatible workers. The always-on worker revision was
`declutrmail-worker-00162-btj` (min 1 instance). A refusal 12 s after container
start means one `CLIENT LIST` returned no matching name.

Two mechanisms can each produce that read against a live worker:

- Partial listings. In the paired-connection discriminator recorded in
  `billing-notice-activation-2026-10-11.md` (#962, `2026-10-11T08:18:52Z`), one
  connection to the bound broker listed 28 clients including a compatible
  generic email actor, and the other listed 22 clients and none; the native
  Redis control listed both from both readers. Which clients a listing returns
  depends on the reading connection.
- Reconnects. BullMQ 6.3.8 names only the worker's dedicated blocking
  connection (`bull:<base64 queue>:w:<name>`, set by ioredis on every connect)
  and writes no worker heartbeat keys. It resets that connection whenever a
  blocking `BZPOPMIN` overruns its watchdog (timeout + 1 s; user-facing
  `drainDelay` is 60 s). While it reconnects the worker is in no listing.
  Locally, killing that connection made the main-branch probe exit
  `108 no_workers` against a live worker.

Which of the two caused run 447 is unverified.

The probe now reads 5 samples, 3 s apart, each through a fresh connection,
inside a 35 s deadline (run 447 suggests ~10 s of container startup; the task
timeout is 60 s). Absence is the only refusal retried. Any other refusal in any
sample is final, and sampling continues after a compatible read, so an older
actor that appears in any sample still refuses. `no_workers` now means no
sample saw a worker.

This removes false-empty refusals. It does not make the inventory complete: a
pass means compatible actors were seen and no incompatible actor appeared in
the sampled listings, not that every consumer was listed. An older actor that
no sampled connection lists, or one reconnecting in every sample, stays
invisible, as it was to the single listing before. Per #962, notice activation
stays off until a repair proves the complete consumer set; this probe is not
that proof.
