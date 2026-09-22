# Warm Editorial integration — review handoff

Date: 2026-09-22. Branch: `claude/product-simplification-ideas-5a8515`.

## Result

The Warm Editorial integration runs through the real product and public website, but the initial completion report overstated its fidelity to the approved prototype. Follow-up review exposed a wrong account selection, a missing narrow-desktop inspector, and navigation/composition differences. The corrections below supersede those parts of the initial report. Shared tokens and passing tests do not, by themselves, establish design parity.

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

## Sender inspector parity correction

The first integration retained the old >1100px detail-panel condition even though the approved prototype kept the inspector above 760px. This meant the founder’s 812px desktop window navigated to a standalone sender page. The original visual review did not exercise this row-click transition at the actual review-window width.

The inspector now shares the desktop shell’s 760px boundary. Loading and loaded workspaces share column proportions; container-based compact rows preserve readable identities when expanded navigation narrows the list. Existing actions, detail data and the explicit full-page link retain their owners.

A regression reproduced failure at 761, 812, 1024 and 1100px before the fix and passes afterward. Browser verification on the original populated 812px window confirms row click opens details beside the list, switching rows updates the panel, closing preserves the list, and the layout remains usable with expanded navigation. A 390px check retains dedicated-page navigation. Tests: 109 screen/pane/app-shell, 30 row/list and 14 shared shell/sidebar tests passed; web/shared typechecks and scoped lint passed. No Gmail action was executed.

## Sidebar and composition parity correction

The founder correctly challenged the sidebar after the initial handoff. The previous review verified functional behavior and representative layouts, but did not adequately compare the active final prototype with the real implementation. The prototype's active `.iconRail` has five groups; the implemented rail had ten feature icons. The earlier expanded-sidebar preference was also an implementation carryover, not an approved design requirement.

| Area                    | Drift found                                                 | Correction                                                                                                                             |
| ----------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop navigation      | Ten feature icons, expansion toggle, different spacing      | Fixed 72px forest rail, five approved groups, centered 44px buttons, 12px gaps, warm active marker and bottom Settings shortcut        |
| Existing feature access | Prototype grouping had not been translated into real routes | Section navigation for Senders/Triage/Screener, Autopilot/Quiet, and Brief/Follow-ups/Later; counts, tier labels and prefetch retained |
| Mobile navigation       | Four bottom destinations plus More                          | Same five groups across the top; complete ten-route drawer and account controls retained                                               |
| Home                    | Generic page heading and progress/CTA card                  | Editorial greeting, factual angled progress stamp, sender opportunity module, attention links and activity block                       |
| Sender composition      | Heading only above the list, oversized vertical identity    | Heading above both columns, horizontal identity, compact counts and ruled evidence; existing panel/actions retained                    |
| Home sender links       | New preview links initially targeted full detail pages      | Links use the existing `?sender=` inspector route; phone layouts retain dedicated detail pages                                         |

Browser comparison used the active Warm Editorial prototype and the real original workspace. Checked the desktop rail and Home/Sender composition, 44×44 rail geometry, parent selection on Quiet and Later, Brief's three child routes, the complete mobile drawer, and the 390px light-theme Sender layout. Both original mailboxes remain available. No real Gmail action was performed.

The final Home-to-Sender walkthrough caught inherited scroll position in the shell's nested scroller, which clipped the destination heading. Route changes now reset that scroller; query-only selection changes preserve position. A new regression failed before the fix and passed afterward; the 51-test shell/chrome rerun passed. Browser readback at the original 812px window confirms the full heading and the inspector are visible together when entering from Home, and the bottom Settings shortcut opens Settings.

The implementation deliberately retains real account switching, connection state, plan gates, exact data scopes, production filter controls and the full detail/action pipeline. These are absent or simplified in the fictional prototype. This correction is a targeted parity check of navigation, Home and Sender framing; it does not certify every public page or every product state as visually identical.

Current automated checks: **2,882 web tests** and **667 shared tests** passed; web/shared typechecks passed. Navigation tests cover all ten underlying routes, active groups, child counts and gates, prefetch, Settings/brand actions, drawer focus/Escape, route fade and Undo overlap reservation. The production build, all **45 public prerender requirements** and all **52 route bundle budgets** passed without changing the existing budgets.
