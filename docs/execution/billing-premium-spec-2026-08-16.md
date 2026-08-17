# Billing: from minimum to premium — build program

**Date:** 2026-08-16 · **Branch:** `claude/billing-page-improvements-xok3nc`
**Founder scope decision (2026-08-16):** sections 1, 2, 3 and 5 below are in.
Section 4 (tax IDs, billing email, company details, India GST) is **out** of
this program.

---

## 1. Where the surface actually stands

`/billing` today renders a current-plan card, a plan picker, cancel / pause /
resume-cancellation, a scheduled-change notice, and a genuinely thorough
pending-payment reconciliation machine (D249). What it does not have, its own
header comment states (`billing-screen.tsx:116`):

> `No payment-method / invoice sections at beta: the BE exposes no portal or invoice surface yet (D119's full layout lands with it).`

D119's specced layout (`Implementation-Plan.md:3038`) drew a `Payment method`
block and an `Invoices` block. Neither shipped. The 2026-07-27 Resend spec
deferred them explicitly: _"D119 portal / invoice surface — adjacent to pause,
own scope."_ This document is that scope.

**Two live dead ends** motivate PR A above everything else. A `past_due`
customer is told to _"update your payment method with the provider"_ and given
no link — at `billing-model.ts:442` and again at `billing-screen.tsx:1496`.
That is the one status where not acting ends the subscription.

---

## 2. The governing constraint

**ADR-0035** — the merchant-of-record split is not symmetric. Paddle is the
legal seller and owns the invoice, the instrument and the receipt; Razorpay is
an aggregator and we are the seller of record for India. Every affordance here
resolves per-provider through a typed capability, with an explicit
"unsupported on this rail" variant. Read the ADR before touching adapter code.

---

## 3. PR program

Each row is one PR on the designated branch. `Closes` names the D-decision;
D-candidates marked ⚠️ need founder ratification into the plan before their PR
opens (CLAUDE.md §11 — a D-number is something you ask "is it built yet?"
about).

| PR    | Ships                                                                                 | Closes  | Depends on |
| ----- | ------------------------------------------------------------------------------------- | ------- | ---------- |
| **A** | Payment method + invoice history; both `past_due` dead ends fixed; ADR-0035           | D119    | —          |
| **B** | Exact next charge: amount, tax, instrument, date                                      | ⚠️ D255 | A          |
| **C** | Card-expiry pre-emption (screen + 14-day email)                                       | ⚠️ D256 | A          |
| **D** | Dunning as a designed state — retry schedule, grace window                            | ⚠️ D257 | A, C       |
| **E** | Proration shown inline on the picker, before the click                                | D120    | B          |
| **F** | Billing-period value receipt; founding-member counterfactual; inverted quota          | ⚠️ D258 | —          |
| **G** | Reason-matched save offers (existing prices only)                                     | ⚠️ D259 | —          |
| **H** | Cancellation receipt + data continuity                                                | D118    | G          |
| **I** | Craft pass: year archive, currency statement, print stylesheet, keyboard, one-page IA | D119    | A, B, F    |

**Deferred to post-launch — self-serve refund inside the 30-day window.**
Founder decision, 2026-08-16. It sits in section 3, but it is the only
irreversible money-mover in the set and CLAUDE.md §9 makes refund behaviour a
stop-and-ask, so it was raised rather than built. The answer is to document it
now and revisit after launch; until then the published 30-day guarantee is
honoured by emailing support, which is the behaviour today.

Whoever picks it up needs two things this program deliberately did not decide:
an abuse policy (one per customer? first period only?) and a D-number. The
machinery it would ride already exists — D253's refund-settling state, the
`cancel_source` verdict, and the reconciliation sweep — so the work is the
policy, not the plumbing. Everything else in section 3 proceeds without it.

---

## 4. PR A — the foundation, in detail

### Backend

Extend `BillingProvider` (`apps/api/src/billing/billing-provider.interface.ts`):

- `paymentMethodSession(providerSubscriptionId, providerCustomerId)` → a typed
  union: `{ kind: 'url'; url: string }` or
  `{ kind: 'unsupported'; reason: 'razorpay_no_self_serve' }`. Never `null` —
  see ADR-0035 rule 3.
- `listInvoices(providerSubscriptionId)` → normalized rows: `issuedAt`,
  `amount` (lowest currency unit, matching the existing
  `formatProviderAmount` convention), `currencyCode`, `status`, `provider`,
  and an artifact reference (Paddle transaction id / Razorpay `short_url`).
- `invoiceDocumentUrl(transactionId)` — Paddle only; minted per click.

Both adapters implement all three. No throwing stubs (§10).

New endpoints on `billing.controller.ts`, behind the existing auth guard and
the D156 rate limiter (each hits a provider live, per click):

- `GET  /api/billing/invoices`
- `GET  /api/billing/invoices/:id/document`
- `POST /api/billing/payment-method/session`

Contracts as Zod schemas in `packages/shared/src/contracts/billing.ts`.

**Both providers, always.** `billing_customers` is unique on
`(workspace_id, provider)`, so a workspace that switched region holds rows
under both. The invoice list unions across the workspace's customer rows; it
must not key off the current backing subscription's provider.

**No persistence.** Invoices are proxied on read (ADR-0035 rule 5). No
migration in this PR.

### Frontend

Two sections in `billing-screen.tsx`, rendering only from derived state
(ADR-0027 / A6 — nothing reads the raw subscription row for plan facts). PR 3
design freeze applies: existing tokens and section shapes, no new visual
language.

Both `past_due` sentences gain a real destination. On `past_due` the
payment-method action is the screen's **primary** affordance, not a section
further down.

### State table (CLAUDE.md §8 — written first, carried into the PR body)

| State / transition                   | UI shows                                                                                                              | Cache effect                    | Tested?      |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ------------ |
| Never subscribed (free, no record)   | No invoice section at all                                                                                             | —                               | unit         |
| **Free but previously paid**         | Invoices still reachable — the tax need outlives the subscription                                                     | —                               | unit         |
| Active, first period, not yet billed | Invoice section with an empty state, not an error                                                                     | —                               | unit         |
| Active, ≥1 invoice                   | List + per-row document link                                                                                          | no `staleTime` on document URLs | unit + story |
| `past_due` (Paddle)                  | Payment-method update as primary CTA                                                                                  | invalidate on return            | unit + story |
| `past_due` (Razorpay)                | Support-assisted copy, no dead button                                                                                 | —                               | unit + story |
| `paused`                             | Invoices visible; payment method visible                                                                              | —                               | unit         |
| `cancel_scheduled`                   | Both visible through period end                                                                                       | —                               | unit         |
| Canceled after refund / chargeback   | Invoices visible (the charge happened); no payment-method CTA                                                         | —                               | unit         |
| Billing dark (503)                   | Neither section renders                                                                                               | —                               | unit         |
| Provider unreachable                 | Real error state with retry — never an empty list reading as "no invoices"                                            | no negative caching             | unit + story |
| Workspace with both provider rows    | Union of both, each row labelled by provider                                                                          | —                               | unit         |
| Checkout pending in flight           | Payment-method session withheld; the portal can initiate a payment and the double-charge lock exists for exactly that | —                               | unit         |
| Document URL expired mid-session     | Re-mint on click, never a 403 surfaced raw                                                                            | never cached                    | unit         |

### Out of scope for PR A

Invoice persistence · our own PDF · card data storage · any change to the
pending-checkout / D249 reconciliation machinery (read it, don't refactor it —
§1.3) · Razorpay mandate re-authorization.

---

## 5. Notes carried into later PRs

- **PR B and C ride the same Paddle subscription read that PR A introduces.**
  Sequence them after A and they are cheap additions, not three integrations.
- **Two Paddle API facts need sandbox verification before B and C commit to
  them:** that the next transaction is exposed with its tax breakdown, and
  that the payment instrument's expiry month/year is readable. Both are
  believed available; neither has been exercised from this repo.
- **PR G offers existing prices only** (founder decision, 2026-08-16): annual
  switch or step-down to Plus for `too_expensive`, pause for
  `not_using_enough`, a clean exit for `found_another_tool`, and the storage
  list plus export for `privacy_concerns`. No coupons, no new price points,
  nothing to provision in Paddle. One offer, never a gauntlet.
- **PR F needs no new instrumentation** — the Activity ledger and
  `weekly-value-receipt.worker` already hold the data; F scopes it to the
  billing period.

## 6. Billing work outside this program

Open, unrelated to the premium surface, recorded here so the program is not
mistaken for "billing is done":

- Refund settling just before a renewal can miss it (6-hourly verdict sweep);
  ~10 lines plus its own smoke.
- A verdict on a `past_due` row may be unenforceable — needs one answer from
  Paddle support, not code.
- A won dispute recovers entitlement but leaves our own cancel standing.
- `adjustment.updated` prod destination needs adapter code.
- No human-readable surface over `cancel_source` (refund vs chargeback vs
  ordinary churn).
- Razorpay self-serve pause and resume remain typed refusals.
- India GST invoicing is unowned (ADR-0035, §Neutral).
