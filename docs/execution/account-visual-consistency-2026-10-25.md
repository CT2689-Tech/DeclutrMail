# Account visual consistency — 2026-10-25

The founder explicitly requested the accepted app visual treatment for Settings and Plan & billing. Scope: presentation, including Settings subpages; existing account/payment data, state gates, deep links, controls, confirmations and deletion/checkout behavior remain authoritative. Integration owner: this chat, isolated branch `codex/account-visual-consistency-20261025`, base `faed5664e`. No dependency PR. Open billing PRs #1139/#1131 own billing-screen/plan-picker behavior; this change avoids those files and owns the separate billing CSS module, Settings presentation primitives/styles, app appearance scope and Storybook theme parity.

## Design and flow contract

Reuse the approved palette and tokens: canvas `#f7f6f9`, surface `#ffffff`, ink `#2b2730`, secondary `#6b6473`, purple `#6f568a`, boundary `#d8d3de`, with existing dark equivalents. Match the app's Geist/sans role, 28–34px title, 24px section headings, semibold labels/current plan, clear 12px panel edges, compact spacing and tabular values. Keep the existing grouped preference rows and quiet plan rail. Make Gmail health and current access the respective visual anchors; no new dashboard cards or decorative metrics.

```text
Settings:       Title + billing link → section links → grouped preferences | plan rail
Plan & billing: Title + scope → section links → current access → coverage / payment / plans
```

The existing route-level appearance wrapper gains Settings and billing only; Home/public/onboarding retain their existing scopes. Storybook uses matching app theme roles for account stories. No copy, pricing, entitlements, provider adapter, account deletion, OAuth, analytics, API, schema or dependency change.

Verify real isolated web/API with synthetic account data on desktop, 320px phone and dark mode. Cover preference layout/selection, navigation/deep-link focus, privacy/help/protected siblings, billing current-access variants and payment history/error/loading states via existing suites/stories. No live payment provider, purchase, plan mutation, consent change, mailbox connection, export or deletion is needed for visual evidence. Use a read-only production smoke after normal review/queue merge; keep that separate from local proof.

## Implemented and verified

The account routes now inherit the same existing appearance role as the main workspaces. Settings keeps its grouped rows and plan rail, with tighter header/section spacing, semibold row labels, 12px group corners and a single accent on Gmail accounts. Billing uses the same title/description scale, section spacing, current-access emphasis and panel corners. Existing warnings, selected/disabled controls and focus states retain their owners and colors. No handlers, reads, query scope, prices or permission gates changed.

Browser smoke used a real production web build with a disposable API/Postgres/Redis stack and the fixed synthetic account. Desktop1280px and phone320px covered Settings, Plan & billing, Privacy/data, Help/glossary and Protected senders. Light/dark captures show matching typography and contained controls. Phone document width stayed320px. Settings' Preview layout and billing's Compare plans anchors moved focus to the correct existing section. A keyboard change from Separate window to Inline persisted after refresh; the original Separate window preference was then restored and verified. No production setting, payment, connection, export, consent or deletion was changed.

Existing isolated Storybook fixtures additionally verified readable past-due/payment-method warnings and the unknown-billing recovery state at320px. Payment history's empty state rendered without implying a purchase. Other subscription/checkout/loading/failure states remain covered by the existing tests and stories; they were not all manually exercised. Home and public Pricing were inspected after account navigation and had no appearance marker; public Pricing also had no app-theme marker.

Two background RSC prefetch errors appeared for the existing `/quiet` redirect during local navigation. A direct read of `/quiet` successfully rendered its existing `/autopilot/settings` destination, with no visible alert or API exception. These are retained as local prefetch observations, not claimed as a new presentation defect or hidden as a clean-console result.

Validation:

- Existing Settings, billing, theme and chrome selection:658 tests passed across40 files.
- Full shared suite:955 tests passed across88 files, including the copy glossary guard.
- Production web build and all49 route budgets passed; repository typecheck/lint passed (six existing unused-disable warnings). Storybook production build and formatting/whitespace checks passed.
- Independent source, design, safety and regression review:323 focused tests passed; final desktop/phone/dark and warning/recovery captures reviewed with no actionable findings. The narrow current-plan typography selector was checked against the current card markup and active #1139 diff; that PR does not restructure the card.
- React review: no new hooks/state/requests/dependencies, semantic controls/focus preserved, CSS-only presentation extraction, no new client waterfall.

[Synthetic QA captures](../qa/account-visual-consistency-2026-10-25/) are committed; production captures remain private. PR/queue checks, deployment and production verification remain separate release evidence.

No extra feature or data addition is needed for the requested visual pass. Payment behavior in #1139/#1131 and broader product changes remain outside this change.
