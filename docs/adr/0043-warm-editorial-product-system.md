# ADR-0043: Warm Editorial product system

- **Status:** Accepted
- **Date:** 2026-09-22
- **Deciders:** founder, after reviewing the Editorial and Precision prototypes
- **Amends:** ADR-0042 presentation constraints; ADR-0009 palette values
- **Preserves:** D7 data boundaries, D226 action lifecycle, D227 canonical actions, existing capability and billing contracts

## Context

The founder selected Warm Editorial with the compact Precision-style sidebar and a sender inspector. The request covers the public website and the authenticated product, including existing data, filters, bulk operations, historical-email scope choices and future additions.

The prototype establishes visual direction. Production components and their data/action contracts remain authoritative for implementation.

## Decision

1. Use shared `--dm-*` tokens for warm paper and forest surfaces in both themes. Public `--mkt-*` colors alias these tokens. Warning, danger and protection semantics remain distinct.
2. Use restrained display headings with readable sans-serif controls and evidence. Data labels have a minimum 11px size. Large type is for orientation and a few meaningful totals; compact rows carry supporting facts.
3. Default desktop navigation to a 72px icon rail. Preserve the saved expanded preference and all existing destinations. Hover and keyboard hints include plan gates and counts. At 760px and below, use the complete drawer and bottom navigation. Feature-content breakpoints remain independent.
4. Use one sender list and a persistent inspector. Keep scope labels explicit: current inbox, recent activity and lifetime received are different quantities. Unknown values stay unknown. Keep the inspector actions visible while its evidence scrolls.
5. Retain filters, saved views, selection, pagination, protection, action previews, age/reach choices, manual unsubscribe follow-through and undo. The new composition does not replace their implementation.
6. Keep compact task pages for Triage and schedules, reading layouts for Brief/help/legal, and comparison layouts for pricing. Share typography, controls and surfaces without forcing every screen into one template.
7. Amend ADR-0042's universal one-number constraint: show additional factual measures when they help a decision, with units and periods. Do not infer opens, time saved, money saved, inbox health or successful unsubscribe delivery from unrelated fields.

## Extension rules

- New app screens start with the feature-local `EditorialPage`, `EditorialKicker` and existing `PageHeader`. Promote new primitives to shared only when there is a real second consumer.
- Use the header for orientation, a compact toolbar for search/filter/view controls, the main area for the task, an inspector for selected-item evidence, and a persistent action area only when the workflow benefits from it.
- Add navigation destinations for durable user tasks. Put account configuration in Settings and supporting detail within its feature.
- Reuse existing button, dialog, sheet, empty/loading/error and selection primitives. Keep one action owner and one preview pipeline.
- Add representative populated, empty, loading, error and restricted states to Storybook. The theme toolbar supports both light and dark. Review narrow layouts and keyboard focus alongside the feature's normal regression checks.
- Keep public claims, prices, policy text, metadata and links independently sourced. Visual changes are not authorization to change product promises.

## Consequences

The product gains a consistent visual identity while preserving feature-specific information density. Future features have stable layout roles and token APIs. Existing workflow tests remain important but cannot replace browser review of scroll, responsive layout and action visibility.

The implementation remains on `claude/product-simplification-ideas-5a8515` for review. This decision does not authorize deployment or changes to live Gmail data.
