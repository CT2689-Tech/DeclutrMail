# Icon read performance investigation

Owner/integration: current Codex performance session.
Branch: codex/icon-read-performance, isolated icon worktree.
Owned files: IconsService/spec and icon QA/review reports only.
Dependencies: none. No runtime overlap with #840, #841 or #836.

Production baseline: earlier authenticated window showed 90 successful icon
requests, median 1,059ms. This is request latency, not SQL-engine time.
Both lookup and batch availability currently await verified alias resolution
before requesting cached icons: two database round trips on the same public
metadata dependency. Authentication, resolver eligibility, freshness rules
and enqueue ordering must remain unchanged.

Candidate resolves validated input pairs through verified alias and cache LEFT
JOINs in one parameterized statement. A missing cache row retains canonical
identity so scheduling uses the same domain. Exact discovery artwork keeps
priority, and list availability excludes the bytea projection. Authentication,
rate limits, scheduling await/detachment, stale policy and provider terms are
unchanged. No schema or stored data change.

Negative control: both new tests return the expected bytes/ETag or mixed
availability set against copied main, then fail because the driver was called
twice. The candidate returns the same result with one call. Existing tests
cover canonical/exact lookup agreement, alias confidence, anonymous no-enqueue,
negative caching, freshness, provider expiry, queue failure/deadline and bounded
batch scheduling. All 47 service/controller tests pass with optional benchmark
on; API typecheck and changed-file ESLint pass.

Controlled benchmark: exactly 100ms asynchronous delay at each real driver call,
three complete reads on identical synthetic fixtures. Main source runs in a
temporary isolated directory with the same spec/compiler configuration.

| Read               | Before samples ms      | Before median/max ms | After samples ms       | After median/max ms |
| ------------------ | ---------------------- | -------------------: | ---------------------- | ------------------: |
| Individual logo    | 209.45, 212.81, 212.54 |      212.54 / 212.81 | 104.87, 103.41, 101.64 |     103.41 / 104.87 |
| Batch availability | 209.12, 210.85, 210.04 |      210.04 / 210.85 | 103.53, 102.76, 103.38 |     103.38 / 103.53 |

These are controlled service waits, not browser or production request durations.
Batch availability decorates Senders, Screener, Activity and Triage readers;
individual image requests share the same query helper. Cache state is read on
every invocation, with no new memoization or persistence. Concurrent resolver
writes can no longer occur between alias and cache statements; one statement
uses one database snapshot, preserving the canonical relationship it read.
Independent architecture, privacy and adversarial correctness reviews pass.
A disposable native Supabase PostgreSQL 17.6 fixture with 10,000 cached
negative domains and 50 requested input pairs executes the captured actual
batch query in 0.216ms (single plan run), with 251 shared hits. It performs
50 bounded primary-key BitmapOr probes and one scan of nine verified aliases;
there is no per-input full-cache scan. This is plan validation on synthetic
native data, not production or before/after latency evidence.
Exact-head CI remains pending.
Production-after timing remains pending API rollout.
