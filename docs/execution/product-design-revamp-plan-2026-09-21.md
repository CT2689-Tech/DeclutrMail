# Product design revamp — working plan

Date: 2026-09-21. Target branch: `claude/product-simplification-ideas-5a8515`.
Status: two interactive visual directions implemented as a development-only study; production integration awaits direction selection. Preserve existing worktree changes.

## Design study checkpoint

The founder approved comparing warm editorial and precision workspace directions across Overview, Sender Details and the public homepage. Both now run at `/design-prototype`, with a shared comparison bar, light/dark modes, fictional data and memory-only actions. Existing production UI and sender functionality are unchanged. See `apps/web/src/features/design-prototype/NOTES.md` for URLs, supported interactions, verification and limitations. No visual direction has been selected yet.

## Outcome

Make DeclutrMail feel like a capable, calm Gmail companion: users understand their next useful action, inspect its consequences, and see verified results. Premium quality means readable hierarchy, coherent interaction, purposeful information, and dependable feedback.

Keep the branch's list/detail pattern, consolidated banners, and preview/recovery architecture. Revisit ADR-0042's universal one-number/one-list composition and flat navigation. Amend that ADR when implementation starts rather than silently contradicting it. Screen structure should follow the task.

## Evidence and limits

- Inspected production homepage/demo, local branch Home and populated Senders/detail UI, branch diff, shared design tokens, and existing product contracts/docs. Authenticated production could not be fully inspected in the available session; do not call this a complete production usability audit.
- Existing D245/D246 work already provides bounded first-relief sessions, observed sender facts, pattern suggestions, factual weekly reviews, and feedback. Improve presentation and discoverability instead of duplicating these systems.
- Warm ivory, white, teal, and editorial typography already exist in tokens. Hierarchy, contrast, composition, and interaction need improvement beyond palette changes.
- Historical checkout report has small, unfiltered, stale observations and instrumentation gaps. It is not evidence of current real-user conversion or feature demand. No new live analytics analysis was performed for this plan.
- Competitor research uses official public documentation, not authenticated competitor usability tests. Feature presence does not establish conversion uplift.

## Proposed navigation

Five primary destinations, preserving existing routes and deep links:

1. **Overview** — next action, pending work, factual progress, account health.
2. **Clean up** — Senders, focused review (current Triage), New senders (current Screener).
3. **Automations** — rules, pending rule approvals, schedule/pause controls (current Quiet).
4. **Catch up** — Brief, Follow-ups, Later, initially distinct subviews with their own semantics.
5. **Activity** — outcomes, problems, recovery.

Settings and Billing remain in the account menu. Mobile gets these primary destinations; secondary views stay within their destination. Avoid merely hiding ten unexplained features inside menus: each destination needs a clear default job. Catch up is provisional until users can distinguish its subviews. No backend merge is implied by navigation grouping.

## Screen priorities and data scope

| Priority | Screen                      | Planned enhancement                                                                                                                                                                                                                               | Existing foundation / dependency                                                                                                                        |
| -------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0       | Overview                    | A useful next action with a small real-sender preview; pending decisions; compact cleanup progress; automation results only when available. Distinct first-use, returning, all-clear, reconnect, partial-sync, and error states.                  | Existing Home summary/pending composition. Cross-feature result summaries may need a bounded aggregate read; never fetch every list just to sum it.     |
| P0       | Senders                     | Stable list/detail workspace; one or two useful observed facts per row; obvious selected state; readable density; useful filters such as volume/age/read-state where supported. Separate past decision, optional suggestion, and action visually. | Existing sender metrics, filters, samples, protection, and previews. Default remains fact-first; no new opaque ranking or category prediction.          |
| P0       | Cleanup preview/result      | Consistent count/scope, destination and recovery; stable focus and scroll; truthful queued/completed/failed feedback; accessible Undo.                                                                                                            | Existing canonical action semantics, receipts, preview sheets and worker outcomes. Do not rewrite action orchestration to style it.                     |
| P0       | Onboarding / focused review | Make the existing finite first-relief session visible and rewarding. Show progress and a clear endpoint; introduce automation after a useful result when evidence supports it.                                                                    | Existing activation goal and first-relief flow; distinguish accepted intent from completed Gmail work.                                                  |
| P1       | Autopilot                   | Rules explain what they do, Observe versus Active, pause state, matching evidence, recent outcomes, and available next action. Preview before activation.                                                                                         | Existing rule preview, pending approval and pattern evidence. Verify whether per-rule last-success and recent counts are exposed before promising them. |
| P1       | Activity                    | A results-and-recovery view: sender, outcome, affected count, date and recovery deadline; focus on failures and pending work when relevant; reuse weekly review.                                                                                  | Existing event state, affected counts, undo, feedback, support details. Pending work is never counted as completed.                                     |
| P1       | New senders / Screener      | Explain why an item is here; first-seen facts, samples, existing canonical actions; visible pending count.                                                                                                                                        | Existing first-sender review. This is not a Gmail quarantine or delivery gate.                                                                          |
| P2       | Brief                       | Clear snapshot date and coverage, concise metadata-backed context, Gmail links, useful correction feedback, intentional completion state.                                                                                                         | Existing daily frozen snapshot and feedback. Do not claim a live inbox, full-email summary, or "since last visit" without new supported state.          |
| P2       | Follow-ups                  | State "no reply detected" and timing precisely; distinguish due, dismissed and completed; make Gmail and false-positive correction easy.                                                                                                          | Existing sent-mail/reply observations and feedback. User-created reminders or snoozing require a separate contract/state scope if absent.               |
| P2       | Later                       | Group by scheduled return; show destination, return time, returning/failed/missed states and retry.                                                                                                                                               | Existing sender-level return lifecycle. Do not imply message-level snooze or immediate return on enqueue.                                               |
| P2       | Quiet                       | Put under automation controls; clearly show held action count and release time.                                                                                                                                                                   | Pauses Autopilot mutations only; does not stop Gmail delivery or notifications.                                                                         |
| P2       | Public site / demo          | Show the actual product interaction earlier; use the same components and visual identity; concise trust explanation with accessible detail.                                                                                                       | Existing simulator and shared action UI. Retain required consent and data disclosures.                                                                  |

## Easy wins before broader redesign

1. Resolve the visual conflict between optional Archive suggestion and highlighted Keep state; make each role explicit.
2. Improve secondary-text contrast and surface separation in dark mode using shared tokens, checked across all states.
3. Replace Home's "Nothing cleared yet" dead end with the correct readiness/next-step composition; expired access should direct users to reconnect rather than a futile review flow.
4. Make existing period/scope/freshness visible next to counts where omission misleads; avoid repeated explanatory banners.
5. Standardize selected rows, focus indicators, primary action placement, dialog spacing, loading and result receipts.
6. Give current finite cleanup sessions a clearer start, progress and end.
7. Surface existing weekly review and rule evidence in the relevant return journey instead of inventing more statistics.

These are low-backend-change opportunities, not an assumption that every item is a one-file edit.

## Design foundation

Working direction: warm editorial workspace, subject to founder preference. Compare light and dark equivalents on the same realistic fixtures. Use restrained display typography for welcome/progress, strong sans-serif for work, consistent compact controls, and clear tonal separation between canvas, navigation, detail and overlays. Do not make every surface a floating card or every control a pill.

Create representative fixtures for: first use; populated mailbox; protected sender; high volume; long identities; unavailable optional telemetry; stale/partial sync; reconnect required; empty/all clear; queued action; failure; undo unavailable; free and paid entitlements. Use synthetic content in review artifacts.

Deliver three connected reference screens first: Overview, Senders/detail, preview/result. Include desktop, mobile and both themes. Evaluate visual direction and task comprehension before propagating to every route.

## Parallel delivery plan

This research pass uses three agents. Implementation proceeds in waves with at most three feature agents plus the integrating lead, matching available concurrency.

### Wave 0 — shared decisions, sequential foundation

Lead owns ADR amendment, navigation map, tokens, shell, shared primitives, typography, spacing, focus, preview/receipt visual contract, and reference fixtures. Agree component interfaces and file ownership before agents edit. Do not have feature agents each invent cards, badges or modal styles.

Exit: reference screen direction chosen; existing critical interactions preserved; shared primitives usable; screenshot baseline recorded. API contracts needed for later work are listed explicitly.

### Wave 1 — core journey, parallel

- **Agent A: Overview + onboarding.** Own `apps/web/src/features/home/**` and scoped onboarding presentation. Compose existing facts; propose missing aggregate data separately.
- **Agent B: Senders + focused review.** Own sender and triage presentation. Use shared preview/receipt components; preserve filters, selection, protection and URL state.
- **Agent C: Autopilot + Activity.** Own those feature presentations; make rule evidence, pending states, results and recovery legible.
- **Lead: integration and review.** Sole owner of shared packages, shell, route/navigation changes and shared contracts. Resolve API needs explicitly and review end-to-end flow.

Each slice returns changed paths, screenshots, behavior preserved, tests run and unresolved issues. No pushes, deployments, catalog changes, production mutations or mailbox cleanup as part of visual verification.

### Wave 2 — secondary journeys, parallel

- Agent A: New senders/Screener and automation pause/schedule presentation.
- Agent B: Brief, Follow-ups and Later as distinct Catch up subviews.
- Agent C: public homepage/demo alignment using approved product visuals.
- Lead: consistency review, responsive/navigation integration, accessibility and whole-journey verification.

### Wave 3 — release readiness

Review complete first-use and returning-user journeys, free/paid surfaces and failures. Fix integration issues; document intentional limitations. Rollout/deployment is a separate concrete step after the branch is reviewable. Preserve route compatibility and a revertable sequence of feature slices.

## Acceptance criteria

- In a small task-based review, a new user can identify the next useful action, state what it changes, and find the recovery path without reading a help article.
- At 320/390px mobile and 1280/1440px desktop, no document-level horizontal overflow; controls remain usable; lists and detail panes preserve context.
- Normal text meets WCAG AA contrast, keyboard focus is visible, dialogs manage and restore focus, status changes are announced appropriately, and reduced motion works.
- Counts retain their period, scope and freshness; partial sync, stale results and account errors cannot look like healthy empty states.
- Home can reuse Triage bootstrap facts (`receivedToday`, `sendersToday`, `handledAutomatically`, `queuedDecisions`) subject to their defined period and mailbox scope. The served daily-clamped Triage queue is not every waiting sender. Never sum a paginated list into a mailbox total. Capability-gate reads and handle partial failures independently.
- Sender sorting must use supported values; reserved `read`/`recommended` sorts are currently rejected. Outbound correspondence count is not a reply count. Follow-ups' age-based priority is not inferred importance. Unknown values remain unknown.
- K/A/U/L/D meanings, protection rules, preview-before-mutation, mailbox binding, entitlement checks, consent and recovery windows remain intact.
- Gmail marked-read state is not attention measurement. Estimated size is not verified storage reclaimed. No claimed hours saved, synthetic health score, full-body summary, automatic category routing, email-delivery blocking or universal undo.
- Validate browser journeys using local/sandbox fixtures. Targeted behavior tests cover changed state composition, navigation and critical action paths; typechecks and existing relevant preview/undo/a11y checks pass. Visual-only changes need visual verification rather than assertion-heavy tests that mirror markup.
- Add Home to the existing accessibility/responsive smoke coverage, which currently omits it. Check 900/1100px layout transitions and bottom navigation/Undo overlap. Preserve mailbox-switch isolation, deep links, query filters, back navigation and list scroll context.
- The existing `packages/e2e/specs/undo.spec.ts` can mutate a connected Gmail account: do not run it as a visual smoke test. Use synthetic test states for the revamp and separately scope any controlled real-mail rehearsal. Update component stories with the new appearance.

## Measurement and learning

Reuse consent-gated D246 events and first-party outcomes. Establish a baseline before claiming uplift; exclude internal/test traffic and report sample size and consent coverage. Optional telemetry outages must not alter product behavior.

Track first-relief completion, first preview to accepted action, verified execution failures, unexpected-result feedback, automation Observe-to-Active progression where supported, and completed useful return sessions. Undo usage is diagnostic, not inherently bad. Treat "action confirmed" as intent accepted, not proof Gmail changed. Any missing event or session-completion state is an explicit implementation task, not an assumed metric.

Prioritize qualitative task success when samples are too small for credible experiment claims. Brief/Follow-ups feedback should determine investment in those screens before adding new prediction features.

## Competitive sources and implications

- [Clean Email first cleaning](https://clean.email/help/basics/getting-started) and [cleaning suggestions](https://clean.email/help/tools/cleaning-suggestions): useful opportunities first, rules after decisions. Transfer the sequence, using only DeclutrMail-supported facts.
- [Clean Email features](https://clean.email/features): automatic actions and logs support making rule outcomes and recovery visible.
- [Clean Email Screener](https://clean.email/help/tools/screener): learn review clarity, but do not copy quarantine/blocking claims into DeclutrMail's different behavior.
- [Leave Me Alone Rollups](https://help.leavemealone.com/en/rollups/what-is-a-rollup) and [Shortwave settings](https://www.shortwave.com/docs/guides/customize-your-shortwave-settings/): show when deferred reading becomes available. Scheduled digest delivery is a separate feature, not a rename of Later or Quiet.
- [SaneBox digest](https://www.sanebox.com/help/170-daily-digest-how-to-guide): bounded reviews and a completion endpoint are useful patterns.
- [SaneBox NoReplies](https://www.sanebox.com/help/110-know-when-someone-hasn-t-replied-to-an-email-sanenoreplies): precise expectations and correction matter for follow-ups. Do not copy body-intent analysis.

## Deferred

No new email client, AI composer, full-message summaries, predictive categories, automatic domain blocking, pricing/entitlement overhaul, body fetching or notification platform in this revamp. Custom rules, new reminders, scheduled digests and additional aggregates are separately scoped product/API work when evidence justifies them.

## Production behavior fidelity correction

Founder review identified missing unsubscribe cleanup controls in the visual study. Both directions now reuse the existing production confirmation component, backed by dated synthetic mail. Scope, age defaults, protected-sender override, Later scheduling, and composite cleanup recovery remain visible during design review. Before implementing any remaining screen, inventory its current production controls, defaults, permissions, empty/error states, and recovery behavior; map each to the revised design explicitly. Visual simplification must not remove existing capability. Bulk actions, unsubscribe method variants, quotas, and the queued action lifecycle remain outside this three-screen study and must be covered during integration.
