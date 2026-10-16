# Sender action relevance follow-up — 2026-10-15

## Contract and ownership

User intent: offer only relevant sender actions and explain Keep's saved effect.
Owner/integrator: this task on `codex/sender-capability-copy`, reusing its isolated
worktree from merged #1060. Shared files: sender controls and tests, Triage and
Screener toolbars, sender result copy, existing unsubscribe E2E, toolbar stories, and shared responsive toolbar styling.
No API/schema/provider changes. #1061 concurrently changes empty-mail eligibility;
preserve its capability, preview, dispatch and exclusion rules when integrating.

- `none` and `null` omit Unsubscribe from single sender controls; visible notes
  distinguish no channel found from not checked. Supported manual/one-click paths
  retain their existing confirmation and request lifecycle.
- Desktop and phone selection controls omit Unsubscribe only when no selected
  sender has a supported channel. Mixed counts and Protected/recorded exclusions
  retain their existing meaning.
- Request receipts remain visible after a channel disappears. Existing handlers
  continue blocking unavailable shortcuts and repeated requests.
- Saved and session Keep state says **Skipped in Triage** in rows and details.
  Show the saved state once in details; Keep remains the action verb. Historical
  events and sender-named transient confirmations retain event wording.
- Four phone Triage actions form two full rows. Five actions retain full-width Delete.

Production inspection is read-only; synthetic fixtures cover changes. Real mail,
subscriptions, protection, billing and onboarding are excluded from mutation.

## Evidence

Baseline: sender details offered a disabled Unsubscribe despite its recorded
missing-channel reason; a saved Keep showed vague bare “Kept” beneath Keep.
The same unavailable action appeared in Triage, Screener and all-unsupported bulk.

Negative control: restoring five old source components fails all 11 targeted
regressions across list/menu, details, bulk/phone, Triage and Screener; source
restored in a `finally` block.

Verification:

- 908 affected web tests passed (3 existing skips), including the integrated
  #1061 control/eligibility cases; 61 focused tests rerun after the final tooltip
  and responsive style correction passed.
- All 920 shared tests passed. The first shared run also scanned the temporary
  preview page and rejected its harness-only wording; removing the preview
  resolves that diagnostic without changing a product copy rule or baseline.
- Root typecheck and lint passed; six existing unrelated lint warnings remain.
- Built-in browser synthetic smoke covered missing/unknown/one-click/manual
  channels, list menu and unavailable U, saved/session Keep, desktop and 320px
  compact/selection layouts. Four visible actions form two complete rows.
  No browser console errors observed. Temporary route and owned server removed.
- Independent review: 157 focused control/keyboard tests, then 93 checks after
  final tooltip/style edits; no blocking findings. Shared responsive CSS and the
  live Keep tooltip were repaired after visual inspection found their older
  behavior. Historical Activity event labels deliberately remain event wording.
- Actual integration with merged #1061 resolved two conflicts while preserving
  its current-mail eligibility, preview/dispatch rechecks and exclusion rules.
- Existing unsubscribe provider E2E now expects no unavailable menu item and
  checks that U still opens no confirmation. Provider mail changes were not used
  for manual evidence; the required CI runs this isolated synthetic journey.

Production web build, 51 route bundle budgets and 32 public prerender checks pass.
Required PR and queue CI remain pending. No new product data or
provider behavior was introduced. Live production verification remains read-only.
