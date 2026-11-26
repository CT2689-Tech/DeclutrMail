# Worker revision and retry inspection

HTTP traffic identifies the revision receiving HTTP requests. It does not identify
every background queue consumer. A Sentry release tag is also an observation,
not proof of the process's Cloud Run revision. Use this manual read when those
sources disagree or an initial scan has a recorded retry delay to investigate.

The main-only `worker-readonly-diagnosis.yml` workflow uses the existing Google
Workload Identity and deploy service account. It grants no permission or runtime
setting. There is no scheduler, database read, payment credential, queue command,
deployment or mailbox action. Owner: the growth session; connected pieces are the
new runner, tests and CI Lint contract step. No application contract changes.

Supply a closed UTC `start` / `end` interval, at most four hours long and within
the previous seven days, plus a caller-generated RSA public key PEM (at least
2048 bits). Keep its private key locally, never in GitHub inputs or repository
files. Both the tests and input validation run before authentication.

The runner performs only four fixed reads for `declutrmail-worker` in the
existing production project:

- Current service generations, latest revisions, and desired/observed traffic
  targets with bounded revision names, tag names and explicit percentages.
- Current us-west1 revision image, source-release and scaling metadata (latest first).
- Existing worker lifecycle, retry and sync-attempt log records in the interval.
- Existing container instance-count samples by revision and state in the interval.

The log and metric reads cover that service name across the project and retain
its location, so a matching service in another region is not silently combined
with the current us-west1 revision metadata.

It retains only known revision/image forms, a hexadecimal source release, known
log kinds and error classes, bounded numeric timing fields and instance samples.
Other environment values, log messages, customer/job references, headers,
addresses and arbitrary labels are excluded. Raw responses exist only in memory.
Response size is capped at 2 MiB. Routing takes one request; each other source
has at most three pages (ten requests total). Reads time out;
failures remain unavailable and partial page coverage is marked truncated.

Only an authenticated `infra-readonly` encrypted envelope is uploaded, retained
for one day. Workflow output contains no report contents. Download and decrypt
the artifact locally using the existing AES-GCM/RSA-OAEP report format, retain
the approved projection in the private evidence workspace and remove the
ephemeral private key. This creates no new account, service or subscription.

An empty or truncated sample does not establish that an old worker was absent.
Routing is current control-plane metadata, separate from the historical log
window. Omitted percentages remain null instead of synthesized defaults,
rejected targets are counted, reconciliation is retained when returned, and
desired routing is separate from observed routing. Neither a retained tag nor
an HTTP traffic assignment establishes current background work or zero instances.
This read cannot authorize removing a tag or replace an existing retirement gate.
Instance counts do not establish job ownership. Retry logs without a customer/job
reference cannot be joined to a specific account. This inspection does not
establish a Gmail quota reason if no such field was already logged, and never
authorizes a replay, pacing change or deployment. Missing permissions require a
separate decision; do not widen IAM as part of this diagnostic.

Validation: `node --test scripts/worker-readonly-diagnosis.test.mjs`.
The mocked contracts cover scope, privacy projection, encrypted transport,
bounded reads, unavailable evidence, and validation before credential access.
Actual production-read results and source identity are recorded privately after
normal protected merge; local tests are not proof of provider availability.

Primary references checked November 25, 2026:
[revision listing](https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.services.revisions/list),
[log reads](https://docs.cloud.google.com/logging/docs/reference/v2/rest/v2/entries/list),
[time-series reads](https://docs.cloud.google.com/monitoring/api/ref_v3/rest/v3/projects.timeSeries/list)
and [Cloud Run metrics](https://docs.cloud.google.com/monitoring/api/metrics_gcp_p_z).

Routing reference checked November 26, 2026:
[service GET and response fields](https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.services/get).
