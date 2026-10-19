# Delete preview: targeted layout A pass

Scope approved in the cleanup prototype chat: change the Senders Delete confirmation only, shared by the sender list, sender detail and bulk Senders actions. Preserve current defaults and execution behavior. Other actions, Triage, Screener and Autopilot are outside this patch. Owner/integration owner: this chat. Base: `07dc458a0df0673d8fe9fd5b00749d8feee48867`. No dependent PRs.

## Change

Delete uses the existing review layout with Email age, explicit older-than labels, a local approximate cutoff, and the existing Include archived email control. A single impact summary and the existing recovery/exclusion note remain with the final Delete button when the body scrolls. Examples remain under Details. Protected single-sender overrides still say Delete anyway; quota actions retain their existing labels.

The shared PreviewSheet receives an optional summary slot above its actions. Only this Delete caller uses it; all other callers retain their current structure. No API, worker, action contracts, quota rules, protection rules or submission options change. In particular, Delete opens inbox-only with `olderThanDays: 180`. Existing special cases remain: archived-only widening can reset to any age, and the archived checkbox is hidden when the selected age's inbox/all-mail counts tie.

The cutoff is an approximate client-clock display, not a persisted boundary or a promise of the exact execution count. The server still resolves the selected age when Delete runs.

## Verification

- Focused component and mocked integration suites for Senders, sender detail, Unsubscribe and PreviewSheet: 437 tests passed. They cover age/reach payloads, bulk exclusions, Protected override, quota, loading/failed/stale previews, disappearing archived counts, zero matches, submission, cancellation and Undo. Existing selectors were updated for the intentionally shorter Delete button and the Email age label.
- New assertions explicitly preserve the 180-day inbox-only payload, remove cached impact figures during refetch, and keep Archive/Unsubscribe/Later on their current presentation.
- Production web build, bundle budget and prerender checks passed during preparation; final verification is recorded in the PR.
- Storybook covers Delete default, archived scope, loading/error, empty age and missing age bucket states; the static build passed.
- Built-in browser, fictional mailbox using the real confirmation component: default 180-day inbox-only preview showed 84 sample matches; 30 days plus archived showed 141. A sample-only Any age inbox Delete cleared 128 fictional messages. Escape returned focus to the invoking Delete action. No browser errors were observed.
- At 320 × 568, the impact summary and final action stayed in view with no dialog horizontal overflow. The summary was moved into the persistent actions area after the first mobile inspection showed it could otherwise scroll out of view. Default browser sizing was restored.

The existing sample workspace disables Delete on a sender with no inbox mail, so its browser flow cannot demonstrate the zero-match dialog directly. That state is covered by the component/integration suites and Storybook. Browser sample confirmation is not evidence of a Gmail mutation or production worker completion. The isolated API/database browser stack was not started: the local Docker daemon was unavailable. No real Gmail or production actions were performed.

## Review state

The founder selected layout A and requested a targeted first patch for review before expanding the flow work. Keep this as a review candidate; no other action flow is included. Current prototype source remains on its original branch. A separate development server can show this actual component with fictional mail at `/design-prototype?variant=editorial&view=senders`; click Delete in the sender inspector. This review route is unavailable in production builds.
