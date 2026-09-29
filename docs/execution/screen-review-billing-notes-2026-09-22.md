# Billing screen review — 2026-09-22

Branch: `claude/product-simplification-ideas-5a8515`. Read-only product/UX review of the branch implementation, contracts, API shaping, existing tests/stories, public pricing, and official benchmark documentation. This document is the only change made for this follow-up. No subscription/payment actions, live Paddle calls, or deployments were performed.

## Evidence and scope

The parent agent independently inspected the authenticated Billing screen at **812 × 724, dark theme**, and reported: Current plan showed Pro, $190/yr and a next-renewal date; its only button was Review cancellation. A separate tall Payment method card was mostly explanatory provider text. Plans appeared below it with Free/Plus/Pro descriptions, monthly/annual toggle, a filled Plus action and no action on current Pro. Compare plans navigated to public pricing. Invoice history showed Date/Amount/Status/Download with two paid rows. Large rounded cards and vertical spacing differed from the desired thinner editorial treatment. No workspace/multiple-inbox entitlement context was visible at the top.

Those are **parent-observed facts**, not this reviewer's independent browser verification. Other states below were reviewed in code and existing tests; they were not exercised against real billing. Existing tests were inspected, not rerun for this documentation task. Source line references describe the reviewed checkout and may move in subsequent implementation.

## Critical distinction: plan price is not a confirmed renewal charge

`apps/web/src/features/billing/billing-model.ts:28` reads prices from `TIER_MANIFEST`. `chargedPlanPrice` at line 72 selects currency from the existing subscription's provider and the configured founding annual price when applicable. `currentPlanPriceLabel` at line 430 calls that function. Despite the helper's name/comment, **the displayed amount is manifest-derived, not a provider-fetched upcoming invoice or confirmed renewal total**.

`apps/web/src/features/billing/billing-screen.tsx:1262` derives the price label; line 1275 derives the separate renewal date from the subscription's `currentPeriodEnd`, suppressing it for scheduled changes, cancellation, or pause confirmation. The rendered combination at line 1321 is a plan price alongside a renewal date. The date has server subscription-state provenance; the amount is configured plan pricing.

`packages/shared/src/contracts/billing.ts:134` does not supply actual recurring amount, currency, tax, discount breakdown, or upcoming invoice total. Therefore proposed designs should say **“Plan price: $190/year”** and **“Next renewal: [date]”**, not **“You will be charged $190 on [date]”** or **“Next invoice $190”** without additional provider data. There is no evidence here that the displayed amount differs from this customer's real bill; this is a provenance limitation, not a proven incorrect charge.

The immediate plan-change preview is different: `billing.ts:437` supplies provider-derived charge/credit amount and currency plus the next billing date. Actual invoice rows also have provider amount/currency (`billing.ts:361`). Neither supplies a complete future recurring total/tax breakdown.

## Prioritized recommendations

| Priority | Recommendation                                                                                                            | Evidence and implementation boundary                                                                                                                                                                                                                                                                                                                                         |
| -------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1       | Require a successful price preview before immediate upgrade confirmation, with loading/retry states.                      | `plan-picker.tsx:996`, `:1090`, `:1135`: Confirm upgrade currently remains enabled when the preview is loading/failed and shows generic charge-or-credit mechanics. This is intentional behavior covered by existing tests. Treat a change as an explicit billing product decision, not a silent visual refactor. Preserve ambiguity locks after a submitted change.         |
| P1       | Add workspace coverage below the plan summary: connected inboxes / allowance, cleanup allowance, links to included tools. | `auth/api/use-tier.ts:10` exposes existing `connectedInboxes`, `inboxLimit`, `cleanupRemaining`, `cleanupResetsAt`; no extra backend needed. Current summary only exposes cleanup usage for Free (`billing-screen.tsx:1344`).                                                                                                                                                |
| P1       | Explain what a downgrade changes, beyond money and date.                                                                  | `plan-picker.tsx:1040` explains deferred charge mechanics; `cancel-modal.tsx:98` explains paid-through access and completed actions. Add manifest-derived capability differences and accurate mailbox-limit consequences. Existing connections continue when over-limit; only adding is blocked (`use-tier.ts:25`). Never imply automatic disconnection of excess mailboxes. |
| P2       | Reorder paying-customer management: subscription, coverage, payment/invoices, then optional plan comparison.              | `billing-screen.tsx:689`, `:700`, `:763`; plan cards currently precede receipts. Parent browser observation confirms this hierarchy. Frontend presentation only.                                                                                                                                                                                                             |
| P2       | Compress healthy Payment method into a row with optional explanation; retain prominent past-due recovery.                 | `payment-method-card.tsx:64`, `:111`. Do not invent card brand/last-four: this component deliberately holds none.                                                                                                                                                                                                                                                            |
| P2       | Present ended subscriptions as current access plus previous subscription, invoices, and resubscribe action.               | `billing-screen.tsx:1666` already explains ended state, but separates it from the main entitlement card and lower invoice section. Use verified dates with accurate labels; `currentPeriodEnd` is not necessarily a cancellation timestamp.                                                                                                                                  |
| P2       | Put a compact, expandable current-versus-target feature comparison inside Billing.                                        | `plan-picker.tsx:642` links externally to public comparison. Existing manifest and public comparison supply feature definitions; avoid duplicating a divergent pricing model.                                                                                                                                                                                                |
| P3       | Improve receipt retrieval with local date/status filters and an explicit older-invoices support action.                   | `invoice-history.tsx:250` handles partial/omitted/truncated results. Full-history pagination is backend work, not a frontend filter over a bounded list.                                                                                                                                                                                                                     |

Paths abbreviated in this table are under `apps/web/src/features/billing/`, except `auth/api/use-tier.ts` under `apps/web/src/features/`.

## State inventory: existing functionality to preserve

| State                                              | Already supported                                                                                                                      | Useful refinement / constraint                                                                                                                                      |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Active paid                                        | Current tier/cycle, renewal date, founding and complimentary distinctions.                                                             | Coverage/value summary; keep configured price distinct from actual future invoice amount.                                                                           |
| Free                                               | Remaining cleanup units and server-provided anniversary reset date; honest no-card wording only without prior subscription.            | Explain that cleanup units count sender actions, not individual messages; do not invent paid usage totals from unlimited allowance.                                 |
| Ended / expired paid access                        | Historical subscription notice, actual current entitlement, resubscribe; invoices remain accessible.                                   | Put access, history and recovery together; no invented expiration timestamp.                                                                                        |
| Past due                                           | Prominent payment-method action and plan-change lock, with provider-specific support route.                                            | Recovery should be the first action. Do not promise access indefinitely.                                                                                            |
| Payment unconfirmed                                | Fresh/slow/unconfirmed phases, polling, provider reconciliation, guarded two-step manual release, cross-tab/server pending protection. | Shorten display into known status, next step and help. Preserve neutral language and duplicate-charge protections (`billing-screen.tsx:907`).                       |
| Cancellation scheduled                             | Paid-through date, Free transition and previewed Keep my subscription action. Refund/chargeback restrictions remain distinct.          | Show date and future entitlement prominently; keep cancellation easily discoverable.                                                                                |
| Paused / resume pending                            | Eligible Paddle pause/resume, provider confirmation and support handling for other rails.                                              | Already present; do not propose a second pause system.                                                                                                              |
| Immediate upgrade                                  | Exact prorated charge/credit preview when available; next billing date; pending outcome protection.                                    | Address enabled confirmation without a resolved preview.                                                                                                            |
| Downgrade / annual to monthly                      | Future scheduling with $0 today; current access retained; reversal of eligible scheduled change.                                       | Add capability/coverage delta without changing provider semantics.                                                                                                  |
| Invoice history                                    | Downloads/hosted links, retries, partial-provider failures, omitted rows, truncation, access after cancellation.                       | Convenient retrieval, not a new receipt system.                                                                                                                     |
| Annual / founding                                  | Annual total, effective monthly price, computed savings, founding price and cancellation consequences.                                 | Keep annual total dominant; do not hardcode universal savings across currencies.                                                                                    |
| Currency / provider                                | New-purchase quote clamped to provisioned price point; existing subscription keeps its own rail; invoices use actual currency.         | Current config contains Razorpay IDs. The old comment in `billing-model.ts:35` saying all are null is stale. No decorative currency switch unsupported by checkout. |
| Multiple inboxes                                   | Free/Plus allowance 1, Pro allowance 5; workspace entitlement; existing over-limit connections continue.                               | Add actual connected count and Manage inboxes link. Never describe this as price per inbox/seat.                                                                    |
| Complimentary / mismatched historical subscription | Resolved entitlement distinguished from subscription backing it; comp expiry and non-granting subscription states.                     | Never display the old subscription as the price paid for a higher complimentary tier.                                                                               |
| Billing disabled / read failure / malformed data   | Separate unavailable, failed and unknown states; pending money action takes precedence.                                                | Do not render missing data as Free or infer that no payment occurred.                                                                                               |

Core sources: `billing-model.ts:239`, `:430`; `billing-screen.tsx:1220`, `:1500`, `:1666`; `cancel-modal.tsx:98`; `payment-method-card.tsx:111`; `invoice-history.tsx:250`.

Existing test evidence is concentrated in `apps/web/src/features/billing/billing-screen.test.tsx`: cycle-aware badge at 2039; uncancel at 2138; pause at 2211; exact quote at 2422; failed-preview fallback at 2469; credit at 2510; deferred downgrade at 2547; ambiguous immediate changes at 2641; interrupted/cross-tab locks at 2688 onward; support/paused/mismatched/comp states at 3068 onward; malformed payload at 3519; billing-disabled state at 3570; ended-plan invoice access at 3604. These are existing test cases, not new test execution evidence.

## Existing-data improvements versus new backend work

**Available now:** entitlement tier, active mailbox count and limit, remaining Free cleanup allowance/reset, subscription status/cycle/provider/current period end, scheduled plan change, complimentary expiry, founding flag, immediate preview amount/currency, and actual invoice amount/currency/status. Layout, coverage, inline comparisons, state labels and concise help can use these without new billing architecture.

**Needs contract/adapter/service work:** provider-confirmed upcoming recurring total, tax/discount/itemized breakdown, actual subscription currency independent of rail assumptions, invoice numbers/due dates/billing periods, refund/credit classifications, and true invoice pagination. Subscription contract: `packages/shared/src/contracts/billing.ts:134`; invoices: `:361`; preview: `:437`. API subscription shaping: `apps/api/src/billing/billing.service.ts:289`; bounded invoice aggregation: `:1164`; preview result shaping: `:764`.

**Requires a separate data audit:** monthly paid usage history, monetary/time savings, and a retention-value dashboard. An unlimited entitlement is not a usage measurement. Do not manufacture “hours saved,” financial ROI, or a complete monthly activity total from the fields above.

## Narrow-screen hierarchy proposal

```text
Plan & billing
Applies to this workspace and its connected inboxes

Pro · Annual
Plan price: $190/year
Next renewal: [subscription period-end date]
[Manage plan]

Your plan includes
2 of 5 connected inboxes       Manage inboxes →
Unlimited cleanup
Brief · Follow-ups · Autopilot

Payment & receipts
Managed by Paddle             Update payment method →
Latest paid invoice           Download →
View invoice history

Change plan ▸
Billing help · Refund policy
```

Numbers here illustrate hierarchy, not additional customer facts. Replace them with existing data. Show a factual recovery panel first when there is a payment or access issue. Keep cancellation discoverable within Manage plan; this proposal does not justify hiding it. Avoid calling the configured plan price an actual upcoming charge.

## Official benchmarks checked 2026-09-22

- [Paddle subscription update preview](https://developer.paddle.com/api-reference/subscriptions/preview-subscription-update/): appropriate foundation for extending the existing provider-derived preview. Design inference: make the known charge/credit visible before confirmation. No need for another checkout SDK.
- [Paddle customer portal](https://developer.paddle.com/concepts/sell/customer-portal/): documented hosted payment management and invoice access. Design inference: keep existing server-generated payment links and concise local presentation; do not add stored card details merely for appearance.
- [Paddle portal integration](https://developer.paddle.com/build/customers/integrate-customer-portal/): authenticated customer/subscription management links. Any broader portal entry would need review of available actions and existing money-action locks.
- [Clean Email plans](https://clean.email/plans): official page prominently distinguishes 1, 5 and 10 account packages. Transfer account-coverage clarity, not competitor packaging. Dynamic price amounts were absent from fetched content, so none are quoted here.
- [Shortwave pricing](https://www.shortwave.com/pricing/): official page separates plan features and explicitly includes an FAQ about coverage across email accounts. Transfer clear entitlement explanation, not its AI quotas or seat-based pricing.
- [SaneBox pricing](https://www.sanebox.com/pricing): fetched content did not expose the plan details reliably; excluded from substantive comparisons rather than inferring prices/features.

No recommendation changes prices, provider architecture, webhook authority, live catalog, or existing subscription state. Billing behavior changes require their own explicit implementation scope and meaningful sandbox verification.
