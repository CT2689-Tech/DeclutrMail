# Sandbox charge evidence and controlled abort

Scope: isolated rehearsal scripts and manual diagnostic workflow. Root is the integration owner; no production adapter or matching rule changes. Depends on merged #924 and #926. Separate from held notice/copy #925 and the approved INR availability work.

Actual sandbox run 38086827332 bought a virtual Plus monthly subscription and upgraded it once to Pro. The refund request refused before submission because no exact original upgrade charge was bound. Its retained state remained `upgrade_pending`, with billing review pending. The delivered transaction.completed request showed the exact upgrade intent fields, a Pro debit and Plus credit, but null item proration and absent line proration. This is evidence of the webhook shape; a fresh exact transaction API read is still needed before changing the production matcher.

Cancelling the GitHub run ended the runner without final cleanup evidence. The artifact preserves that failure and is not a cleanup pass. Manual sandbox cleanup of those exact owned resources is being read back independently. No financial action was retried and no live billing action occurred.

This change adds a main-only Sandbox diagnostic workflow. It accepts only exact transaction/subscription IDs, verifies linkage through the original reserved `refund-RUN-SCENARIO@example.test` customer, then projects only timestamps, identifiers, quantities, signs and proration shape. Fixed-host GET, live-key refusal, bounded response size/deadline and safe failure output reuse the existing inspection transport. No customer email, raw custom data, signatures, card details or amounts are retained.

The rehearsal now has an authenticated, Origin-checked abort control. It stops the loop and runs the existing ownership recovery, handler drain, token revocation, destination stop, subscription stop and readback. It does not mark either case passed. A200 response accepts abort; only the final artifact/readbacks prove cleanup. A missing-binding refusal records sanitized intent timing and signed-candidate availability before preserving the refusal.

Validation: 18 inspection/evidence tests, 15 rehearsal boundary/client tests, API typecheck and touched lint passed. Independent reviewer found no material privacy, ownership or cleanup regression. Actual upgrade reversal remains unverified; #925 remains draft and restoration remains disabled.
