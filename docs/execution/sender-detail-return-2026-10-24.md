# Sender detail return and Later context — 2026-10-24

## Contract and ownership

Integration owner: this Codex session, branch `codex/sender-detail-return`, based
on main `4b57d8ed5`. No dependencies on open PRs. Owned surfaces: sender navigation,
sender detail return link, first-review presentation, and the shared recommendation
disclosures used by sender details and Guided Review. No API, engine, worker,
billing, provider, or action-policy changes. Existing untracked prototypes in the
original checkout remain untouched.

Intent: inspect a sender, then return to the originating Senders view and search
without rebuilding the scope. All senders mobile links and desktop full-page links
must retain search, filters, and sorting; first-review links must return to Needs
first review. A return URL must be local to the Senders workspace and must not
restore `sender` on mobile (which would immediately reopen the detail page).
Existing Guided Review tokens retain their owner, sender, scope, and expiry checks.

The engine's Later verdict is an abstention (`RECOMMEND_FLOOR.later === null`).
Render its evidence as neutral review context, not a recommendation to move mail.
Preserve all five existing actions and their preview, confirmation, progress,
recovery and Undo behavior. Keep zero-Inbox Later suppression intact.

Applicable states: direct detail entry, loading/error/not found, ordinary and
Guided return, rejected/malformed return URLs, protected and zero-Inbox rows,
positive/unknown counts, preview cancellation, desktop and phone widths. Existing
mail-changing lifecycle tests guard the unaffected action pipeline. Execution,
Undo, billing, onboarding, production data changes and physical-device testing
are excluded. Production checks use the existing signed-in account, read-only;
changed-build browser checks use synthetic data.

## Findings and verification

Production baseline reproduced in the preceding walkthrough: Back to Senders loses
search after a mobile sender open or desktop Open full page, and first-review
details return to All senders. A Later row's reasoning says engagement cannot be
assessed while its badge and explanation call Later a suggestion.

Implemented a constrained, explicit return target shared by mobile navigation,
native row/new-tab links, desktop Open full page, the starter card and first-review
Open sender. Only canonical Senders view/search/filter/sort parameters survive;
open panes, arbitrary destinations and unowned Guided tokens do not. Existing
Guided ownership/expiry restoration remains unchanged.

Later abstentions now say “No clear suggestion” with “Review context” for their
stored evidence. In selected Guided Review, Later stays under the existing More
actions rather than receiving a filled suggested-action button. Existing eligibility,
shortcuts, preview/confirmation callbacks, counts and zero-Inbox suppression remain
unchanged. Added a positive-Inbox neutral-context Storybook state.

Negative controls reproduced four original return/copy failures and independently
proved the Guided Later emphasis assertion fails with the original CTA guard.
Affected coverage passed: 708 tests in 28 files, plus 184 tests in the two files
rerun after the starter-card follow-up. Shared coverage passed: 947 tests in 87
files, including the entitlements literal guard. Workspace typecheck, root lint
(zero errors; six existing warnings), formatting, production build, bundle budgets,
32 public prerenders and Storybook build passed. The final starter-card build and bundle checks also passed; affected-file lint
and formatting stayed clean, and the final 32 public prerenders passed.

Independent review found and resolved two additional entry paths: modified-click
row hrefs and the filled Later CTA. A follow-up review of the starter-card route
also reported no actionable findings. Reviews found no action-handler, provider,
privacy or eligibility changes. Shared-file overlap: open native-app PR #1116 has
separate sender-row gesture work; report-audit PR #1128 changes other sections of
SendersScreen and its tests. No dependency or shared branch edits.

The compiled app is exercised against an isolated synthetic API, database and
Redis, with no provider credentials or workers. Desktop 1280×720 checks passed:
search + Inbox filter + alphabetical sort survive inspector/full-page return and a
new-tab link; first-review detail returns to its queue; positive Inbox Later previews
show exact counts and neutral context; Guided detail return and early loading exit
preserve the selected sender. Every preview was cancelled. Phone checks passed at 320×760 and 390×844: ordinary sender returns retain
search/filter/sort, first-review detail returns to the correct view, positive Later
previews retain their two-email impact and neutral context, and empty-Inbox Later
shows nothing to move with confirmation disabled. Guided Review retains the selected
sender across detail return and early loading exit; Later is hidden at rest and
available in More actions. No horizontal overflow was observed; phone action targets
are 44px tall. Light and dark rendering were inspected. Browser warning/error log
for the dedicated synthetic origin was empty.

Four previews were cancelled. Before/after database comparison confirmed identical
message labels, zero action jobs, zero sender policies and zero first-review
decisions. No real mailbox action was exercised. Synthetic screenshots and machine
readbacks are outside the repository; no mailbox content or authentication material
is included in this change. Real production desktop/mobile serving checks follow
the normal merge and deployment gates.
