# WS2a app polish

Branch `codex/ws2a-app-polish`. Deck revision `drop2-r6`. This record
covers H0, D1, D2 copy, H1, H2, H3, H5, B1, the empty Daily Brief
response, and the AI consent gate. WS2b is a later branch.

Rebased onto main after #977 merged. The WS1a stub cherry-pick was
dropped; main already has the real pricing foundation. Consent columns
are migration `0086` because `0085` is the emails-cleared meter.

## Flags

`BRIEF_LLM_ENABLED` and `EXPLAIN_LLM_ENABLED` are env flags, default
on. Anything other than the string `false` leaves the call path open.
Set both to `false` on the API and the worker to force the template
Brief and the rule-based explanation. The kill switch does not clear
stored consent. It only hides the card and stops new model calls.

Existing Pro workspaces that already receive a Brief get the template
Brief until that user records brief consent at version `2026-10`. No
flag has to be flipped for that. There is no backfill.

## Migration

`0086_ai_consent_columns.sql` is additive. It adds nullable consent
columns on `users`. It was not applied to a live database. Rollback
drops those columns.

## Decisions assumed

- Screen decisions in `packages/shared/src/copy/screen-decisions.ts`
  stay as written for this launch, including `PRO_PURCHASABLE=false`.
  `TIER_MANIFEST.pro.purchasable` is true. The gate uses the screen
  decision, so a locked Pro surface shows Coming with Pro and no price.
- One Settings toggle covers both scopes. Turning it on opens the
  consent card. Turning it off sets `revoked_at` on both scopes.
- A Free user who allows explanations and later upgrades sees the short
  Brief card. Not now on that card records a Brief decline and leaves
  the explanations grant in place.
- Until the user chooses, both scopes are not allowed.
- Prompt dismissals live in `localStorage` (`dm.ai-prompt`), at most
  two, at least 30 days apart.

## Omitted on purpose

- The first-backlog sentence stays unready. The senders list has no
  exact backlog count plus inbox-share pair, so the header returns null.
- Shell banner order was not changed. Reconnect and sync error keep
  their current order. The access-deadline banner is an extra slot.
- Connect-error already lands on `/settings?connect_error=<code>#mailboxes`.
  Home retry already ships. Neither was rebuilt.
- The toolbar verb stays Later. The deck also has "Move to Later" on a
  dialog button that already exists.
- Day-1 triage subtitles and the Settings intro sentence are from the
  H2/H5 appendix, not `ws2.*` keys.
- The delete-account checkbox acknowledgment sentence is not a deck key
  and was left in place.
- Sync-gate recovery titles, the caught-up line, and the Largest filter
  were skipped. Largest is WS2b.

## Cross-WS asks (not edited here)

- `apps/web/src/features/billing/plan-picker.tsx` still links to `/pricing`.
- `apps/web/src/app/(marketing)/refunds/page.tsx` still says "differs from
  cancelling".
- `upgrade_prompt_shown.source` has no `screener_gate`. The gate uses
  `tier_gate`.
- `/privacy#ai-processing` is linked from the consent card. The anchor
  itself belongs to WS3.
