# User-facing language audit — 2026-07-14

## Scope and constraints

This audit covers the first-run flow, marketing and trust surfaces, Senders, Triage, Sender Detail, action previews, bulk actions, Activity, Brief, Autopilot, Screener, Followups, Quiet, Snoozed/Later, Settings, billing, account deletion, loading/empty/error states, mobile labels, and accessibility text.

The recommendations preserve these signed constraints:

- Keep, Archive, Unsubscribe, Later, Delete are the canonical verbs (CLAUDE.md §2.2; ADR-0019).
- A preview is mandatory before destructive or automated actions (D208, D226).
- Delete moves messages to Gmail Trash; it is not immediate permanent deletion (ADR-0019).
- A delivered unsubscribe request cannot be recalled; mailto unsubscribe remains user-sent in Gmail (D230, ADR-0006).
- Privacy language must describe Gmail's short preview honestly and must not use the retired “Bodies read: 0” claim (D7, D228).
- Editorial framing is limited to hero and first-class empty-state surfaces (ADR-0011).

## Executive summary

DeclutrMail generally names its five actions consistently and its strongest previews already explain message counts, Trash recovery, manual mailto unsubscribe, and protected-sender skips. The product is least clear at the edges around those flows: global trust claims overstate reversibility, Senders describes one choice as affecting both past and future mail, the Later action has multiple incompatible explanations, and privacy surfaces call an incomplete list the “exact” storage inventory.

The implementation pass should correct high-confidence P0–P2 copy without changing behavior. Privacy-inventory wording and the canonical meaning of Later require founder decisions because current code and signed documents do not agree.

## Persona assessment before edits

| Persona | Assessment | Main comprehension risk |
| --- | --- | --- |
| Everyday email user | Can understand the main verbs, but may believe every choice affects all mail and can always be undone. | Past versus future scope is not stable across surfaces. |
| Privacy-conscious user | Gets prominent trust cues, but “metadata only” and “exact list” claims are not defensible against the implemented allowlist. | The stored-data inventory omits accepted fields from ADR-0004/0021. |
| Busy professional | Can scan the action bars and previews quickly. | Internal labels such as action sheet, dry-run, engine, confidence, and HTTP slow comprehension. |
| Power user | Receives counts, samples, Activity, filters, bulk actions, and Gmail links. | Technical detail is mixed into default copy instead of being disclosed on request. |
| Accessibility or low-confidence user | Most primary controls have full labels and useful accessible names. | Generic Close/Dismiss labels and hash-based fallback sender names lose context outside the visual layout. |

## Prioritized findings

### F1 — P0 — Absolute reversibility claims contradict unsubscribe and expiry

- Locations: `packages/shared/src/shell/app-shell.tsx:16`; `apps/web/src/features/onboarding/step-connect.tsx:73`; `apps/web/src/features/marketing/landing/hero.tsx:53,131`; `apps/web/src/features/marketing/landing/footer.tsx:34`; `apps/web/src/features/marketing/landing/faq.tsx:38`; `apps/web/src/app/(marketing)/terms/page.tsx:72`; `apps/web/src/app/opengraph-image.tsx:105`.
- Journey: discovery → connection → action → return/undo.
- Current copy: “Every action is reversible,” “Undo on every action,” and equivalent claims.
- Problem: one-click unsubscribe cannot be recalled; Delete is recoverable only until Gmail empties Trash; other undo windows expire.
- Personas: all, especially privacy-conscious and low-confidence users.
- Recommended pattern: “Archive and Later: undo from Activity for N days. Delete: recover from Gmail Trash for 30 days. Unsubscribe requests cannot be undone.”
- Constraint: D208; D230; ADR-0019; shipped `ConfirmActionModal` comments at lines 362–371.
- Confidence: high.

### F2 — P0 — Senders overstates action scope and Later describes the wrong behavior

- Locations: `apps/web/src/features/senders/senders-screen.tsx:1502`; `apps/web/src/features/senders/confirm-action-modal.tsx:321-334,794-905`.
- Journey: Senders → understand sender → preview → confirm.
- Current copy: “your choice applies to past and future mail”; “Future mail … lands in a DeclutrMail/Later label”; “Archive all mail” even when a time window is selected.
- Problem: each verb has a different scope. The implemented Later worker moves current inbox messages; Archive/Delete can be time-bounded; Unsubscribe normally affects future delivery and leaves existing mail alone.
- Personas: all.
- Recommended pattern: introduce Senders without a universal scope claim; state the selected time range in Archive/Delete previews; describe Later as moving current inbox mail unless the product adopts a standing future policy.
- Constraint: D208; ADR-0015 `later.execution`; `packages/shared/src/actions/manifest-entries.ts:216-240`; ADR-0020.
- Confidence: high for the current worker behavior; the future-policy meaning remains a decision item.

### F3 — P0 — Account-deletion copy contradicts the Delete action

- Location: `apps/web/src/features/account-deletion/delete-account-modal.tsx:130-153`.
- Journey: Settings → delete account.
- Current copy: “Emails in your actual Gmail account — DeclutrMail never deletes your mail.”
- Problem: DeclutrMail has an explicit Delete action that moves selected Gmail messages to Trash. The intended claim is only that deleting the DeclutrMail account does not delete Gmail mail.
- Personas: all.
- Recommended copy: “Deleting your DeclutrMail account does not delete emails in Gmail.”
- Constraint: D216; D232; ADR-0019.
- Confidence: high.

### F4 — P0 — The “exact” privacy inventory is incomplete and internally inconsistent

- Locations: `packages/shared/src/copy/privacy.ts:21-54`; `apps/web/src/app/(marketing)/privacy/page.tsx:68-121`; `apps/web/src/app/(marketing)/security/page.tsx:51-96`; `apps/web/src/features/settings/privacy-data/privacy-data-screen.tsx:85-180`.
- Journey: discovery → consent → Privacy & Data → export.
- Current copy: the badge calls six fields the exact stored list and says “Headers other than the ones above,” although the items above are not a header list.
- Problem: accepted ADR-0004/0021 add recipient addresses for outbound mail, unsubscribe URLs/method flags, outbound state, and message size estimate; D217 also names an attachment flag. CLAUDE.md §2.1 has not been distilled to include all amendments. Editing the claim without resolving source-of-truth drift would be a privacy decision.
- Personas: privacy-conscious user; all users at consent.
- Recommendation: reconcile the cumulative allowlist, then generate onboarding, badge, Privacy, Security, and export copy from one canonical inventory. Separate “message fields,” “derived fields,” and “headers used for unsubscribe.”
- Constraint: CLAUDE.md §2.1/§3/§9 stop condition; ADR-0004; ADR-0021; D217; D228.
- Confidence: high that drift exists; wording blocked on founder decision.

### F5 — P1 — First-use copy uses forbidden language and overpromises undo

- Locations: `apps/web/src/features/onboarding/step-promise.tsx:26-27`; `apps/web/src/features/onboarding/step-connect.tsx:60-75`.
- Current copy: “Clean Gmail…”; “Every Archive, Unsubscribe, Later or Delete … is undoable.”
- Problem: `clean` as a verb is forbidden by D209; unsubscribe is not undoable.
- Recommendation: “Control Gmail by sender, not by email”; describe previews and per-action recovery rather than universal undo.
- Constraint: D209; D230; ADR-0011.
- Confidence: high.

### F6 — P1 — Internal and specialist terminology leaks into default UI

- Locations: `apps/web/src/features/senders/senders-screen.tsx:1504` (“classify,” “public list-headers”); `apps/web/src/features/brief/brief-screen.tsx:165,210` (“next slice,” “LLM,” “deterministic template”); `apps/web/src/features/autopilot/pending-suggestion-row.tsx:88-138` (materialisation race, SHA-256, engine confidence); `apps/web/src/features/autopilot/rule-preview-panel.tsx:32-134` (“dry-run,” “signals”); `apps/web/src/features/quiet/quiet-screen.tsx:84,114` and Autopilot errors (raw HTTP status).
- Problem: implementation details do not help the normal recovery path and make the product feel unfinished.
- Recommendation: use “preview,” “current sender data,” “details still syncing,” and plain recovery copy. Put identifiers/status codes behind an explicit “Show technical details” control where support value exists.
- Constraint: D209; senders-v2 Decision 10 progressive disclosure.
- Confidence: high.

### F7 — P1 — Empty states anthropomorphize the product or imply enabled automation

- Locations: `apps/web/src/features/triage/empty-state.tsx:65-66,143-203`; `apps/web/src/features/brief/brief-screen.tsx:662-663`; `apps/web/src/features/autopilot/autopilot-screen.tsx:576-816`; `apps/web/src/features/followups/followups-screen.tsx:86-98`.
- Current copy: “Autopilot keeps watch,” “the engine refreshes,” “we’ll be back tomorrow,” “We watch your Sent folder,” “keep it going.”
- Problem: the tool sounds agentic, may imply Autopilot is enabled, and introduces engagement/streak framing.
- Recommendation: use the D221 canonical no-decisions wording; state when data is checked or what condition will create a row; render streaks factually if retained.
- Constraint: D209; D212; D221; ADR-0011.
- Confidence: high.

### F8 — P1 — Disconnect confirmation omits retained data and reversal

- Location: `apps/web/src/features/mailboxes/account-menu.tsx:309-337`.
- Current copy: “Disconnect this Gmail account?”
- Problem: the user is not told that access and sync stop, indexed data remains, and reconnection is available.
- Recommendation: “Disconnecting revokes Gmail access and stops sync. Indexed data stays in DeclutrMail until you delete it. You can reconnect later.”
- Constraint: D116; privacy page retention copy.
- Confidence: high.

### F9 — P2 — “Action sheet” and “dry-run” describe implementation, not user intent

- Locations: `apps/web/src/features/triage/action-sheet.tsx:124,187-207`; `apps/web/src/features/settings/settings-index/action-sheet-prefs-card.tsx:35-139`; `apps/web/src/features/autopilot/rule-preview-panel.tsx:32-134`.
- Recommendation: “Preview,” “Show previews in the row,” and “Preview current matches.”
- Constraint: D34/D226 behavior must remain unchanged.
- Confidence: high.

### F10 — P2 — Recommendation/inference language conflicts with the signed fact-first Senders spec

- Locations: `apps/web/src/features/senders/detail/recommendation-banner.tsx`; `apps/web/src/features/senders/detail/sender-detail-page.tsx:1101-1112`; `apps/web/src/features/senders/action-row.tsx:38-91`.
- Current copy: “recommended,” confidence percentage, “how the engine decided”; the primary CTA still falls back to legacy `intentOf`.
- Problem: senders-v2 Decisions 2 and 6 retire `intentOf` and inferred labels in favor of fact-derived actions, while older D26/D39 describe a recommendation banner.
- Recommendation: decide which signed source wins. If senders-v2 wins, remove the recommendation banner and show observed facts; do not merely rename the inference.
- Constraint: source-of-truth drift between signed senders-v2 and older D26/D39/current code.
- Confidence: high that drift exists; implementation blocked on founder decision.

### F11 — P2 — Later and Snoozed do not have one stable mental model

- Locations: `packages/shared/src/actions/manifest-entries.ts:216-240`; `apps/web/src/features/triage/action-preview.tsx:67-102`; `apps/web/src/features/senders/confirm-action-modal.tsx:325-334`; `apps/web/src/features/settings/settings-index/action-sheet-prefs-card.tsx:18`; `apps/web/src/features/snoozed/snoozed-screen.tsx:111-121`; `apps/web/src/app/(app)/snoozed/page.tsx:25-39`.
- Current meanings: move existing inbox mail to a label; route future mail; postpone a sender decision; snooze until a wake time.
- Problem: the same verb is used for at least three behaviors, and the UI does not consistently ask for or show a wake time.
- Recommendation: select one canonical model. Preferred: **Later** = move current inbox mail to DeclutrMail/Later and show the exact return time; **Snoozed** may remain the page title only if it contains time-based Later items. If Later merely postpones a decision, it must not mutate Gmail mail.
- Constraint: D227 canonical verb; ADR-0015; SnoozeWakeWorker behavior.
- Confidence: high that the meanings conflict; decision required.

### F12 — P2 — Context-free accessibility labels

- Locations: `apps/web/src/features/senders/grid/sender-peek.tsx:145`; `apps/web/src/features/senders/unsub-mailto-callout.tsx:83`; `apps/web/src/features/senders/receipt-strip.tsx:132`; `apps/web/src/features/senders/detail/recommendation-banner.tsx:155`.
- Current copy: generic “Close” or “Dismiss.”
- Recommendation: “Close sender preview,” “Dismiss Gmail unsubscribe reminder,” “Dismiss action receipt,” and “Close recommendation details.”
- Constraint: no behavioral change.
- Confidence: high.

## Terminology inventory and canonical vocabulary

| Current wording | Meaning / locations | Misunderstood by | Recommendation | Canonical term | Locked? |
| --- | --- | --- | --- | --- | --- |
| Sender | A sending address/account/list/service, not one email | Everyday, low-confidence | Define once: “an account, list, person, or service that mails you” | Sender | Yes, sender-first model |
| Email / message | One Gmail message | Everyday | Use one noun per sentence; prefer “email” in general UI, “message” only when matching Gmail terminology | Email | No |
| Keep | Standing protection/keep policy; no mail moves now | Everyday | “Keep this sender’s mail in the inbox. No existing mail moves.” | Keep | Yes |
| Archive | Remove matching current messages from Inbox; retain in Gmail | Everyday | “Move … out of Inbox. Nothing is deleted.” | Archive | Yes |
| Unsubscribe | Request that a sender stop future mail; does not move past mail unless separately selected | All | State one-click/manual path and that the request cannot be recalled | Unsubscribe | Yes |
| Later | Timed move of a sender's current Inbox mail to `DeclutrMail/Later`; future mail is unchanged | All | Always show or request the exact return time | Later | D245 |
| Delete | Move matching mail to Gmail Trash; Gmail permanently deletes after 30 days | Everyday | Always pair with “moves to Gmail Trash” and the recovery limit | Delete | Yes |
| Undo | DeclutrMail reverses Archive/Later/backlog action during its journal window | Everyday | Reserve “Undo” for Activity/undo journal | Undo | Yes |
| Recover | Restore Delete from Gmail Trash | Everyday | Do not call this unlimited undo | Recover from Gmail Trash | Behavior locked |
| Preview | Read-only explanation/count/sample before a mutation | All | Replace “action sheet” and “dry-run” in user copy | Preview | D208/D226 |
| Activity | Audit record plus available Undo controls | Everyday | Introduce as “record of actions and available undos” | Activity | Existing feature name |
| Gmail Preview | Gmail’s short snippet shown in inbox lists | Privacy-conscious | Never call it message body or summary | Gmail Preview | D7 |
| Metadata only | Overbroad privacy shorthand | Privacy-conscious | Avoid; list stored fields explicitly | Stored Gmail data | D7 removed absolutism |
| One-click unsubscribe | Supported automated unsubscribe path | Everyday | Keep technical RFC/header names out of default UI | One-click unsubscribe | senders-v2 locked |
| Manual via Gmail | Prefilled unsubscribe email the user sends | Everyday | Say “Opens a prefilled draft in Gmail; you press Send” | Manual via Gmail | D230 |
| Protected | Sender excluded from bulk and automated actions | Everyday | Explain exclusions at first use | Protected sender | Existing feature term |
| VIP | Retired prelaunch priority/safety concept | Everyday | Do not use; Protected is safety, and any future manual ranking is Pin in Brief | — | Removed by D245 |
| Filter | Temporary narrowing of the current list | Everyday | “Filter” | Filter | Existing |
| Saved view | Named saved filter/sort/search state | Everyday | Never call it a recommendation | Saved view | Existing |
| Recommendation / confidence | Optional suggestion based on observed facts | Everyday | Keep facts and consequences primary; disclose a suggestion and basis only on request | Suggestion | D245 fact-first |
| Autopilot Observe | Rule records suggestions but does not act | Everyday | “Observe: creates suggestions for you to approve” | Observe | D10 |
| Autopilot Active | Rule applies future matches automatically | Everyday | Always state action, scope, undo, and manual-unsubscribe exception | Active | D10 |
| Quiet hours | Window that delays Autopilot actions only | Everyday | State that user actions still run and delayed actions run later | Quiet hours | Existing |
| Sync / scan / index | Fetch allowed Gmail fields and build sender data | Everyday | Use “scan” in onboarding; define once; use “sync” for later updates | Scan (first run), sync (updates) | D109/D224 |

## Journey walkthrough

1. **Discover → connect → first result.** The landing page explains sender-first decisions, but absolute reversibility and “metadata only” weaken trust. Step 1 uses forbidden `clean`; Step 2 accurately previews the Google consent screen but falsely says every action is undoable. The sync gate has a real progress bar and a clear “tab may close” next step.
2. **Senders → preview → confirm → undo.** Counts, samples, protected-sender skips, named confirm buttons, and recovery banners are strong. The page introduction and Later/Archive preview scope are the primary risks.
3. **Unsubscribe + past mail.** One-click versus manual Gmail paths are implemented and the modal correctly says unsubscribe cannot be undone. Global marketing/onboarding language contradicts this local truth.
4. **Archive/Delete.** Delete is clearly mapped to Gmail Trash in the modal. Archive titles must not say “all” when a time window is active; account-deletion copy must not erase the existence of Delete.
5. **Filters/bulk.** Filter and saved-view controls are mostly precise. Bulk previews show sender counts and protected skips; bulk subject sampling is intentionally absent. The confirm fallback should never show unrelated lifetime totals as if they were affected counts.
6. **Loading/incomplete/empty/error.** Core surfaces implement designed states. Raw HTTP statuses, internal fallback details, “Nothing…” headings, and anthropomorphic copy are avoidable.
7. **Return after days.** Activity, Brief, Followups, Snoozed, and sender status pills explain much of what changed. Later/Snoozed wake behavior and unsubscribe’s irreversibility need one consistent explanation at return points.

## Language system

### Buttons

- Use the canonical full verb and include the affected count when known: `Archive 47`, `Delete 125`.
- Use a destination or consequence for navigation: `Continue to Google`, `Open draft in Gmail`, `Review in Activity`.
- Avoid `Continue`, `Apply`, `Got it`, `Manage`, or icon-only controls when the specific action fits.

### Previews and confirmations

Use this order:

1. **Action and scope:** “47 emails from Acme older than 90 days will move out of Inbox.”
2. **Future behavior:** “Future emails are unchanged.”
3. **What stays unchanged:** “Nothing is deleted.”
4. **Reversal:** “Undo from Activity for 7 days,” or “This unsubscribe request cannot be undone.”
5. **Named confirm:** `Archive 47`.

Never use a lifetime sender total as the affected count when the preview count is unavailable.

### Privacy

- Lead with the boundary: `Full bodies fetched: 0`.
- Name the Gmail Preview as a short snippet and do not answer “Does it read my emails?” with an unqualified “No.”
- List stored fields from one cumulative source of truth.
- Separate what DeclutrMail can access through OAuth from what it actually fetches and stores.
- Put RFC names, raw header keys, and protocol detail behind `Show technical details`.

### States

- Loading: `Loading senders…` or action-specific progress.
- Empty: explain why the state is empty and the next data-producing event; avoid apology, celebration, or anthropomorphism.
- Success: describe the confirmed result, not praise: `Archived 47 emails.`
- Undo: state the action and deadline: `Undo Archive from Activity for 7 days.`
- Warning: state risk and prevention: `Preview unavailable. Refresh before deleting.`
- Error: state what did not change, then the recovery action. Keep HTTP status and correlation IDs behind technical details.

### Progressive disclosure

- Default UI: behavior, scope, count, destination, reversal.
- `Show details`: observed facts and calculation inputs.
- `Show technical details`: protocol names, raw unsubscribe URL/header keys, status/correlation IDs, exact timestamps.
- Never expose internal hashes, endpoint names, worker stages, race conditions, or implementation provenance as fallback user copy.

## Original product decisions (resolved in D245)

1. **Cumulative privacy allowlist.** Reconcile CLAUDE.md §2.1, ADR-0004, ADR-0021, D217, schema/export behavior, and the badge before changing the “exact list.” Recommended decision: a typed shared inventory generated from the implemented storage contract, with field-level purpose and retention.
2. **Meaning of Later.** Decide whether Later moves current messages, routes future mail, postpones a sender decision, or sets a timed snooze. Recommended decision: current-mail move plus an explicit wake time; future routing, if wanted, should be a separate standing policy.
3. **Fact-first Senders versus recommendation banner.** Resolve senders-v2 Decisions 2/6 against older D26/D39 and current `intentOf`/confidence UI. Recommended decision: signed senders-v2 wins; show facts and derived primary action without editorial recommendation labels.
4. **Delete recovery by tier.** Product copy alternates between Gmail’s fixed 30-day Trash recovery and plan-specific undo retention. Recommended decision: distinguish DeclutrMail Undo from Gmail Trash recovery everywhere; never imply the plan shortens Gmail’s recovery.
5. **Disconnect retention.** Confirm whether disconnect retains only Activity or the complete sender/message index. Current public privacy copy and UI imply different scopes. Recommended decision: show the exact retained datasets and a separate `Delete this mailbox’s data` action if supported.

## Founder decisions recorded for implementation

The founder resolved the five original blockers and the duplicate safety-state
question during the implementation Q&A:

1. Generate every Gmail-data explanation from one cumulative typed inventory.
2. Later moves current Inbox mail to `DeclutrMail/Later`, always has a return
   time, and leaves future mail unchanged. The visible page is **Later**; the
   prelaunch `/snoozed` compatibility route and timerless repair state are
   removed.
3. Senders is fact-first. Suggestions are secondary disclosure, never the
   primary fact or action authority.
4. Activity Undo and Gmail Trash recovery remain separate concepts and copy.
5. Disconnect and Disconnect-and-delete-data are separate explicit choices.
6. **Protected** is the one visible safety state and excludes a sender from bulk
   and automatic mail-changing actions. VIP is removed rather than aliased.
7. Brief priority comes from observed engagement and Gmail importance. If a
   manual ranking control is needed later, it will be a separate **Pin in
   Brief** feature, not a second safety label.
8. DeclutrMail is prelaunch with no production users or production data. Remove
   superseded routes, schema, contracts, fixtures, and docs directly instead of
   carrying hypothetical legacy compatibility.
9. Strong observed signals may automatically set Protected. The conservative
   triggers are at least three replies, a message starred in the past year, or
   at least three Gmail-important messages in the past year. Read/open rate is
   never sufficient. Show the exact reason and preserve manual Unprotect as a
   sticky override.

These decisions are canonical in D245 and supersede the conflicting VIP,
Snoozed-compatibility, and Later descriptions cited in the original audit.

## Post-implementation result

The P0–P3 clarity program now has one coherent product model in code and
canonical documentation. Privacy explanations are generated from the storage
inventory; action consequences come from the shared semantics registry; Later
always has a return time; Senders is fact-first; Activity and errors state what
did and did not change; and Protected is the only visible safety state. The
prelaunch VIP schema/contracts and `/snoozed` route were removed rather than
preserved as compatibility behavior.

The Later terminal path also received a correctness fix discovered during the
cleanup: a successful Gmail label mutation now stores its return timer in the
same worker transaction as the local mirror and action result. Without that
projection, the item could have been absent from Later and never returned
automatically.

### Before and after

| Area | Before | After |
| --- | --- | --- |
| Privacy | Several hand-maintained “exact” lists drifted from storage. | One typed inventory generates access, fetched, stored, purpose, retention, export, and deletion explanations. |
| Action scope | Copy varied by surface and sometimes implied every choice affected past and future mail. | One K/A/U/L/D registry generates scope, destination, unchanged data, recovery, and result language. |
| Later | Could mean deferral, future routing, a label move, or an indefinite/timerless state. | Moves current Inbox mail per sender, requires a future return time, leaves future mail unchanged, and appears only on Later. |
| Safety | Protected and VIP overlapped; both appeared in policy, ranking, filters, Brief, and Activity. | Protected is the sole visible safety state and the sole bulk/automation gate; Brief ranking uses observed signals. |
| Senders | Recommendations and confidence could dominate observed facts. | Observed facts and exact consequences are primary; suggestions are optional disclosure. |
| Recovery | Product-level Undo and Gmail Trash recovery were conflated. | Activity Undo, Gmail Trash recovery, and irreversible unsubscribe outcomes are separate. |
| Failures | Generic errors could leave users unsure whether Gmail changed. | Errors distinguish not started, accepted but unconfirmed, partial, terminal, and retryable outcomes. |
| Navigation and search | Snoozed/Later routes and transient list state were inconsistent. | `/later` is canonical; search/filter/sort state is shareable and restores through browser navigation. |
| Contextual labels | Generic Close, Dismiss, and mode labels depended on visual context. | Controls name their target; privacy, previews, Activity, Autopilot, billing, and mailbox exits explain the decision in place. |

## Product decision still required

### What is the standard Pro annual price?

- **A — $190/year (recommended):** matches the current $19 monthly price with
  roughly two months free and keeps the $129 Founding offer meaningfully
  differentiated.
- **B — $149/year:** lowers the adoption barrier but compresses the Founding
  discount and creates a much larger annual-versus-monthly discount.
- **C — Reprice monthly and annual together:** useful only if the product's
  willingness-to-pay assumptions have changed; this broadens the decision
  beyond the current consistency fix.

## Highest-value product opportunity map

The founder approved this opportunity map for phased implementation on
2026-07-14. Launch-critical trust, recovery, automation-control, and
accessibility foundations come before optional workflow acceleration.

| Surface | Improvement or feature | User benefit | Recommendation |
| --- | --- | --- | --- |
| Marketing and trust | Interactive “what DeclutrMail accesses, stores, and can change” explainer using the live inventory | Makes OAuth consent understandable before connection | Add after legal review; keep it generated, not duplicated copy. |
| Onboarding | Measure time-to-first-useful-decision and offer a permission-free sample walkthrough | Lets cautious users understand value before OAuth and reveals activation drop-off | High priority; sample data must remain unmistakably labelled. |
| Triage | Pattern review after several similar decisions, with an explicit rule preview | Converts repetitive work into safe leverage without surprising automation | Offer Observe first; require a consequence preview before Active. |
| Senders | Cross-mailbox sender search and a side-by-side consequence comparison | Helps multi-account users understand and act on one sender globally | Add only with clear mailbox scope and per-mailbox counts. |
| Senders | Optional “Pin in Brief” | Gives users manual ranking without corrupting the safety model | Defer until Brief feedback proves demand. |
| Activity | Retry a failed action directly from its row using a fresh preview | Turns Activity into the recovery center instead of a passive log | High priority; never replay an unknown/possibly-applied mutation blindly. |
| Activity | Exportable action timeline with human-readable support bundle | Helps users and support diagnose provider or automation issues | Keep IDs/status codes behind technical details. |
| Brief | “Useful / not useful / wrong reason” feedback on each item | Improves recurring value and exposes poor ranking signals | Start with local/product analytics; do not imply model training without consent. |
| Brief | Explain why an item ranked highly using observed facts | Builds confidence in prioritization | Show Gmail importance, reply history, recency, and volume—not an opaque score. |
| Autopilot | Pre-activation change report: current matches, projected weekly volume, protected skips, and undo window | Makes automation consequences concrete before enabling Active | **Implemented 2026-07-14:** generated from the same preview and entitlement contracts, with early estimates labelled. |
| Autopilot | Weekly automation digest with successes, skips, failures, and saved inbox volume | Helps users verify continuing value and catch drift | Link every count to Activity. |
| Later | Missed-wake/failure state plus optional notification when mail returns | Prevents scheduled mail from silently remaining out of Inbox | High priority; expose retry and last-attempt truth. |
| Later | Reschedule history on the row | Helps users remember why and when a sender was deferred | Keep the default row compact; disclose history on demand. |
| Followups | Accuracy feedback and flexible reminder timing per thread/sender | Reduces false positives and makes follow-up timing fit real work | Preserve “observed sent mail,” not a promise that a reply is owed. |
| Screener | Preview sender history and “allow once / always allow” distinctions | Reduces accidental standing rules from one unusual message | Keep current-message and future-policy choices visibly separate. |
| Quiet | “What will run when Quiet ends?” queue preview | Prevents delayed automation from feeling hidden | **Foundation implemented 2026-07-14:** truthful held count and release time. Per-item preview and cancellation remain. |
| Mailboxes | Connection-health timeline: last successful sync, partial scope, reauth, quota, and next retry | Gives users a single answer to “is my Gmail current?” | Build from existing freshness and lifecycle states. |
| Privacy and data | Export/deletion job progress, completion receipt, and exact dataset manifest | Makes high-trust account operations verifiable | High priority for launch readiness. |
| Billing | Usage meter, projected limit date, and one canonical plan comparison | Prevents surprise caps and contradictory upgrade prompts | Resolve annual pricing first, then generate every surface from entitlements. |
| Global navigation | Command palette for sender search, recent Activity, and primary destinations | Speeds up expert workflows without crowding every page | Add keyboard-first with full screen-reader labels. |
| Accessibility | Authenticated 375px, keyboard, reduced-motion, and screen-reader smoke suite | Catches interaction problems static copy/unit tests cannot | **CI foundation implemented 2026-07-14:** desktop/mobile, reduced motion, Axe, names, overflow, and focus. A real screen-reader session remains. |
| Support/admin | User-visible incident banner and provider-status context | Separates a Gmail/service outage from a user-specific failure | Show only actionable, scoped status; avoid leaking internal systems. |

## Post-implementation scorecard

| Dimension | Score | Evidence / path to 5 |
| --- | ---: | --- |
| Consent and privacy truth | 5/5 | Generated cumulative inventory, purpose, retention, and export/deletion descriptions. |
| Action consequence clarity | 5/5 | Shared semantics drive preview, receipt, Activity, mobile, and return-state copy. |
| Recovery and failure truth | 5/5 | Activity Undo, Gmail recovery, irreversible unsubscribe, and uncertain/partial failures are distinct. |
| Terminology consistency | 5/5 | Later, Protected, Observe/Active, Gmail Preview, and contextual labels are canonical. |
| Onboarding activation | 4/5 | First useful decision exists; add sample walkthrough and time-to-value measurement. |
| Recurring user value | 4/5 | Brief/Activity/Autopilot are actionable; add feedback loops and weekly value reporting. |
| Automation control | 5/5 | Observe, Active, Protected gates, consequence reports, caps, and action-specific recovery are explicit before activation. |
| Accessibility and mobile confidence | 4/5 | Authenticated desktop/mobile CI now gates Axe, names, overflow, reduced motion, and keyboard focus; a real screen-reader session remains. |
| Billing clarity | 3/5 | Entitlements are canonical, but standard annual Pro pricing is unresolved. |
| Operational trust | 4/5 | Freshness and recoverable errors are visible; add connection health and export/deletion progress. |

## Implementation and verification summary

- Removed the prelaunch VIP database fields/enums, migrations, API fields,
  filters, audit actions, Brief markers, UI controls, fixtures, and active docs.
- Removed the `/snoozed` compatibility route and timerless Later response/UI
  state; database and API contracts require a wake time.
- Added conservative automatic protection with exact reply, star, or Gmail
  importance provenance, visible explanations, and a sticky manual override.
- Added an Autopilot activation report with current actionable scope, Protected
  exclusions, evidence-labelled weekly volume, safety caps, and recovery truth.
- Added Quiet's held-action count and scheduled-release truth, including
  indefinite Quiet and pending work that Quiet is not delaying.
- Added a Gmail-free authenticated accessibility CI gate for representative
  desktop and mobile/reduced-motion routes plus keyboard focus behavior.
- Updated canonical planning, ADR, API, Senders, and language-audit docs.
- Static validation covers TypeScript, focused API/worker/web/shared tests,
  migration checks, and diff/format checks. Authenticated live Playwright and
  assistive-technology smoke remain release verification work.

## Remaining verification risks

- No `check-microcopy.sh` or `copy-tokens.md` exists in the repository despite D209, D221, D227, D228, and ADR-0011 referring to them.
- The implemented recommendation surfaces now lead with observed facts; authenticated usability testing is still needed to validate whether users understand the resulting choices without assistance.
- Mobile gesture behavior is documented as proposed in ADR-0018; the new
  375×812 smoke covers layout and controls, not gesture-specific behavior.
- Legal/privacy claims require founder/legal confirmation against the now-settled cumulative storage inventory.
