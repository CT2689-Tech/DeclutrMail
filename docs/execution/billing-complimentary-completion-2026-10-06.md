# Paid confirmation under a complimentary entitlement

Owner and integration owner: current launch-readiness chat. Isolated branch
`codex/billing-complimentary-completion`, based on fresh main `d25c61d4`.
Only an unrelated dependency PR was open at inventory. This repair owns
BillingScreen pending-action bookkeeping, its caller tests and story fixtures,
the subscription read and its backward-compatible shared wire contract, the
related backing-plan derivation, the existing signed-webhook money-path E2E
read assertion, and this audit/implementation-log entry. No schema migration, provider adapter, payment
state write, catalog, pricing, Gmail, or deployment configuration changes.

Relates to D117, D249 and D260. A complimentary grant is an entitlement floor;
it is not proof of a paid subscription or money-action completion. The existing
completion effect compares the effective account tier with the checkout target.
Pro complimentary access can therefore keep a confirmed Plus purchase waiting,
or make an unresolved Pro change look complete before the paid row changes.
This is a source-identified gap, not proof of what happened to the user's original
checkout. Whether that checkout was charged remains unanswered.

Contract: a supported pending purchase/change/resume resolves from the server's
granting paid subscription matching its target tier and, when recorded, cycle.
Complimentary access alone cannot confirm it. Missing, mismatched or non-granting
subscription state and failed reads keep the recovery hold. Existing environment,
workspace, provider reconciliation and duplicate-charge boundaries remain intact.

Verification matrix before implementation:

- Confirmed Plus subscription beneath complimentary Pro: clear the pending
  checkout/intent and preserve Pro access.
- Complimentary Pro with paid Plus while Pro is awaited: keep the change hold.
- Complimentary Pro with a paused Pro row while resume is awaited: keep the hold.
- Complimentary access without a paid row: keep the hold, including old records
  with no cycle.
- Wrong cycle, failed read, other workspace and ordinary paid completion:
  retain existing regression coverage and run it with the new cases.

No real payment, provider write, live key read, mailbox mutation, permission grant,
or notification send is part of this repair. Browser verification will use isolated
synthetic billing data. A successful synthetic read is not live checkout proof.

The first status-only repair passed the ten initial regressions but failed a
refund-backstop caller regression: status alone does not prove a row grants.
Independent review also identified expired dunning beneath a grant and retained
query data during failing refresh. The API now exposes an optional
server-computed `grantsAccess` field using the same status/deadline predicate as
tier recomputation. New clients hold tier-mismatched complimentary states when
older servers omit this proof. Old matching-tier completion stays compatible
only when a complimentary grant cannot explain the paid target. Refund/chargeback verdicts remain held even in
their access-granting grace period; access proof does not settle a money outcome.
Failed or in-progress refreshes cannot release a lock. Tests cover these rollout
and unknown-state boundaries. The browser does not reimplement deadline policy. The derived plan honors explicit
false proof so ended paid access cannot supply a price or renewal date beneath
complimentary access. Its existing non-backing support/recovery path stays locked
against a second checkout; two model regressions failed before this correction.

Verification completed locally:

- Ten original caller regressions failed against the original screen; the first
  status-only repair then failed the refund-backstop case. Removing the refresh
  guards independently failed the retained-data regression.
- Eight database-backed API grant-proof cases failed against the original read.
  Healthy/future deadlines grant; expired/paused/canceled rows do not. These use
  the actual BillingService, with no provider writes.
- Two presentation cases failed before the shared derive correction.
- Full web suite: 3,850 passed, 3 existing skips. Billing subset before the last
  granting-dunning case: 279 passed. API billing: 347 passed. Shared: 736 passed.
- Workspace typecheck and lint pass (six existing warnings); Storybook and a clean
  Next production build pass. All 51 bundle-budget routes and 45 required public
  prerenders pass. Temporary smoke routes/scripts were removed before the build.
- Built-in browser against Next dev: unconfirmed upgrade holds then clears on
  server confirmation; paused resume holds then clears; paid Plus confirmation
  retains complimentary Pro; ended same-tier paid access holds with no paid price.
  Keyboard confirmation and a phone viewport passed with no horizontal overflow
  or observed console errors. Fixture cleanup unmounted, restored fetch/storage,
  closed its tab and reset viewport. Synthetic stories persist for review.
- A separate actual-service loopback HTTP smoke over migrated synthetic PGlite
  returned Pro effective access with paid Plus: healthy true, expired dunning
  false, paused false. No provider adapters were configured. It does not exercise
  production auth middleware or prove an actual purchase.
- Independent architecture/design/type/failure/flow/defect-class review found no
  blocking findings. The signed-webhook E2E read now asserts the API's grant proof;
  its CI run remains an integration check, not a sandbox payment rehearsal.

Current stage: locally verified and independently reviewed; PR CI, merge queue,
deployment and production readback remain separate stages. The earlier Sentry
repair is merged/deployed. Production hydration remains open. Original payment
status, real sandbox/live purchase/refund, admin OAuth approval, Sentry capacity
and notification receipt remain separate launch gaps; deletion/expiry verification
is explicitly pending. This repair neither clears those gates nor settles money.
