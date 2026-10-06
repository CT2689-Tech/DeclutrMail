# Billing recovery language audit

Owner/integration: current launch-readiness chat. Reuses its isolated 0b41
worktree after PR899 merged; new codex/billing-recovery-language is based on
freshly fetched origin/main b3e2ed26. Owns BillingScreen recovery copy, existing
caller tests, audit/log and an existing synthetic story fixture if needed. No
open billing PR overlaps. Foundation PR899 is already merged; no pending PR
dependency. No provider, money-state, permission, pricing or runtime-policy change.

Contract: on Billing, an unresolved checkout remains held while server/provider
truth is checked. The user may review recovery only when the existing policy
allows it; must check card/receipts and explicitly confirm no charge. Confirmation
clears the hold and returns to plan selection; it does not resume an earlier
transaction or start another checkout. Keeping waiting preserves the hold.
Provider-in-progress, unresolved, checking and grant-confirmation states retain
existing behavior. An unconfirmed change similarly requires explicit assertion
before returning; accepted change/resume release remains a single action.

Finding: checkout buttons promise to resume checkout, but onReleasePendingLock
only clears the local marker and releases the server claim. Existing caller tests
show plans return without a checkout call. The copied retry verbs in adjacent
change/resume recovery also exceed the three-word button budget. Repair the
labels and checkout confirmation explanation, preserving all checks and holds.

Verification: reuse existing caller tests for checking, empty, unavailable,
pre-grant and granted provider states, two-step assertion, cancel, storage release
and returned plans. Smoke the actual changed Next development build through the
existing synthetic full-page fixture, including keyboard and phone layout. Run
required static/build checks and independent design/usability/failure/flow review.
Live payments, original charge status, new Gmail access and deletion/expiry remain
outside this bounded copy repair and separately pending.

A second source-confirmed finding: returning to Free rendered “no card on file.”
The subscription read provides no stored-payment-method evidence; absence of a
subscription/hold cannot establish what the provider retains after abandonment.
Removed that unsupported statement and its sole presentation prop. Free $0,
quota and reset date remain. No card/customer lookup was added.

Independent review caught the shared notice's Paddle-specific receipt instruction.
The same notice also serves Razorpay when configured, so the prompt now refers to
bank/card statements and payment receipts. No provider capability was added.

Verification so far: 280 billing cases pass; old source fails the existing
full-recovery caller at Review checkout and the Free-card caller at the unsupported
card claim. Actual Next development synthetic browser: keyboard Return opens
review, Tab reaches Keep waiting, backing out preserves the hold, confirmation
returns the plan picker without opening checkout. At 390px viewport there was no
horizontal overflow. Final Free $0/quota render without the card claim; no console
errors. Fixtures unmounted and restored their fetch/storage, temporary routes
removed, servers stopped and viewport reset. Provider/database execution is not
claimed by these synthetic controls. Final production and Storybook builds pass, with the provider-neutral instruction
verified in the built Storybook artifact and the Next billing chunk. The built
flow returns plans; switched to Free Tier to unmount/restore the fixture and then
closed the tab. Workspace typecheck, full lint (six existing warnings), formatting,
diff check, 51 route budgets and 45 required public prerenders pass. Initial
workspace typecheck raced Next dev's generated-type cleanup; after stopping dev
and rebuilding, all workspace packages passed. Full web: 3850 passed, three
existing skips. After the receipt-only edit the final 127 screen cases pass.
Independent design/usability/type/failure/flow/defect-class review found no
remaining source blockers after the receipt correction.

| Finding                                                     | Priority | Resolution                                               |
| ----------------------------------------------------------- | -------- | -------------------------------------------------------- |
| Recovery promises to resume a transaction but returns plans | P2       | Accurate two-step action labels and outcome explanation  |
| Free card claims provider-card absence without evidence     | P2       | Claim removed; price/quota/reset information preserved   |
| Shared receipt instruction names one provider               | P2       | Bank/card statement and generic payment receipt guidance |

Bigger opportunity remains pending: redesigning abandonment/unknown-charge
recovery requires provider-backed evidence about the original checkout. This
copy repair neither expires holds nor calls an unconfirmed payment abandoned.
Original screenshot charge status, real sandbox/live purchases, production
hydration and monitoring delivery remain separate launch gaps. Local work is
verified; PR/queue/merge/web-release readback remain distinct stages.
