# ADR-0035: The merchant-of-record split decides who owns each billing artifact — and it is not symmetric

- **Status:** Accepted
- **Date:** 2026-08-16
- **Deciders:** founder, Claude (agent)
- **Related D-decisions:** D117 (Paddle international + Razorpay India), D119
  (billing screen layout — payment method + invoice blocks), D7/D228 (no
  storage beyond what the purpose requires), D121 (30-day money-back)

## Context

D117 splits billing by region: Paddle for international, Razorpay for India.
The phrase "merchant-of-record" appears throughout the codebase — the schema
header (`packages/db/src/schema/billing-customers.ts:11`), the contract header
(`packages/shared/src/contracts/billing.ts:25`), the guardrails runbook — but
only ever as a **routing** note. It has never been treated as a constraint on
what we are allowed to build.

It is one. The two rails are not two implementations of one relationship:

- **Paddle is the merchant of record.** Paddle is the legal seller. Paddle
  issues the tax invoice, holds the payment instrument, and sends the receipt
  email. Our name appears on it (`PADDLE.NET* DECLUTR`), but the document is
  Paddle's.
- **Razorpay is not.** Razorpay is a payment aggregator. For Indian customers
  **we** are the seller of record, which means the GST invoice obligation is
  ours, not Razorpay's.

So the same three user-visible affordances — see the card, change the card,
download the invoice — have different owners, different APIs, and in one case
no self-serve path at all. D119's specced layout
(`docs/execution/Implementation-Plan.md:3038`) drew them as symmetric:

```
│  View all in Paddle portal → / Razorpay portal →     │
```

That line assumes a parity that does not exist, which is part of why the block
never shipped.

The asymmetry is already visible in the code, unnamed:

| Site                                                    | What it shows                                                                                                                                                       |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/billing/paddle.adapter.ts`                | Never reads `management_urls` or `/transactions`. No portal, no invoice, no instrument.                                                                             |
| `apps/api/src/billing/razorpay.adapter.ts:575`          | Reads `/v1/invoices?subscription_id=` — but only to detect refunds, never for a customer-facing list.                                                               |
| `apps/web/src/features/billing/billing-model.ts:442`    | `past_due` → _"update your payment method with the provider"_, linking nowhere.                                                                                     |
| `apps/web/src/features/billing/billing-screen.tsx:1496` | The same dead-end sentence, a second time, on the non-backing row.                                                                                                  |
| `apps/web/src/features/billing/billing-screen.tsx:1503` | Razorpay resume is **already** a typed refusal with support-assisted copy. The precedent for handling an absent rail honestly exists — it just was not generalized. |

Both `past_due` sentences were written provider-agnostically precisely because
nobody had decided what "with the provider" resolves to on each rail. The
customer is told to do something and given no way to do it — on the one status
where failing to act ends their subscription.

## Decision

**We surface provider-owned billing artifacts. We never reproduce them.**

Every billing artifact affordance resolves per-provider through the
`BillingProvider` seam and returns a **typed capability**, including an
explicit "not supported on this rail" variant that the frontend renders as an
honest support-assisted state.

| Affordance            | Paddle                                                   | Razorpay                                               |
| --------------------- | -------------------------------------------------------- | ------------------------------------------------------ |
| Payment-method update | Provider-hosted session URL, minted per click            | **Unsupported** — typed refusal, support-assisted copy |
| Invoice list          | `GET /transactions?subscription_id=…`                    | `GET /v1/invoices?subscription_id=…`                   |
| Invoice document      | Paddle-issued PDF via a signed URL fetched at click time | Razorpay-hosted `short_url`                            |
| Tax invoice owner     | Paddle                                                   | **DeclutrMail** — GST, currently unowned               |

Five rules follow, and they bind every future change to this surface:

1. **We never generate an invoice document.** Paddle's is the legal tax
   document. A second artifact of ours would be non-authoritative and would
   invite exactly the reconciliation question it appears to answer.
2. **We never persist payment-instrument details.** Brand, last four, and
   expiry may be _displayed_ from a live provider read; none of it is written
   to our database.
3. **Provider capability is typed, never nullable.** An unsupported affordance
   returns an explicit variant the FE must handle. `null` would let a missing
   capability and a failed read render identically — the defect class the
   billing screen's derive layer (ADR-0027) exists to prevent.
4. **Session and signed URLs are minted per click and never cached.** They are
   short-lived and customer-specific, so they must not enter a TanStack Query
   cache with a `staleTime` or a server-rendered payload.
5. **Invoice data is proxied on read, never persisted.** A local copy is a new
   dataset with its own retention question, duplicating something the provider
   already keeps authoritatively.

## Alternatives considered

- **Generate our own invoice PDFs for both rails** — rejected: for Paddle it
  duplicates the legal document with a non-authoritative one; for Razorpay it
  is the right long-term answer but is a GST/CA decision (place of supply,
  SAC code, CGST/SGST vs IGST), not an engineering one. Named as a follow-up
  rather than guessed at.
- **Persist invoices locally on webhook** — rejected: new dataset, new
  retention window, new privacy-page line, to duplicate a provider-held
  artifact. Costs more than the availability it buys.
- **Hide the invoice section for Razorpay** — rejected backwards: Indian
  customers need invoices _more_ than Paddle customers, because we are their
  seller of record.
- **Render a disabled "Update card" button on Razorpay** — rejected as a §10
  fake-completion: a control whose only possible outcome is a refusal.
- **Route Razorpay payment-method changes through a re-authorized mandate
  in-app** — deferred, not rejected. It is a real flow, it moves money, and it
  belongs in its own decision rather than riding this one.

## Consequences

### Positive

- The two `past_due` dead ends get a real destination on the rail that has one,
  and an honest one on the rail that does not.
- No legal-document duplication, and no card data in our database.
- The Razorpay payment-method gap becomes a _stated_ product limitation
  instead of an undiscovered one, matching how Razorpay pause and resume are
  already handled.

### Negative

- The invoice list is unavailable while a provider is unreachable. Accepted:
  it is a read-only convenience, both providers email receipts independently,
  and the alternative is owning a copy of their ledger.
- Two code paths per affordance, permanently. The seam already exists, so this
  is a cost we are extending rather than introducing.

### Neutral

- India GST invoicing remains unowned. This ADR does not solve it; it names it
  and moves it out of the implicit-assumption category. Recorded in
  `FOUNDER-FOLLOWUPS.md`.

## Implementation notes

- Extend `BillingProvider` (`apps/api/src/billing/billing-provider.interface.ts`)
  with `paymentMethodSession()` and `listInvoices()`. Both adapters implement
  both; neither throws a not-implemented stub.
- Contracts as Zod schemas in `packages/shared/src/contracts/billing.ts`,
  alongside the existing billing transport types.
- Endpoints carry the D156 rate limiter: each call hits a provider live, and
  both are user-triggered per click.
- Cover **both** providers when listing. `billing_customers` is unique on
  `(workspace_id, provider)`, so a workspace that switched region holds rows
  under both — the list must not key off the current backing subscription's
  provider alone.

## References

- ADR-0027 — billing presentation state (the derive layer this renders through)
- ADR-0033 — one definition of "live" (the five-surface precedent for naming an
  unstated invariant)
- `docs/execution/Implementation-Plan.md:3038` — D119's specced layout
- `docs/superpowers/specs/2026-07-27-resend-email-surface-design.md:482` — where
  this surface was deferred as "own scope"
