# Later cleanup preview: review patch

The founder requested Later across Senders, Triage and Screener, including inline previews: default Email age to **Any age**, preserve the **7-day return**, and keep the preview count and submitted action aligned. Review before Unsubscribe. Autopilot stays separate.

Owner and integration owner: this chat. Isolated worktree `later-age-preview`, branch `codex/later-age-preview`, based on Delete/chevron draft #1083 at `b3101a42f0b199ca6a0bf688cc49835942dd256a`. That draft depends on Archive #1082 and Delete layout #1081. This patch is held for founder review, with no merge or production release. The accepted preview worktrees are unchanged.

## Result and scope

- Later uses the reviewed layout: Email age and Return to inbox, one impact summary, a short Later button and existing recovery details. It stays inbox-only. Single Protected overrides and bulk exclusions remain as before.
- A shared native return picker presents and edits the same local-clock instant across the modal, inline and group previews. The existing `defaultLaterWakeAtIso` remains the only 7-day default. Age changes preserve the chosen return; return edits preserve age. A new action resets both.
- Senders list, inspector, detail and bulk use the shared confirmation. The selected age drives the preview bucket, samples, Gmail search and confirmation options. A missing selected count cannot arm Later.
- Triage stores inline age and return time on the same pending action. Modal click/Cmd/Ctrl-Enter and inline button/repeated shortcut carry the selected age and return. The existing group Later path also uses the chosen age in totals, per-sender details and the bulk request.
- Screener's inline picker reads the selected age bucket and sends that age and return through its existing decide API. Both click and Enter refuse an unresolved/zero count or an invalid return time.

The existing backend and worker already support Later age filtering. No backend, database, worker, lockfile, infrastructure, quota, standing-policy or Undo changes are needed. Later remains a move of matching existing inbox email with a scheduled return. Counts are a preview snapshot; the worker resolves the same age criteria when it runs. The public simulator receives no age control backed by invented dated fixtures.

Owned files: shared cleanup impact/CSS and return picker/stories; Senders confirmation and Later stories; Triage store, count/request wiring, preview presenters and inline/group renderers; Screener row/preview/request wiring; related behavior tests. Existing lifecycle tests retain count assertions in the impact summary after the button loses its count.

## Verification

- Full web suite: **4,770 passed**, three existing skips across 381 files.
- Mocked requests cover modal click/keyboard, inline button/repeated shortcut, Any age and an older-age selection, edited return time, zero/unavailable counts, invalid returns, reset and group totals/per-sender matching. Existing Later-to-Undo journeys pass.
- Negative control: restoring only the unfiltered Later payload in Senders, Triage and Screener makes all three selected request regressions fail. Exact candidate bytes are restored before final checks.
- Workspace typecheck, formatting, lint (zero errors, six existing unused-disable warnings), static Storybook, the production build with CI pricing/meter/pass flags, all 52 bundle budgets and all 32 static-route prerender checks pass. Typecheck is verified after Next regenerates route types. No budget rebaseline.
- Built-in browser verifies 128 inbox matches at Any age, 84 at 180 days and 120 at 30 days. Native date edits survive age changes and appear in the sample confirmation. Triage group Later starts at 256 and narrows to its chosen bucket. Zero matches keep the picker editable and disable Later. Native keyboard edits are used for datetime verification; the browser fill operation alone does not commit React datetime state.
- At 320px, the inline page and modal dialogs have equal client/scroll widths (310px); date fields fit, and modal body scrolling exposes controls above the persistent summary/actions. Temporary viewport sizing is reset. Screenshots are saved outside the repository.

No real Gmail action, API/database browser journey or provider completion is claimed. Independent design-system review remains pending; this is a draft for founder review.

## Review fixtures

Static Storybook at localhost:6024, dark theme, fictional mail only:

- `senders-laterpreview--default`
- `triage-actionsheet--later-default`
- `triage-actionsheet--later-inline`
- `triage-actionsheet--later-batch`
- `screener-decidepreview--later-default`

Confirmations display sample results without contacting Gmail. Loading, unavailable, empty and Protected stories are also available. Review tabs return to Any age and a fresh 7-day return.
