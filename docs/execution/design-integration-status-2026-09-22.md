# Warm Editorial integration — review handoff

Date: 2026-09-22. Branch: `claude/product-simplification-ideas-5a8515`.

## Result

The approved Warm Editorial direction now runs through the real product and public website. The compact Precision-inspired sidebar, warm paper/forest themes, restrained display headings, readable controls and persistent Sender inspector share one token system. All ten product destinations remain available; account controls retain Settings and Billing.

This is a local branch implementation for review. Main and production have not been changed. The development-only design prototype remains available for comparison.

## Scope and preservation

- Shared light/dark tokens, buttons, navigation, shell, responsive behavior and loading skeletons.
- Senders: existing search, filter axes, saved views, sorting, pagination, domain groups, checkbox/range/bulk selection and keyboard controls. Rows expose current inbox and 90-day marked-read evidence alongside lifetime received, keeping unknown values distinct from zero.
- Sender details: existing protection evidence, recommendation, recent messages, 12-month trend, correspondence, decision timeline and Gmail links. The inspector keeps one action toolbar visible while evidence scrolls; narrow layouts open the same detail implementation as a page.
- Email actions: existing preview/mutation/undo pipeline, protected exclusions, lifecycle states and manual unsubscribe continuation. Historical-email controls remain explicit. Unsubscribe offers leave/archive/delete; age choices remain selectable. Inbox + archived is available for Delete, including the unsubscribe + Delete combination. This restores production-main choice availability that the earlier simplification branch hid when counts happened to match.
- Home, Triage, Screener, Autopilot, Quiet, Brief, Follow-ups, Later, Activity, Settings, Billing, onboarding and admin presentation. Existing factual measures, feature gates, forms, error/empty states and action handlers remain in place.
- Public homepage, pricing, product stories, comparisons, articles/hubs, help/legal, authentication entry and simulator styling. Existing content, prices, routes, metadata and policy claims remain unchanged.

Detailed inventories: [Sender audit](design-sender-audit-2026-09-22.md), [app audit](design-app-audit-2026-09-22.md), [public audit](design-public-audit-2026-09-22.md).

## Automated verification

- Full web suite: **234 files / 2,865 tests passed**.
- Full shared suite: **61 files / 664 tests passed**.
- Subsequent mobile refinements passed their focused suites: sender row/list/activity 43 tests; Autopilot 63 tests; Screener/Triage focus 107 tests, followed by the final Screener 73-test rerun; final sender screen/pane 95 tests.
- Web and shared TypeScript checks passed. Changed-code ESLint, Prettier and whitespace checks passed.
- Production Next.js build passed. All **45 public prerender requirements** and **52 route bundle budgets** passed.
- Three route-specific bundle allowances increased by 1 kB after inspecting the generated bundles: Billing 185→186, Screener 180→181, Admin Security 125→126. No dependency or broad default-budget increase was introduced; shared navigation hints and factual presentation account for the small increments.

## Rendered browser verification

The integration agent inspected the production-built app in an authenticated local browser and used populated Storybook fixtures where the billing-test account selected during that review had no data. Both light and dark themes were reviewed, with desktop 1280px and phone 390px coverage; the revised Autopilot banner was also checked at 320px.

| Surface                   | Observed coverage                                                                                                                                                                                                                                                                                                                               |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Live app                  | Home, Senders and filters, Settings, Triage, Screener, Autopilot, Quiet, Brief, Follow-ups, Later, Activity and Billing rendered. Empty/restricted states matched the local account. Mobile Senders retained responsive search, navigation and controls.                                                                                        |
| Populated Sender fixtures | Selected rows; phone names/status/evidence; right inspector with known and unknown inbox counts; dedicated sender details at phone width; statistics, recent metadata and timeline; persistent actions while scrolling. Unsubscribe preview with Delete + Inbox and archived + 90 days updated its affected count without confirming an action. |
| Other populated fixtures  | Home totals, Triage focus, Screener identities, Autopilot rules/banner, Brief, Later, Follow-ups, Activity, Quiet schedule, privacy with two mailboxes, Pro Billing and onboarding sync gate.                                                                                                                                                   |
| Public pages              | Homepage, pricing, how-it-works, comparison, privacy and sign-in at desktop/mobile widths as applicable. Public simulator preview opened and cancelled.                                                                                                                                                                                         |
| Navigation                | Compact sidebar keyboard focus shows counts in its hint; Escape dismisses it. Existing expansion, drawer and route behavior retain regression coverage.                                                                                                                                                                                         |

Browser review caught and resolved squeezed phone sender names, cramped Screener identity/recommendation rows, an Autopilot banner with too little text width, and a fixed-width Triage story harness. The tested mobile layouts fit the viewport without horizontal page overflow. Browser error logs from the production route walkthrough were empty.

This is representative route-family and populated-state coverage, not a claim to have manually exercised every state or every article URL.

## Verification boundary

The initial browser review was signed into a billing-test account whose mailbox was empty and required reconnection. That was an account-selection mistake, not the state of the founder’s original workspace. A follow-up read-only local database check confirmed both original connected mailboxes and their indexed data remained intact. Restoring the existing workspace session through the already-enabled local dev-login route made the populated Home and Senders pages visible, and the account selector showed both mailboxes. No database or Gmail data restoration was necessary.

End-to-end Gmail mutations remain **unverified**. No real archive, delete, unsubscribe, protection, reconnection, checkout or subscription change was performed. Existing automated workflow tests, synthetic fixtures and the subsequent populated-route read-only check cover the visual integration. An explicitly chosen real action remains part of release acceptance. Future local visual checks must verify the displayed account and mailbox selection before drawing conclusions about missing data or connection status.

## Future additions

[ADR-0043](../adr/0043-warm-editorial-product-system.md) records the accepted system, layout roles, explicit data scopes and extension rules. New screens can reuse the feature-local Editorial page framing and shared controls, with an inspector or reading layout when useful. Storybook now includes a light/dark toolbar that also themes portal content.

Next review: inspect the actual app and public pages on this branch, then approve any final visual adjustments and the release separately.
