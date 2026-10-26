# Empty senders in Needs first review

Relates to D72, D73, D200, D226 and ADR-0028.

## Flow contract and evidence

Intent: understand why a sender with no current inbox or archived mail remains in Needs first review, and finish that review deliberately. Entry points: Cleanup → Needs first review and the standalone Screener. The same row and preview serve both. Scope excludes onboarding, billing, changing queue eligibility, provider operations and real mailbox mutations.

The server queue tracks an unresolved first review (`screener_quarantine.decided_at IS NULL`) with its existing age-out rule; it does not filter by current Gmail labels. Historical received counts and review status therefore remain after inbox/archive mail is gone. Removing mail elsewhere does not record a sender decision. Evidence: `packages/db/src/predicates.ts:screenerAwaitingWhere`, `apps/api/src/screener/screener.read-service.ts:screenerPendingWhere` and `ScreenerService.decide`.

Keep records an app-only decision and resolves the pending review. It does not move Gmail messages or protect a sender from automatic cleanup. Its authoritative result refreshes the queue/count, Activity and Senders. Unsubscribe follows its existing supported-channel preview and explicit confirmation; its availability does not require current inbox/archive messages.

The complete story is entry → expand sender → choose cleanup → receive fresh counts → understand the genuinely empty state → choose Keep or supported Unsubscribe → review that separate decision → confirm → server completion → refresh/revisit. Failed or uncertain outcomes retain the existing recovery flow. No new automatic completion or dismissal is introduced. Keep has no mail movement to Undo; destructive provider recovery is outside this change.

## Findings and repairs

- **P2 — No next step at a genuinely empty cleanup preview.** A disabled Archive/Later/Delete and generic “Choose Keep” sentence gave no explanation for the pending review or direct way to continue. A confirmed empty inbox AND all-mail preview now explains the distinction and offers primary Keep plus supported Unsubscribe. These buttons open their existing confirmation; they never submit a decision directly.
- **P2 — Counts were easy to confuse with review eligibility.** Queue introduction now explains that senders can remain unreviewed even after inbox/archive mail is gone. Keep's confirmation explicitly states that it marks the sender reviewed and leaves email where it is.
- **P2 — Focus loss while changing decision.** The new empty-state button unmounts when its decision preview changes. A failing focused regression reproduced body focus fallback. The row now returns focus to that decision's persistent toolbar button, matching the existing toolbar entry path and avoiding automatic confirmation focus.

Only settled zero counts at BOTH unwindowed scopes qualify. Age-filtered zeros, partial/missing counts, loading and error states retain the existing cleanup controls, retry and confirmation guards. Include archived email remains available consistently on Delete. Protected senders may Keep without a destructive override; all existing locks, mailbox identity checks, protected acknowledgements and unsubscribe capability rules remain in place.

## Validation

- Three screen-level regressions failed before the repair (Archive, Later, Delete). They now require the explanation, the separate Keep preview, no premature POST, exact Keep payload, queue/count invalidation and completion. Focus assertions also failed before the focus repair.
- 151 frontend tests and 37 existing Screener server tests pass. New negative cases distinguish truly empty mail from age-filtered/unknown counts and cover one-click, mailto and unsupported unsubscribe methods.
- Full typecheck, lint, production build, bundle and prerender budgets pass; pre-existing lint warnings remain. React checklist: no new fetch/effect/global listener, server state stays in TanStack, existing preview/mutation hooks are reused, focus uses a local toolbar ref.
- Existing component-paint scenarios cover the empty Keep transition at 320px and 360px. Added a real API/database browser journey for explicit Keep completion, absence after reload and unchanged Trash labels in the disposable synthetic workspace. The first CI attempt ([40249866478](https://github.com/CT2689-Tech/DeclutrMail/actions/runs/40249866478)) clicked the server-rendered row before the client mount marker appeared and timed out on its toolbar. Its trace preserves that timing. The test now uses the existing screen-mounted helper and waits for exact sender removal plus the visible empty state before and after reload; changing the expand/collapse label or loading cannot produce a false pass.
- Built-in browser verification against the final isolated production build passed: both supported and unsupported Unsubscribe states, cancellation, keyboard focus, 320px fit, explicit Keep confirmation, queue count 1 → 0, and absence after reload. Database readback confirms a reviewed quarantine row, Keep activity with affected count 0, and the original Trash labels unchanged. No browser console warnings/errors. The screenshot uses synthetic data only.
- Independent design-system/usability review and Storybook build pass. Its focus and glossary findings were corrected; all four glossary tests pass without expanding the baseline. The local isolated launcher needed a temporary installed-native-binding preload and package-source link on macOS; no credentials or repository harness changes were introduced. Production screenshots from this chat established the baseline only; no real sender was decided or unsubscribed for testing.

## Opportunities and decisions

1. **Implemented:** explain why the empty sender remains, provide direct decision previews, and state Keep's outcome.
2. **Deferred product decision:** automatically exclude or complete senders with no current mail. That would change the first-review eligibility policy and remove a chance to unsubscribe from future mail; this repair preserves explicit decisions.
3. **Deferred:** show current Inbox/archived counts before choosing an action. This needs a shared, freshness-aware queue read and count query design; do not derive archived totals from historical received counts.

Integration owner: this chat. No dependencies on open PRs. Production files are limited to the existing Screener screen, row and preview. Tests, one existing Storybook story set and the existing browser harness cover the change. Verification of a merged release remains separate from local/source verification.
