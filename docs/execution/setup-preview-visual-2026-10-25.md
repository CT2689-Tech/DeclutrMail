# Setup and preview visual consistency — 2026-10-25

Founder request: carry the accepted app treatment into onboarding and action previews. Follow-up judgment: share the visual language while preserving calm setup, dense review and distinct confirmation hierarchy. Integration owner: this chat; isolated branch `codex/setup-preview-visual-20261025`, base `68a51d2ac`. No dependency PR. Open #1151 owns manual Delete audit/demo copy/tests; this change avoids its files.

## Design and flow contract

Use existing palette roles: canvas `#f7f6f9`, surface `#ffffff`, ink `#2b2730`, secondary `#6b6473`, purple `#6f568a`, boundary `#d8d3de`, plus existing dark equivalents. Reuse Geist/sans, 28–34px setup headings, 24px dialog titles, semibold labels/counts, clear 12px panel edges, compact supporting text and existing accessible control sizes. The wordmark/public pages retain their existing role. Preserve centered setup, modal/bottom-sheet and inline-preview layouts, footer visibility and safety colors.

```text
Setup: phase → promise/access or scan status → existing choices → next step / recovery
Preview: account → action/sender → scope + live impact → recovery → Confirm / Cancel
```

Onboarding gains the existing content typography scope; its centered shell and scan shell share presentation CSS. App previews receive narrowly scoped style overrides so body portals are covered without changing public demos. Existing layout breakpoints, control order, disabled/busy states, focus trap, irreversible-action initial Cancel focus, Escape and safe areas remain authoritative. No counts, copy policy, defaults, scope, provider execution, onboarding state, OAuth, consent, entitlements, persistence or Undo change.

Verify desktop, 320px phone, light/dark and reduced-motion behavior using synthetic fixtures and a production web/API stack. Cover pre-auth promise/connect without starting OAuth; goal/rule selection and scan/recovery states; modal and inline Archive/Delete/Unsubscribe/Later, long/expanded details, busy/error/zero/disabled states and Cancel/focus return. Existing suites cover states not manually exercised. No real mailbox action, signup grant or payment is needed for evidence. Consistency and behavior checks do not establish better user task completion.

## Review and verification

- Production web build, route generation and bundle budget passed. Storybook build passed. Repo typecheck passed; lint had zero errors and six pre-existing unused-disable warnings. Web regression run passed 1,253 tests across 70 files; shared regression run passed 955 tests across 88 files. A focused independent review passed 164 tests across six files. The final first-triage layout was also exercised in the production build at 1280px and 320px.
- Browser verification used Codex's built-in browser against a disposable localhost PostgreSQL/Redis fixture with a synthetic mailbox. The authenticated goal/rules screen, review screen, Cleanup sender and action previews were observed at desktop and 320px. Setup choices, promise/connect, scan/recovery and special preview states were inspected in isolated stories without starting OAuth or any provider action. Screenshot evidence is in `docs/qa/setup-preview-visual-2026-10-25/`.
- At 320px, first review now gives the heading and explanation a full row and places Finish review and Skip setup beneath them. The modal Archive/Delete/Later/Unsubscribe previews keep account, scope, specific impact, recovery and Cancel legible; the expanded review's actions remain visible at 320×568. Inline Archive fits 320px after making its story wrapper responsive. Both themes were inspected. Delete and Unsubscribe retain their distinct warning colors.
- In the real synthetic UI, Cancel closed Delete and Archive and returned focus to the initiating action; Escape closed Archive and returned focus. No destructive confirmation was clicked. Before and after previews, the disposable DB remained at three mail messages, 50 pre-existing action jobs and zero activity entries. No worker or provider credentials were present.
- Independent visual/source review found no blocking issue. An initial mobile capture exposed a cramped first-review header; the wrap fix and final screenshot resolved it. A generic-dialog scope advisory was resolved by limiting the preview CSS to `data-dm-preview-sheet` and inline preview markers.

The signed-out `/onboarding` route currently redirects to sign-in because the soft pre-auth `/api/auth/me` probe invokes the API client's terminal-401 redirect. This behavior predates the visual work. Promise and Connect were therefore verified as isolated components, not as a complete cold-signup journey. The browser-render Playwright spec could not start because this machine lacks the required Playwright headless executable; the actual built-in-browser checks above provided the desktop/mobile evidence. No change to authentication, OAuth or consent behavior was made in this pass.
