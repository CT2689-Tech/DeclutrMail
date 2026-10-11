# Historical runtime probe diagnosis

Root owns the main-only diagnostic workflow and this record in
`codex/runtime-probe-rca`. “Validate this” retains the billing activation manifest
and release sequence. Diagnostic jobs wait until that release's serving readback;
no competing production-lock workflow is dispatched.

## Confirmed defects and correction

PR #948 already corrected the reproduced gcloud argument parser defect. The
subsequent `jobs_execute` failures are separate incidents.

The manual diagnostic workflow still pins image `2faa4406`, predating both the
preference compatibility check and fixed failure codes. Its source checks only
billing actors. Against an owned loopback Redis with real BullMQ workers and the
actual Node/Sentry/SWC subprocess command, it accepts a billing-only legacy actor
and a mixed billing/preference actor set. Both `f78c43ec` and `bc26bdc4` reject
those sets; they accept only the compatible control. Empty sets fail in all three.
The classified probe exits 108 for no workers and 109 for incompatible workers;
the older probes exit 1. Every subprocess exits naturally and the owned Redis
and workers are stopped. Native runs use Node 24.10.0; cloud images supply their
own exact runtime.

The workflow now pins the reviewed, built and production-verified `bc26bdc4`
image from release #38121718422. Both protocols and fixed refusal codes are
available. Its immutable digest is
`sha256:6bd13f58c982606d16e875c0bf59679a89293863434335e003b01441f59a700b`.
The main-only condition, shared release lock, runtime identity, immutable-image
verification, absence/ownership gates and terminal cleanup are unchanged.
This defect is a misleading diagnostic route, not proof of why a later
candidate probe refused deployment.

## Historical evidence and limits

Exact bounded Cloud Logging reads contain only the old generic catch message
and container exit 1. The failed execution periods were:

| Run         | Source            | Execution start to completion (UTC) | Result |
| ----------- | ----------------- | ----------------------------------- | ------ |
| 38118665413 | pinned `2faa4406` | 06:40:25.699–06:40:42.077           | failed |
| 38119342171 | `9a21d502`        | 06:57:29.722–06:57:52.048           | failed |
| 38120027471 | `f78c43ec`        | 07:10:01.768–07:10:24.288           | failed |
| 38120689461 | `2b1adc49`        | 07:22:01.810–07:22:22.170           | failed |
| 38121718422 | `bc26bdc4`        | 07:39:51.861–07:40:14.365           | passed |

The actual f78 and 2b1 tasks had exit 1, status 10, NonZeroExitCode, no termination
signal and no memory/timeout hints. Memory-limit fixtures in CI contract-test
output are not observations of these tasks. The passing job reported both
protocols compatible and one worker. All these runs completed owned cleanup.
The Redis secret version metadata shows no intervening new version; no secret
payload was read. A bounded exact-worker query found no `bullmq.error` or
`worker.shutdown` events during 06:35–07:41 UTC. That does not reconstruct its
historical broker client inventory.

The f78 and bc26 native differential loop makes identical acceptance decisions.
The caught historical reason was not retained, so it cannot be inferred from
healthy serving revisions, step duration, the diagnostic-pin repair or a later
clean replay. No speculative memory, IAM, retry or compatibility relaxation is
introduced.

## Reproduced current failure and cause

Activation #38123008533 (`07e65bf5`) failed before either service deployed. Its
actual task exited 108 (`no_workers`), status 10, after 12 seconds; owned cleanup
passed. Both serving revisions remained at `bc26bdc4`, notices OFF. The worker
was configured with minimum scale 1 and CPU throttling OFF, and nine worker-job
start events were observed during 08:02–08:04 UTC. Process activity alone does
not prove an email consumer exists.

An exact immutable-image replay, `billing-queue-20261011081101-1`, later passed
and completed owned cleanup. That passing observation did not explain or clear
the failed activation. Three subsequent owned metadata-only jobs distinguished
the source assumption:

| Owned job suffix | Control                                                          | Result                                                                                                                     |
| ---------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 20261011081201-1 | One named observer, eight snapshots                              | 28 clients, one compatible email actor; own name visible                                                                   |
| 20261011081401-1 | Named observer plus an empty blocking-read control, 80 snapshots | 22 clients, zero email actors; observer visible, blocking control omitted despite acknowledged name/readiness/pending read |
| 20261011081601-1 | Two normal named connections, four paired rounds                 | Each acknowledged its name before and after reads; each omitted the other, and only one saw the email actor                |

The final pair returned these simultaneous fixed projections at
08:18:52–08:18:54 UTC:

| Connection | Own name acknowledged before/after | Sees control A | Sees control B | Clients |             Email actors |
| ---------- | ---------------------------------- | -------------- | -------------- | ------: | -----------------------: |
| A          | true / true                        | true           | false          |      28 | 1, preference-compatible |
| B          | true / true                        | false          | true           |      22 |                        0 |

Explicit `CLIENT LIST TYPE NORMAL` returned the same split. The runtime's
provider-family hostname suffix check returned `upstashHost:true`; no hostname,
URL or credential was emitted. Native Redis controls with the identical commands
listed both normal connections through both readers and listed the blocking
control in all 80 snapshots. This rules out only-blocking-connection exclusion
and proves that the bound broker's client list is not a global consumer inventory.
The installed BullMQ backend reads that list on one connection, so the private
probe can report a false empty inventory. A positive partial list cannot prove
that every relevant actor is compatible either.

This observed fragmentation explains the reproduced current false `no_workers`
failure. It is consistent with the older execution refusals, whose catch reasons
were not retained; it does not retrospectively classify every historical exit 1.
The CLI parser failures remain separately diagnosed and corrected by #948.

All three sampler executions and exact owned cleanup passed. The blocking read
used a positively absent unique task marker; absent-key readback confirmed no
residue. No queue messages, worker bootstrap, provider sends, shared-key mutation,
service deployment, IAM change or billing flag change occurred. Raw broker client
rows, addresses, names, URLs and errors were never emitted or committed. Final
08:21:53 UTC readback still showed API00614-xox and worker00162-btj each at 100%.

## Verification and remaining repair

The diagnostic-image pin correction passes 45 existing helper/deployment safety
contracts, all package typechecks, repository lint, formatting and diff checks.
The native differential loop exercises actual subprocess output, exit status and
cleanup across empty, legacy, compatible and mixed actor sets; the exact-image
cloud helper replay verifies the selected image, runtime identity and terminal
cleanup. No extra literal-pin unit assertion replaces that native/cloud evidence.
Independent review is pending before this focused correction is queued.

The release predicate is not relaxed. Neither a retry, a capability beacon nor
a successful partial list establishes all-consumer compatibility. The remaining
repair needs an authoritative global inventory, with actual consumer enrollment
and fencing of unregistered/expired/incompatible consumers. A leased broker-key
registry must include a verified fleet-adoption boundary; a registry alone cannot
prove that an unregistered legacy consumer is absent. “Validate this” is reviewing
that repair boundary before a consumer-proof change is implemented. Activation
remains held on the failed release and current OFF serving state.
