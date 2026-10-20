# Delete preview: targeted layout A passes

First scope approved in the cleanup prototype chat: change the Senders Delete confirmation, shared by the sender list, sender detail and bulk Senders actions. After reviewing that pass, the founder authorized the same treatment for Delete in Triage and Screener, preserving their current defaults. Other actions and Autopilot remain outside this patch. Owner/integration owner: this chat. Base: `07dc458a0df0673d8fe9fd5b00749d8feee48867`. Both passes are assembled in draft PR #1081; no dependent PRs.

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

## Second pass: Triage and Screener Delete

The founder approved the first pass, including the new approximate cutoff, then requested Delete in Triage and Screener only. Both now reuse the Delete impact summary and short Delete label. The reusable presentation moved from Senders to `apps/web/src/components/delete-preview.*`; the existing Senders window availability rules remain unchanged.

- Triage retains its modal, inbox-only default and no age limit. It gains no age selector or cutoff. The impact summary states Any age. An explicit archived choice still widens the same all-age request. First-cleanup reach restrictions, Protected acknowledgement, preview failure/zero blocking and keyboard handling are unchanged. Triage domain batches support Archive/Later, not Delete, and are untouched.
- Screener retains its inline preview, inbox-only default and 180-day window. Its existing age choices now use Older than labels and the approximate cutoff. The summary names the selected reach and age; the empty-window explanation uses the same age wording. Cached archived figures are omitted while the preview is loading or unavailable. Protected Delete still says Delete anyway; confirming and cancellation guards remain intact.
- Neither pass changes API contracts, worker execution, Undo windows, quotas, or any other action's presentation.

Interactive Storybook review uses the actual action components and fictional counts. Triage is `triage-actionsheet--delete-default`; Screener is `screener-decidepreview--delete-default`. Both have loading, unavailable, empty and Protected stories. Changing archived scope updates the fictional count; Screener's age selection also updates it. Confirmation only records an on-screen sample result.

Built-in browser verification: Triage default 128 sample inbox emails at Any age widened to 146 with archived included; Escape restored focus after opening from Review Delete. Screener default 84 at 180 days changed to 138 at 30 days with archived included, then 146 at Any age with the cutoff removed. Cancelling and reopening restored 180 days and inbox only. At 320 × 568 both had no horizontal overflow, with impact and Delete visible together. Browser sizing was restored. Static Storybook rendered successfully; the dev-mode Storybook server hit a dependency syntax error, so review is served from the verified static build.

Production build passed. Screener's measured first load increased from the first-pass build's 305.5 kB to 306.2 kB, above the older 306 kB cap. The budget table was regenerated using `pnpm check:bundle --rebaseline`, without manual cap edits; its contract tests passed. Full final checks and exact commit are recorded in the PR. The local Docker daemon remains unavailable, so browser evidence uses fictional component fixtures, not the isolated API/database stack or real Gmail actions. This second pass remains for founder review before other actions or release.
