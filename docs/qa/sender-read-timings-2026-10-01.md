# Senders request timing seams — 2026-10-01

## Symptom and hypotheses

After the approved current-mail index and exact default count reuse, production revision 00438 still returned two successful Senders requests in 2640.73 and 4764.13 ms; four summary requests had median 2888.72 ms/max 4654.16 ms. Existing request logs have no Senders operation boundaries.

Ranked hypotheses: row SQL dominates; metadata/summary scans dominate; pool/transport waits amplify concurrent reads. Operation timings measure application elapsed time including pool/network waits, not SQL CPU. They can identify the read boundary but cannot alone distinguish its CPU from transport.

## Scope and ownership

Root integration owner. Isolated codex/sender-read-timings based on main 889e4f5c. Owns request-performance.ts, senders.controller.ts/spec.ts and this report. Shared contract adds only four static operation names: senders.rows/meta/marks/summary. Independent of #836 readiness diagnostics. No SQL, auth, response, selection, schema, cache, worker or sampling-rate changes.

Existing optional 10% sampling and AsyncLocalStorage accumulator remain. Timers include only elapsed time/count/failure count. No mailbox/sender IDs, searches, domains, SQL or exception payloads are attached. Lists still fan out rows and page-1 metadata in Promise.all before awaiting marks; cursor pages omit metadata. Summary delegates identical arguments and returns the same envelope.

## Local verification

- Negative control: augmented actual-controller list-pagination and summary contract assertions on baseline fail missing operations; 2 failed/38 passed. Original values/arguments are retained in the assertions.
- Candidate: 50 passed across controller, request accumulator and HTTP middleware suites. Existing concurrent-request isolation, original-error propagation, disabled sampling and response-close suppression pass.
- API typecheck, changed-file ESLint, formatting and diff checks pass.

## Limits

This patch is instrumentation, not a speed improvement. Production still has not met 200 ms. Summed concurrent spans must not be subtracted from HTTP time. Unsampled requests correctly have no operation fields. Production after-release samples and independent required privacy/architecture review are pending.
