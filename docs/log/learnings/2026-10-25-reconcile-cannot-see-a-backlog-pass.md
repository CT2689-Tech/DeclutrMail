## 2026-10-25 — Reconcile cannot see a Backlog Pass

**Context:** On a complimentary Pro workspace the founder opened the Backlog Pass checkout and closed it. Billing showed "Checkout started — your plan upgrade hasn't come through yet" with "Last checked: We couldn't check with the payment provider automatically" and two buttons, about eight blocks of text.

**Finding:** `POST /api/billing/reconcile` searches subscription price ids only (`candidatePriceIds` in `billing-reconciliation.service.ts`). A Pass is a one-time transaction on its own price id, and the request contract carries no `offer`. For a Pass, `none_found` and `no_pending` therefore describe nothing: the check cannot return a true "found" for the thing the customer bought. The notice also never received `pending.offer`, so it called a Pass a "plan upgrade", and two tests pinned `confirming your plan` for a Pass lock. Separately, the overlay's `checkout.closed` fires with or without payment, so the close alone is not proof either.

**Rule (provisional):** Never treat a reconcile `none_found` as evidence about a Pass, and never auto-release a Pass lock on it. Auto-release of a tier checkout requires two independent signals: the overlay closed in this tab, and `none_found` from the provider. Making a Pass releasable the same way needs reconcile to search Paddle transactions for the Pass price and project through the webhook path. That is a billing-provider change and needs its own adversarial review.

**Distillation trigger:** "promote to CLAUDE.md §8 if another one-time offer is added without a reconcile path, or if a check that cannot see its subject is found a third time"
