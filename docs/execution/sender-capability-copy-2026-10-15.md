# Sender action relevance follow-up — 2026-10-15

## Contract and ownership

User intent: offer only relevant sender actions and explain Keep's saved effect.
Owner/integrator: this task on `codex/sender-capability-copy`, reusing its isolated
worktree from merged #1060. Shared files: sender controls and tests, Triage and
Screener toolbars, sender result copy, existing unsubscribe E2E, and toolbar stories.
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

Verification and independent review: in progress.
