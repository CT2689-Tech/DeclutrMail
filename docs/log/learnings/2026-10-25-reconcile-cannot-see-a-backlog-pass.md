## 2026-10-25 — Reconcile cannot see a Backlog Pass, and email search is not proof of "no payment"

**Context:** On a complimentary Pro workspace the founder opened the Backlog Pass checkout and closed it. Billing showed "Checkout started — your plan upgrade hasn't come through yet" with "Last checked: We couldn't check with the payment provider automatically" and two buttons, about eight blocks of text.

**Finding:** `POST /api/billing/reconcile` searches subscription price ids only (`candidatePriceIds` in `billing-reconciliation.service.ts`). A Pass is a one-time transaction on its own price id, and the request contract carries no `offer`. For a Pass, `none_found` and `no_pending` therefore describe nothing: the check cannot return a true "found" for the thing the customer bought. The notice also never received `pending.offer`, so it called a Pass a "plan upgrade", and two tests pinned `confirming your plan` for a Pass lock.

Auto-releasing a plan checkout when the overlay closed and reconcile said `none_found` was built and then blocked by the design-system gate, correctly. The Paddle search is `GET /customers?email=` (exact owner email) then `GET /subscriptions?customer_id=`. Its docstring says a payer who types another email is invisible to it, and it lists subscriptions, so a charge still settling has none yet. The overlay's `checkout.closed` fires with or without payment. The two signals fail together in the one edge that matters, so they are not independent.

The server already creates the Paddle transaction before the overlay opens (`PaddleAdapter.createCheckout`, `POST /transactions`) and returns its `txn_` id, but only Razorpay's id is stored on the claim (`billing.service.ts`, `provider_ref`). The comment in `pending-checkouts.ts` saying Paddle creates the transaction client-side is out of date.

**Rule (provisional):** Never treat a reconcile `none_found` as evidence about a Pass, and never release a lock automatically on an email search. A lock may release without the customer's assertion only on direct evidence about that exact checkout: the stored `txn_` id read back from Paddle. Building that is a billing-provider change and needs its own adversarial review.

**Distillation trigger:** "promote to CLAUDE.md §8 if another one-time offer is added without a reconcile path, or if a check that cannot see its subject is found a third time"
