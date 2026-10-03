# Triage phone choices audit — 2026-10-03

## Flow contract and ownership

Returning-user Triage, tested in production with account alias R (Plus) after
explicit visible identity verification, and locally with synthetic Storybook
fixtures. Intent: identify a sender, inspect its recommendation, choose one of
the five canonical verbs, pass the existing preview/confirmation gate, and retain
honest queued, unknown and recovery states. Onboarding and billing are excluded.
No real Gmail action, unsubscribe request, draft, rule activation or account
setting was performed for this layout repair.

Root owns `focus-card.tsx`, its stories and this record, and owns integration.
Isolated branch: `codex/triage-phone-choices`, based on main `0f4876b`.
No schema, API, action contract, shared token or dependency changes. No dependency
on the concurrent private Sentry triage script repair (#865).

## Finding and repair

**P2 — phone decision choices fall below the initial view.** At 390 × 844, the
production focus card's stacked 72-pixel identity, large count and generous
spacing pushed most choices below the fold. Users must scroll before comparing
the full set of actions. The synthetic component reproduced the excessive height.

At the existing narrow breakpoint, use a 48-pixel identity beside the sender text,
a smaller count and tighter token-based spacing. Keep desktop's 72-pixel identity
and centered layout. Existing action toolbar, callbacks, swipe gates, Protected
mark, Why disclosure and mandatory preview remain authoritative (D29/D36/D226).

Default synthetic phone card height: **597.695 → 421.695 pixels** (176 shorter).
All five actions retain 44-pixel height. At a requested 320-pixel viewport, the
actual content width was 310; the card and every action remained within those
bounds. This measures the component, not a guarantee that expanded explanations
or every complete application screen fit without scrolling.

## Verification and independent review

- Full `pnpm typecheck` and `pnpm lint` pass; lint retains six existing unused
  suppression warnings.
- Existing focus, action-toolbar and stale-refresh suites: **81/81 pass** across
  three files. They cover keyboard/swipe behavior, preview gates, protected rows,
  unknown outcomes and recommendation refresh; no implementation-mirroring style
  tests were added.
- Storybook production build passes. Added `LongIdentity` with an `.invalid`
  synthetic address. Browser verified default, long identity, Protected, expanded
  Why, unknown outcome and inline-preview stories at phone widths; dark theme
  actually rendered on the Protected story. Desktop retains the 72-pixel identity.
  Keyboard Tab reaches Keep with the existing visible 2-pixel focus ring.
- Before/after screenshots are local synthetic artifacts, excluded from Git.
  The changed component has not yet been production verified at this point.
- Independent `/root/flow_reviewer` inspected the diff and synthetic screenshots,
  applied design-system and TypeScript review, reran 81/81 tests and reported no
  blockers. Long identity disclosure on touch devices remains a nonblocking
  product opportunity below. CI/merge/deployment status is reported separately.

## Production journey observations and remaining opportunities

These observations distinguish deployed behavior from this local layout change.

| Journey / opportunity              | Evidence and useful outcome                                                                                                                                                        | Status / acceptance boundary                                                                                                                                                                                 |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Current recommendation freshness   | Opening Why refreshed an old explanation to match the current 90-day volume; revisiting retained the new explanation and “Last checked today.”                                     | Existing refresh works in this observed case. Make old explanation versus current statistics provenance clearer while a refresh is pending; do not change classification policy without a separate decision. |
| Long sender identity on touch      | Full sender name/address remain accessible text with titles, but truncated visual identity cannot reliably use a hover title on a phone.                                           | Deferred small enhancement: provide touch/keyboard disclosure of full identity without causing a decision or affecting next-sender state.                                                                    |
| Screener beyond the working window | 61 awaiting review, 50 loaded; Protected filter truthfully scopes itself to loaded rows. No pagination is exposed.                                                                 | Separate feature opportunity: browse/search/filter the remaining backlog with a defined global-versus-loaded denominator. This is an existing bounded-window limitation, not a demonstrated cursor bug.      |
| Activity and historical outcomes   | Historical archived/deleted totals are separate from the empty current window; an undone action is marked Undone and cannot be undone twice. Search empty state and re-entry work. | Existing useful weekly summaries and recovery states are already present; do not duplicate them.                                                                                                             |
| Autopilot and Quiet                | Status filters exist; paused rules and read-only zero-match preview work. Quiet explains the next-day boundary for an overnight window.                                            | Existing behavior; not new feature gaps. No rules were enabled or settings saved.                                                                                                                            |
| Brief / Followups                  | Returning Plus user receives the Pro eligibility gate.                                                                                                                             | Gate observed; paid feature output and billing remain outside this account's test boundary.                                                                                                                  |
| Later return proof                 | Empty Later state and navigation work. No pending return exists in this account.                                                                                                   | Actual scheduled Gmail return is unverified here. A durable receipt would need a separate data/retention design and any required production migration approval.                                              |
| Optional telemetry                 | Existing `action_preview_viewed` captured both cancelled Archive/Delete previews; page views and `web_vital_reported` were observed in the test window.                            | No new collection is needed for this layout. Aggregate observations do not prove unique users or Gmail mutations. PostHog shared web insight usability still requires its authenticated browser check.       |
| Fetch error diagnosis              | Private Sentry readback shows a current-release `query` / `snoozed` fetch recurrence. #865 preserves allowlisted query labels in private triage.                                   | Root cause is unresolved; instrumentation repair is not an application-error repair. Do not mute or resolve it without evidence.                                                                             |

No mailbox mutation residue was created. Existing isolated journeys cover action,
Undo and failure-handling contracts. Production provider completion and Undo
restoration were not reverified in this layout pass.
