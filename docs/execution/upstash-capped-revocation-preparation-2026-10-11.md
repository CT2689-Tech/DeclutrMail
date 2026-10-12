# Capped Upstash test preparation: PR only

The founder's current spending authorization remains **$0**. This change prepares
an isolated Pay as You Go test for review; it does not authorize or execute a paid
test. The founder instructed this session to open a PR and stop. Code owns review,
click-through testing and merge. Do not queue, auto-merge, deploy or dispatch either
provider workflow as part of this handoff. Before any paid dispatch, obtain explicit
founder spending approval for one fixture with a $20 monthly database budget cap.

This session owns only the provider workflows, runner, contract tests and execution
notes. Grok owns runtime source/gate integration. There is no runtime-source dependency
for these isolated fixture observations and no worker, deploy manifest, migration,
lockfile, notice flag or production access-policy change. The coordinating chat has
received the PR-only and $0 boundaries for its canonical Grok handoff.

## Why prepare a separate paid path

Two explicit free requests were refused before a fixture or password reset existed:

- [Run #38167044955](https://github.com/CT2689-Tech/DeclutrMail/actions/runs/38167044955),
  source `993e113ccd111344e6090837a963ad3e671b1e06`: HTTP 400; the initial report did
  not classify the cause.
- [Run #38168324711](https://github.com/CT2689-Tech/DeclutrMail/actions/runs/38168324711),
  source `29efaa2862808910b942987c43b9185f49f48f14`: HTTP 400, fixed diagnostic category
  `free_plan_unavailable`.

Both sanitized reports retain `creationOutcome=rejected`, `fixtureCreated=false`,
`resetSubmitted=false`, empty observations, verified cleanup, baseline IDs present
and `productionRetirementCertified=false`. The requests establish these refusals,
not that every possible free Upstash route is unavailable. PRs #991 and #993 merged
before the latest PR-only instruction. Their failures remain evidence.

## Prepared execution boundary

The free entrypoint still requests only `plan=free`, ignores paid confirmation and
has no paid fallback. A separate paid entrypoint and manual main-only workflow
require the exact operator confirmation `APPROVED_ONE_TEST_USD20_CAP`. PR events run
mocked contract tests without management secrets; their provider job is skipped.
The confirmation is an operator attestation, not independent proof of founder
approval. Copying the confirmation or merging this PR does not grant spending
approval. The stored management credential stays in CI; no new credential or
permission is requested.

After separately approved dispatch, the prepared path requests one uniquely named
empty database with `plan=payg`, `budget=20`, AWS `us-east-1`, TLS, no read regions
and eviction disabled. The cap is a monthly usage ceiling, not an upfront charge.
Upstash documents `payg` and legacy `paid` response types for this explicit creation
path. The runner refuses every other type. It requires exact numeric budget 20,
auto-upgrade disabled, TLS enabled, eviction disabled, Prod Pack explicitly disabled,
the expected primary region and an empty read-region array. Provider-managed internal
replicas are not extra caller-selected read regions.

The creation response and independent owned-resource read must satisfy that contract
before any Redis commands or native connection. The runner checks it again before
reset and after reset before observations. A missing, changed or unsafe cap refuses
testing and attempts owned cleanup; it never repairs the plan, upgrades or raises
the budget. If the provider ignores the requested cap, an empty resource may have
existed briefly before cleanup; the runner does not claim zero cost for paid mode.

The paid schedule is fixed at 0, 1, 5, 15, 30 and 60 seconds, with at most 39 synthetic
INCR attempts across native and REST clients. Native reconnection, offline queues
and automatic resend remain disabled. Both workflows share one provider concurrency
group with cancellation disabled so simultaneous manual runs serialize. Provider
ownership, count-risk refusal, ambiguous-create recovery, secret redaction and
inventory-plus-404 deletion checks remain shared with the free path.

No production pause is necessary for this isolated fixture. Results do not prove
global retirement or settle already accepted external email sends. Every report
keeps `productionRetirementCertified=false`; app billing notices remain held.
Cleanup failures or ambiguous creation remain unresolved failures, with the safe
unique name retained for investigation rather than a new creation attempt.

## Review and verification handoff

Local contract tests use mocked management, REST and native clients; they do not
contact Upstash. All 23 tests, repository typecheck, scoped ESLint, Prettier and
diff checks pass. The standalone paid entrypoint without confirmation refuses
before provider access, with cost authorization 0 and no fixture/reset. The first
typecheck found a missing `entities/decode` dependency from freshly fetched main;
refreshing the existing frozen lockfile install resolved it without source or
lockfile changes. Review the paid confirmation gates, cap checks before commands,
unsafe-cap cleanup, free default/no-fallback behavior and shared serialization.
Code can inspect both workflows' dispatch forms without submitting either form.
An actual provider rehearsal remains unrun pending founder spending approval.

Primary contracts:

- [Creation request and response fields](https://upstash.com/docs/devops/developer-api/redis/create_database_global)
- [Independent database readback](https://upstash.com/docs/devops/developer-api/redis/get_database)
- [Pricing and budget limits](https://upstash.com/pricing/redis)
- [Owned password reset](https://upstash.com/docs/devops/developer-api/redis/reset_password)
- [Owned deletion](https://upstash.com/docs/devops/developer-api/redis/delete_database)
