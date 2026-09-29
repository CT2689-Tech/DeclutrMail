# Product experience review — 22 September 2026

Branch: `claude/product-simplification-ideas-5a8515`.

## Summary:

Keep the approved Warm Editorial direction, five-group navigation, and right-hand sender inspector. The next improvement should make the product easier to understand and manage: clearer scope, stronger information hierarchy, useful filters, trustworthy explanations, and consistent states. Another broad style replacement would add churn before these problems are resolved.

Billing is the strongest candidate for the next detailed layout preview. It currently gives cancellation disproportionate prominence within the current-plan card, spends considerable space explaining payment management, and puts plan shopping ahead of receipts. It does not clearly show how the subscription covers the connected inboxes or which capabilities it includes.

This review inventories **18 app/onboarding route patterns and 48 public routes**, with separate recommendations in the linked inventories. Evidence combines the populated localhost account, rendered public pages, source/contracts, and existing synthetic Storybook states. It is a product/design review, not certification of every action, viewport, accessibility requirement, or billing integration. No mailbox or subscription changes were submitted.

Detailed evidence:

- [Every app screen, source references, and implementation boundaries](screen-review-app-notes-2026-09-22.md)
- [Billing findings, existing states, data contracts, and benchmarks](screen-review-billing-notes-2026-09-22.md)
- [Every public route, article, comparison, and query-state recommendation](screen-review-public-notes-2026-09-22.md)

## Strengths:

- The visual direction has a recognizable identity. The editorial type, restrained color, grouped navigation, and sender inspector can support a mature product without another theme change.
- The product already has substantial capabilities: sender search and saved views, bulk previews, historical-mail scope, protection, activity recovery, automation observation, and useful billing lifecycle handling. The next pass should expose these well and preserve their behavior.
- Real data justifies collection-management improvements. The local account has two connected inboxes and hundreds of senders/protected senders. Search, scope, counts, and readable detail matter more than additional decorative statistics.
- The public site has a complete content foundation: product explanation, pricing, demo, guides, trust answers, comparisons, policies, and support. It needs better continuity and discoverability rather than another set of pages.
- Billing already supports proration previews, deferred changes, cancellation reversal, eligible pause/resume, payment recovery, and invoice access after a subscription ends. These are assets to retain.

## Risks & Concerns:

1. **Preview and implementation can diverge again.** The approved design needs a screen/state checklist that is checked against the actual app, with screenshots at the same viewport and theme. A polished happy-state prototype alone is insufficient.
2. **Some public promises do not match behavior.** Screener reviews unfamiliar senders while Gmail delivery continues. Unsubscribe alone does not move historical mail. Delete moves mail to Trash; storage is not necessarily freed immediately. Universal claims that every change requires a preview also overstate the boundary. These inconsistencies can damage trust even if the underlying functionality works correctly.
3. **Upgrade confirmation can outpace its price preview.** Source and existing tests intentionally permit confirmation while a preview is loading or failed, using generic charge/credit wording. I recommend a successful, current preview before confirming an immediate upgrade. That is a billing behavior decision requiring focused implementation and sandbox verification, not a CSS change.
4. **Scope is often implied.** Active inbox versus all connected inboxes, daily queue versus sender library, and current inbox versus historical mail are different sets. Quiet hours and Billing need especially clear workspace scope.
5. **Visual hierarchy is uneven.** Some screens use thin editorial rows, while Billing retains large rounded cards and extensive vertical gaps. Activity has multiple controls and summaries ahead of the actual history. Public Pricing has an oversized introduction that pushes plan prices below the first 1280 × 720 viewport.
6. **Empty, loading, and recovery states need equal design attention.** Later has no direct next-step link; Brief can say an edition will arrive without useful availability guidance; some loading/error branches lose their page heading and change container width. Triage visibly switched from Focus to the saved List mode after hydration during review.
7. **Data cannot support every attractive proposal yet.** Configured plan price is not a provider-confirmed upcoming invoice. Exact refresh timestamps, complete invoice pagination, and advanced quiet-hour schedules require additional contracts. Unlimited allowance is not a measured usage total.

## Trade-offs & Alternatives:

| Choice                                         | Recommendation and trade-off                                                                                                                                                                                                                                      |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Another visual overhaul vs targeted refinement | Keep the approved direction. Improve hierarchy, spacing, controls, and state consistency. This preserves the design the user chose while addressing observed friction.                                                                                            |
| One layout everywhere vs task-specific layouts | Use three shared patterns: a wide workbench for Senders/Activity; a focused decision surface for Triage; a reading/settings surface for Brief, account pages, and public articles. Share typography, controls, and spacing without forcing identical composition. |
| More top-level navigation vs extensible groups | Keep five primary groups and contextual child navigation. Place future features by the user's task; keep exceptional/admin destinations secondary. Add section indexes for long pages rather than more global navigation.                                         |
| Richer analytics vs existing evidence          | Start with connected-inbox coverage, actual queue counts, rule status, and scoped trends. Do not invent time saved, financial ROI, storage freed, or complete activity totals.                                                                                    |
| Native billing UI vs provider controls         | Improve the local plan summary and consequences while retaining the existing provider-managed payment path. A second checkout or locally stored card details would add complexity without solving the observed issue.                                             |
| Local filters vs complete collection search    | Local filters are appropriate for the fully loaded Autopilot rules. Paginated Protected senders and Screener need accurate server-backed coverage, or a clearly scoped link into existing Senders filters.                                                        |

## Actionable Recommendations (Priority-Ordered):

P1 means the next implementation wave; P2 means the following refinement wave; P3 means optional expansion after validating the need. These are opportunity priorities, not incident severity ratings.

### Billing: proposed composition

```text
Plan & billing
Applies to this workspace and its connected inboxes

[Payment/access recovery, only when needed]

Pro · Annual                         Manage plan
Plan price                           Next renewal date

Your plan includes
2 of 5 connected inboxes              Manage inboxes →
Unlimited cleanup
Daily Brief · Follow-ups · Autopilot   Open feature →

Payment & receipts
Payment provider                     Update payment method →
Latest invoice                       Download →
Invoice history

Change plan / compare features
Billing help · Refund policy
```

The connected count and allowance should come from the account. This sketch illustrates hierarchy; it is not a new price or entitlement proposal.

1. **[P1] Make coverage explicit.** Show connected inboxes / allowance, available cleanup allowance and reset where applicable, and included capabilities. Use existing tier/entitlement data. Free/Plus allow one inbox, Pro five; this is not a per-seat charge.
2. **[P1] Make changes understandable before confirmation.** Show current → target plan, when it takes effect, known charge/credit, and feature differences. Recommend blocking immediate upgrade confirmation until a fresh provider quote succeeds. Preserve existing pending-outcome and duplicate-charge protections.
3. **[P1] Explain downgrade consequences accurately.** Existing connected inboxes continue working when over the new limit; adding another is blocked. Do not imply accounts will be disconnected or history removed. Explain capability changes using the shared manifest.
4. **[P2] Prioritize subscriber management.** Place subscription, coverage, payment, and receipts before optional plan shopping. Keep cancellation plainly discoverable within Manage plan; do not make it harder to cancel.
5. **[P2] Compress healthy payment presentation.** A concise provider row and update action are sufficient. A failed payment deserves a prominent recovery panel at the top. Do not display invented card brand or last-four digits.
6. **[P2] Make lifecycle states coherent.** For scheduled cancellation/downgrade, show present access and the future date together. For an ended subscription, group current entitlement, previous subscription, receipts, and resubscribe. Preserve eligible pause/resume and complimentary/founding distinctions.
7. **[P2] Keep an inline feature comparison.** Reuse the same manifest as public Pricing; explain the practical difference between plans without requiring navigation away from Billing.
8. **[P3] Improve invoice retrieval.** Local filtering can help the returned list. Complete history, invoice numbers, billing periods, tax/discount detail, and actual upcoming totals need contract/provider work.

**Amount labels matter:** the current plan amount is configured pricing; the renewal date comes from subscription state. Display “Plan price” and “Next renewal” separately. Do not combine them into “Your next charge is…” without a provider-confirmed upcoming amount. Immediate-change previews and historical invoices have different, provider-derived amount data.

Account coverage is also a useful competitive convention: [Clean Email's plans](https://clean.email/plans) prominently distinguish account allowances, and [Shortwave's pricing FAQ](https://www.shortwave.com/pricing/) explicitly raises whether one plan covers multiple email accounts. The inference for DeclutrMail is to explain coverage clearly, not adopt their packaging. [Paddle's update-preview API](https://developer.paddle.com/api-reference/subscriptions/preview-subscription-update/) and [customer portal](https://developer.paddle.com/concepts/sell/customer-portal/) support retaining the current architecture while improving presentation.

### Each app screen

| Screen                    | Recommended enhancement                                                                                                                                                                                                    | Priority / scope                                                 |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Home                      | Show available review work even before the first cleanup action. Keep achievements factual and avoid repeating the same Triage CTA in the main opportunity and attention list.                                             | P1; existing data                                                |
| Senders                   | Consolidate repeated headings into one compact search/filter/sort toolbar with visible active filters, matching count, and scope. Keep saved views, bulk selection, historical-mail options, and the right inspector.      | P2; existing data                                                |
| Sender detail / inspector | Group evidence into “Now” and “Pattern”; explicitly label inbox, 90-day, lifetime, and yearly-trend values. Make monthly chart values accessible. Preserve protection reasons, recent messages, timeline, and all actions. | P2; existing data                                                |
| Triage                    | Stabilize the saved mode before the visible layout settles; make Focus/List a persistent, explicit control. Label the daily queue count. Keep this screen focused on decisions.                                            | P1 stability, P2 control                                         |
| Screener                  | Explain “new to review” and visibly state that email still arrives in Gmail. Keep first-seen dates. Treat complete search/paging as a separate feature rather than filtering an incomplete local window.                   | P1 copy; broader search needs contract review                    |
| Autopilot                 | Turn Watching/Acting/Inactive counts into useful filters with All/reset. Standardize Watch first/Observe wording. Keep activation previews and the difference between a suggestion and an active rule.                     | P2; full rule list already available                             |
| Quiet hours               | Label all-connected-inbox scope and identify the active inbox. Put timezone and held-action meaning near the schedule. Link back to Autopilot.                                                                             | P1; existing data; weekdays/multiple windows are additional work |
| Daily Brief               | Add Reply/FYI/Noise section links and counts. Improve first-edition guidance using known availability, with no invented arrival time. Preserve date history and fallback/provenance information.                           | P2; existing content; exact readiness may need data              |
| Follow-ups                | Wrap subjects and offer touch-accessible expansion. Keep age buckets, Gmail links, local Mark resolved semantics, and periodic-check limitations clear.                                                                    | P1; existing full subject; exact last-checked time needs data    |
| Later                     | Add a Browse senders CTA to the empty state and show timezone near return buckets. Preserve reschedule, bring-back confirmation, retry, and existing overdue handling.                                                     | P2; existing data                                                |
| Activity                  | Bring history closer to the top. Group search and active filters with the list; distinguish weekly totals from the selected reporting period. Make support export secondary.                                               | P1; existing data                                                |
| Billing                   | Adopt the management hierarchy above and show entitlement coverage, accurate change consequences, and state-specific recovery.                                                                                             | P1/P2; mostly existing data                                      |
| Settings                  | Add a section index, keep mailbox health first, and rename the generic More group. Make preview preferences understandable with explicit labels.                                                                           | P2; existing sections                                            |
| Privacy & data            | Start with a concise factual summary and contents links, followed by the complete inventory. Keep destructive controls separate and all snippet/Brief/processor disclosures intact.                                        | P2; presentation                                                 |
| Protected senders         | Provide an obvious route into filtered Senders now; investigate complete search for this large paginated collection. Never present a loaded subset as the whole result.                                                    | P2; navigation first, full search depends on contract            |
| Help & glossary           | Search the existing glossary locally and expose Contact support at the top. Separate product definitions from operational support tasks.                                                                                   | P2; existing content                                             |
| Onboarding                | Add phase-aware orientation: Connect, Scan, First decision. Preserve real progress, branching, retries, consent, and protection review; avoid a false universal step count or ETA.                                         | P2; existing state                                               |
| Admin security            | Add the missing Clear filters action mentioned by its empty state. Verify narrow-width filters while retaining intentional table scrolling and current authorization.                                                      | P1 reset; no access changes                                      |

### Public screens and their relationship to the app

The [public inventory](screen-review-public-notes-2026-09-22.md) reviews all 48 routes individually, including each article and comparison. These are the shared changes with the highest value:

| Surface                             | Next improvement                                                                                                                                                                                                            |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Homepage                            | Demonstrate the actual sender inspector and one complete cleanup journey. Keep the approved editorial identity; use product evidence to communicate richness.                                                               |
| How it works / Methodology          | Correct Screener delivery and universal-preview claims. Explicitly separate one-time mail actions, future unsubscribe requests, and enabled automation.                                                                     |
| Pricing                             | Shorten the introduction so plans and billing interval appear earlier. Make inbox coverage and practical plan differences easy to compare; keep annual total prominent and founding availability conditional.               |
| Demo / simulator                    | Fix unsubscribe/storage teaching. Orient users to the real navigation, or clearly call this a daily-review demo. Retain real production action-sheet components and sample-data disclosure.                                 |
| Sign-in / Beta                      | Decide one consistent newcomer entry convention around the permissions checkpoint. Align Beta spacing and controls with the shared system; preserve distinct denial/inbox-limit guidance.                                   |
| Compare / alternatives              | Offer a small chooser by job: unsubscribe, clean existing mail, automate future mail, or provider compatibility. Retain balanced concessions, unknowns, and sources. Reverify volatile vendor facts before changing claims. |
| Guides / Answers / Blog             | Add hub breadcrumbs and mobile contents for long articles. Match each next-step demo link to the task. Update Delete recovery and Undo placement instructions.                                                              |
| Help / FAQ / Contact                | Lead with recover a change, reconnect an account, manage billing, and contact support. Reduce independently authored duplicate answers.                                                                                     |
| Changelog                           | Make the user-facing effect and destination clear for each entry; preserve actual publication dates.                                                                                                                        |
| Privacy / Terms / Refunds / Cookies | Improve navigation and readability while preserving meaning, exclusions, and working consent controls. Keep cancellation distinct from a refund.                                                                            |

### Cohesion and future feature additions

1. **One navigation model.** Keep the approved five groups. New features should have a clear user task and an appropriate child destination before adding a top-level item. Long screens get local contents; collections get filters.
2. **One action vocabulary.** Preserve canonical Keep, Archive, Delete, Later, Unsubscribe, and automation terms. Explain what happens now, what affects future mail, and which historical scope the user selected. The unsubscribe flow must retain historical Archive/Delete, mailbox scope, and time-period choices.
3. **One visible scope convention.** Use a concise scope line near the heading or toolbar whenever active inbox/all inboxes, period, or library/queue changes interpretation. Avoid burying this in help text.
4. **Shared visual rules with task-specific density.** Standardize type scale, button hierarchy, spacing, borders, corner radii, row heights, focus states, and semantic status colors. Keep serif display type for orientation and legible compact sans-serif controls for work. Limit large cards to content that benefits from grouping.
5. **Complete state design.** Each feature must specify loading, empty, populated, filtered-empty, error/retry, pending, and restricted states as applicable. Keep the page heading and container stable. Explain the next valid action instead of an inert empty illustration.
6. **Public-to-product continuity.** The homepage, demo, guides, and real app should teach the same journey and limitations. Shared action components and canonical claims reduce drift.

## Next Steps:

1. **Create a concrete Billing preview against the real state model.** Include active paid, Free, past due, payment unconfirmed, scheduled cancellation/change, ended, and paused states. Show desktop and narrow layouts, in light and dark. Keep the current behavior visible while separately deciding the quote-confirmation policy.
2. **Deliver a bounded clarity pass.** Correct public claims; label Screener/Quiet scope; fix Triage mode stability and Follow-up readability; add Later's next step and Admin filter reset. These have identifiable acceptance criteria and limited design ambiguity.
3. **Refine collection and reading screens.** Simplify Activity and Senders hierarchy, group sender evidence, add Autopilot filters and Brief navigation, then improve Settings/Privacy/Help indexing.
4. **Align public pages.** Bring Pricing plans higher, show the actual inspector on the homepage, connect demo lessons to guides, and add mobile article contents.
5. **Verify before declaring parity.** Review the approved preview and implementation at matching viewport/theme/state. Confirm existing unsubscribe options, bulk selection, right-hand inspector, real mailbox data, and recovery behavior. Test billing changes with sandbox fixtures and provider rehearsal as appropriate; never use live purchases for a visual pass.

Suggested implementation boundaries for parallel work: shared design/state conventions owned centrally; Billing/Pricing in one workstream; core inbox screens in another; supporting/public content in a third. Shared shell edits should have one owner to avoid inconsistent navigation or tokens.

### Acceptance and review evidence

The next pass is successful when a user can identify the active scope, find their next task, inspect a sender without losing the list, select a batch with an honest matching count, understand historical-mail consequences, find recovery, see what their plan covers, and understand a plan change before confirming it. These are observable task criteria, not claimed conversion or retention gains.

This review used:

- Populated localhost app routes with two connected inboxes, including the current Billing page and sender inspector; completed onboarding redirected to Home.
- Rendered content/heading checks across all 48 public routes, plus inbox-limit and beta-denial query examples. Representative pages received visual inspection, including Pricing above/below the fold, articles, Help, Methodology, Beta, comparisons, and the simulator. All four simulator lesson headings were observed after loading; no mailbox actions were submitted.
- Synthetic Storybook visual states for past-due/unconfirmed/ended Billing, active paid Billing at 390 px, populated Follow-ups at desktop and 390 px, mobile populated Brief/Later, and onboarding scan progress. Fixture dates/counts are examples, not current account facts.
- Source and contract review for less common states, full-detail routing, onboarding branches, pagination, entitlement behavior, and payment safeguards. Existing tests were inspected, not rerun for this documentation-only review.

Limits: no complete keyboard/screen-reader/contrast audit; no every-route-by-every-viewport screenshot matrix; no real checkout, cancellation, refund, reconnect, send, unsubscribe, or mail-moving operations. Google consent was not traversed. Competitor statements in existing public comparison pages were reviewed as content, not all freshly revalidated. The linked official billing benchmarks were checked separately. No application code or production state changed during this review.
