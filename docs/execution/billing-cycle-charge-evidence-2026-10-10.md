# Cycle-change charge attribution — 2026-10-10

Root owns the adapter, refund policy/types, focused regressions and this evidence.
This isolated follow-up depends on merged #924, #928 and #930. It does not enable
production restoration or notices. Relates to D117, D119 and ADR-0044.

## Actual financial evidence

Sandbox rehearsal [38090956333](https://github.com/CT2689-Tech/DeclutrMail/actions/runs/38090956333)
used exact main `96eaed8ad2a8368152f88225237909c9933a35f4`. Its monthly upgrade-only
full refund passed: the base Plus plan was restored, the exact original renewal
`2026-11-10T22:21:44.232919Z` was retained and no extra completed charge appeared.
Paddle approved the adjustment asynchronously. Root full coverage and partial
line-item coverage are already handled correctly; no coverage rule was loosened.

The cycle upgrade remained pending. Its attempted refund was refused **before
submitting an adjustment** because the charge could not bind. The signed candidate
was created within the original frozen window. Read-only Sandbox API workflow
[38091567643](https://github.com/CT2689-Tech/DeclutrMail/actions/runs/38091567643)
confirmed the exact shape in both provider arrays:

- New annual-plan debit: quantity +1, positive total, no proration metadata.
- Prior monthly-plan credit: quantity -1, negative total, explicit rate `0.99998`.
- Root period starts inside the frozen operation window and ends at the annual
  target renewal. Credit starts 17 ms later, also inside that window, and ends at
  the exact original monthly paid-through time.

The run was stopped through its authenticated **Abort and clean up** control,
not canceled through GitHub. Its final artifact records `aborted=true`,
`completed=false`; recovery, destination stop, token revocation, handler drain
and both subscription-stop readbacks are all true. The per-run Sandbox operator
secret was deleted and its absence read back. This remains a partial/failed
rehearsal even though its monthly case passed. Earlier failures and manual cleanup
are preserved in the preceding execution documents.

## Bounded change

Keep the observed mixed-cycle shape separate from fully prorated and same-cycle
absent-proration evidence. Require exactly two distinct prices, matching quantities
and credit proration in both raw arrays, ordered valid periods, finite credit rate
in (0, 1], and exact debit/credit signs. Binding still requires both real server
HMACs, exact subscription/intent/target, unique complete transaction discovery,
the original immutable operation window, both frozen snapshots and fresh provider
and canonical state under the existing lock. No rate is invented and no window is
widened.

An approved full **cross-cycle** upgrade refund always enters
`original_renewal_requires_support` before any restoration claim or preview,
including previously supported fully prorated representations. Stronger stop,
chargeback, newer-change and ended-period outcomes retain precedence. A charge
binding is not proof that a date-restoration write is safe. The support barrier
remains; no restoration completion is recorded. Same-cycle restoration is unchanged.

## Verification and remaining release gate

Three contract regressions failed before the fix: normalization and mixed-cycle
binding were absent, and a fully prorated cross-cycle refund could restore when
its preview promised the prior renewal. The initial fixed adapter/policy suite
passed all 173 tests and API typecheck. The final adapter/policy/webhook suite
passed 236 tests across three files. All eight workspace typechecks and touched
ESLint/format/diff checks passed. Regressions cover contradictory arrays, invalid
credit metadata/periods, frozen-window drift, both tampered HMACs, fresh provider
and canonical changes, pending approval, stronger stops and replay. Independent
review found no blockers and separately passed 37 focused parser/policy/drift
cases, four real dual-HMAC tamper cases, API types, touched lint and diff checks.

The unchanged full Sandbox purchase/upgrade/refund rehearsal must run again on
merged source. It must pass monthly restoration and cycle support hold, unchanged
transaction identities, replay deduplication and all cleanup readbacks. #925 stays
draft until this evidence exists. Production automatic restoration remains off;
live financial cutover requires the separate explicit approval in AGENTS.md.
