# New INR checkout pause

Root is the implementation/integration owner. Reuses the completed copy worktree on a fresh branch from main2778be12. Scope: shared pause policy and additive error detail, checkout service, provider preview/picker, public pricing/structured offers and switch copy, plus focused regression evidence. Independent of sandbox evidence #928 and held notices/refund copy #925.

Founder approval: pause new INR purchases until readiness is verified, while keeping existing subscriber management available. ADR-0045 records that decision. The API uses the existing known pre-claim refusal before any write/provider call; old loaded clients do not mistake the refusal for an uncertain payment. The new INR preview is blocked with reference pricing, and a missing INR promo cannot silently switch to USD or strand the chooser.

Real-service tests prove no billing-region change, checkout claim, audit event or provider call for a provisioned monthly and unprovisioned annual INR purchase, and prove existing INR cancellation still calls its own provider. Existing invoice and reconciliation tests remain. Browser-component regressions prove India defaults remain selected, no checkout/local reservation is created, explicit USD remains available, an unprovisioned promo requires an explicit USD choice, and a compatible server refusal clears the local reservation.

Public pricing explains the pause before the plan cards, retains INR prices for reference, and emits no unavailable INR Offer. Currency-switch copy tells any subscriber planning a new INR subscription to contact support before ending their current one.

Existing hosted checkout/authorization links are not revoked by this code change. No live provider action, real payment, invoice-policy implementation or existing subscription mutation occurred during verification. Exact serving release and browser evidence are tracked after required checks and the normal merge queue.

Local verification: 80 real-service tests, 164 billing/provider/pricing/structured-data UI tests, all eight workspace typechecks and touched lint passed. The built-in browser loaded an isolated bundle of the actual checkout component: INR remained selected with the confirm button disabled and zero preview confirm clicks; explicit USD selection enabled Continue. This is component evidence, separate from production serving proof. Screenshot: billing-inr-pause-preview.jpg.

The first production web build passed compilation but failed the pricing route's unchanged size budget (191.9kB/166kB). A policy constant colocated with schemas pulled billing validators into pricing. The final constant lives in a schema-free shared subpath; the budget is not raised.

Final production build and all51 route budgets passed. After the packaging change, 42 checkout/provider/structured/pricing tests, all eight typechecks and touched lint passed. Independent review confirmed no remaining implementation or copy blocker; no provider action was part of verification.
