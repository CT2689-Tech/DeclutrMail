# ADR-0043: Warm Editorial product system

- **Status:** Accepted
- **Date:** 2026-09-22
- **Deciders:** founder, after reviewing the Editorial and Precision prototypes
- **Amends:** ADR-0042 presentation constraints; ADR-0009 palette values
- **Preserves:** D7 data boundaries, D226 action lifecycle, D227 canonical actions, existing capability and billing contracts

## Context

The founder selected Warm Editorial with the compact Precision-style sidebar and a sender inspector. The request covers the public website and the authenticated product, including existing data, filters, bulk operations, historical-email scope choices and future additions.

The active Warm Editorial prototype establishes the approved composition, including its Precision-style five-group rail. Production components and their data/action contracts remain authoritative for behavior. Passing workflow tests alone does not establish visual parity.

## Decision

1. Use shared `--dm-*` tokens for warm paper and forest surfaces in both themes. Public `--mkt-*` colors alias these tokens. Warning, danger and protection semantics remain distinct.
2. Use restrained display headings with readable sans-serif controls and evidence. Data labels have a minimum 11px size. Large type is for orientation and a few meaningful totals; compact rows carry supporting facts.
3. Use the approved fixed 72px rail: Overview, Clean up, Automations, Catch up, Activity, with Settings at the bottom. Center 44px buttons with 12px gaps and a 32px gap below the brand. Clean up contains Senders/Triage/Screener; Automations contains Autopilot/Quiet; Catch up contains Brief/Follow-ups/Later. Section navigation exposes these real routes, counts and plan gates. Hover and keyboard hints describe each rail group. At 760px and below, the same five groups form a horizontal row above the workspace, with a complete feature drawer behind the hamburger. The former expanded preference is no longer used. Feature-content breakpoints remain independent.
4. Use one sender list and a persistent inspector above the 760px mobile-shell breakpoint, including narrow desktop windows. Phone layouts open the dedicated sender page; opening the full page remains an explicit choice on desktop. Keep scope labels explicit: current inbox, recent activity and lifetime received are different quantities. Unknown values stay unknown. Keep the inspector actions visible while its evidence scrolls.
5. Retain filters, saved views, selection, pagination, protection, action previews, age/reach choices, manual unsubscribe follow-through and undo. The new composition does not replace their implementation.
6. Keep compact task pages for Triage and schedules, reading layouts for Brief/help/legal, and comparison layouts for pricing. Share typography, controls and surfaces without forcing every screen into one template.
7. Amend ADR-0042's universal one-number constraint: show additional factual measures when they help a decision, with units and periods. Do not infer opens, time saved, money saved, inbox health or successful unsubscribe delivery from unrelated fields.

## Extension rules

- New app screens start with the feature-local `EditorialPage`, `EditorialKicker` and existing `PageHeader`. Promote new primitives to shared only when there is a real second consumer.
- Use the header for orientation, a compact toolbar for search/filter/view controls, the main area for the task, an inspector for selected-item evidence, and a persistent action area only when the workflow benefits from it.
- Add navigation destinations for durable user tasks. Put account configuration in Settings and supporting detail within its feature.
- Place new feature routes within the relevant workspace group before adding another primary icon. Keep group selection active on child routes; preserve accessible names, count scopes, plan gates and prefetch behavior.
- Reuse existing button, dialog, sheet, empty/loading/error and selection primitives. Keep one action owner and one preview pipeline.
- Add representative populated, empty, loading, error and restricted states to Storybook. The theme toolbar supports both light and dark. Review narrow layouts and keyboard focus alongside the feature's normal regression checks.
- Keep public claims, prices, policy text, metadata and links independently sourced. Visual changes are not authorization to change product promises.

## Consequences

The product gains a consistent visual identity while preserving feature-specific information density. Future features have stable layout roles and token APIs. Existing workflow tests remain important but cannot replace browser review of scroll, responsive layout and action visibility.

The implementation remains on `claude/product-simplification-ideas-5a8515` for review. This decision does not authorize deployment or changes to live Gmail data.

## Parity correction

The first integration did not faithfully implement the approved rail: it retained ten feature icons, an expansion preference and a four-item mobile bar plus More. That was implementation drift, not a founder-approved design change. The corrected navigation above replaces that implementation. Home also restores the greeting, angled progress stamp, sender opportunity and attention/activity composition, using real served values instead of the prototype's fictional content. Sender framing restores the heading above both columns and a compact horizontal identity. Browser comparison with the active prototype is required in addition to regression checks.
