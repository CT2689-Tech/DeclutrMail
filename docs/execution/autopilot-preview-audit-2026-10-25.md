# Autopilot preview count and wording audit

Scope: rule-library previews, activation/Watch first, paged sender evidence,
Delete review summaries, and frozen sender-rule Archive/Delete batch previews.
Integration owner: Codex, `codex/autopilot-preview-audit-20261025`. No dependency
on open PRs; base includes #1149. Own only preview presentation, tests/stories,
and this audit record. No API/wire, matching, permission or execution changes.

## Flow contract

The user opens a rule preview to distinguish historical rule matches from
senders currently eligible for its action. Activation previews show current
eligibility; Watch first records suggestions until approval. Complete paged
lists contain eligible senders; fallback samples contain historical matches.
Frozen Archive/Delete batches count exact selected messages, within their reach,
age and batch limits. Protected, excluded and not-in-batch senders must not
appear to contribute to the batch count.

Discovery → read-only preview → inspect evidence/eligibility → cancel, or an
explicit confirmation outside this production audit. Loading/error/retry,
zero/partial eligibility, protection, missing counts, paging and expiry are
relevant. Queue execution, provider completion and Undo are outside the selected
presentation change; their controls and guards remain in place. Onboarding,
billing, production rule changes and real-mailbox mutations are excluded.

Environment: authenticated production primary-mailbox alias for read-only
baseline; synthetic local cases for activation and exact-message batches. No
real identities or mailbox screenshots are committed.

## Findings fixed

| Severity | Surface/state                        | Before                                                                                                                                                  | After / verification                                                                                                                                                                                         |
| -------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P2       | Activation, partial/zero eligibility | Hero called the eligible count “ready for review” or “actionable now”; historical sample could show more senders without explanation.                   | Per-action eligibility labels and the same exclusion explanation as inline cards. Paged lists say “Eligible senders.” Archive, Later, Unsubscribe and Delete regression cases.                               |
| P2       | Watch first / review-only            | Lead still described sending requests; Details said “Actionable now” when approval was selected. Delete described suggestions although it uses batches. | Lead, note and Details follow the effective mode. Delete explicitly describes previewing and approving each batch. Daily cap states actions per day without promising the next check will run the remainder. |
| P2       | Delete review summary                | Eligible email count called “matching emails” without explaining historical matches outside its action scope.                                           | Labels emails eligible for Delete and explains the ineligible subset. Zero-eligible test keeps Preview batch disabled.                                                                                       |
| P2       | Frozen Archive/Delete batch          | “1 emails,” unitless sender counts, and a dash for excluded/not-in-batch senders.                                                                       | Singular/plural email units, explicit Excluded / Not in this batch / Unavailable labels. Failed reread hides old row counts and keeps confirmation disabled.                                                 |
| P3       | Frozen batch / custom-rule summaries | “1 Protected senders”; custom-rule count could look like the total number of configured sender rows.                                                    | Singular Protected sender; custom summaries label the eligible-sender subset and singular email. Configured Protected senders remain visible.                                                                |

No arithmetic or producer defect was found in the inspected preview contracts.
Rule-card match counts exclude Protected senders; Archive/Later require Inbox
mail; Unsubscribe excludes senders with a recorded Unsubscribe policy; Delete follows reach.
Sender-list rules additionally apply their configured age. Frozen previews bound
the exact selected message IDs and report their own batch/eligible totals.

## Baseline and validation

Read-only production inspection covered all five preset paths. Archive had a
historical match but no eligible Inbox mail; Unsubscribe rules had both eligible
and matches with Unsubscribe already selected; Later had eligible, no-Inbox and Protected
subsets; Delete had eligible mail. Opened a disabled rule's setup, selected
Watch first, observed the acting lead, then cancelled. The rule stayed disabled.
No real approvals, requests, rule changes, purchases or Gmail mutations were
performed. Mailbox counts and identities are intentionally omitted from this
public repository.

- Negative controls: activation eligibility/Watch first assertions, Delete review,
  frozen singular/protection units, and custom-rule subset assertions failed
  against the old presentation and passed with the fixes.
- 244 Autopilot tests pass, covering paging/expiry, loading/error/retry, unknown
  counts, selection changes, all four actions and protected exclusions.
- Workspace package typechecks pass; web rechecked after the final test changes.
  Full lint has no errors (six existing unused-directive warnings); changed-file
  lint and formatting pass. Production Storybook build passes.
- The first merge-queue run caught two new uses of a discouraged generic term
  in preview copy. Both were replaced with specific wording; the glossary gate
  and all 244 Autopilot tests pass after the correction.
- Built-in browser on the compiled synthetic build: Archive 0 eligible / 1
  historical sample; Unsubscribe 0 eligible / 1 with Unsubscribe already selected; mode switch
  updates lead/note/If approved; empty eligible page; 25-action daily cap. At
  375px, no horizontal page overflow and keyboard Tab reaches the primary action.
  In the synthetic Delete batch, deselecting its one eligible email changed
  the title from 1 email to 0 emails, marked the row Excluded, showed the
  empty-batch state, and disabled Delete. No browser errors appeared. Live
  verification of these fixes follows the protected merge and deployment.
- Independent review identified the Delete suggestion/batch wording, which was
  fixed and re-reviewed. Final review passed, including the custom-rule subset
  and singular Protected sender changes. Confirmation, expiry and execution
  guards are preserved.

## Opportunities and boundaries

Per-row eligibility reasons for historical Unsubscribe samples could further
explain which individual senders have Unsubscribe already selected. That needs an API row
field; it was deferred to the follow-up below. Aggregate counts and reasons are accurate without
new data collection. Execution outcomes and Activity wording remain outside this
preview-only audit. There is no pending product-policy decision or production
test residue. Merge/release will use the user's standing authorization and normal
required checks; this audit skill itself does not grant release authorization.

## Follow-up: historical Unsubscribe sample rows (2026-10-26)

The deferred row explanation is now implemented. An Unsubscribe sample shows
“Unsubscribe already selected” beside a sender only when the same recorded
sender-policy signal excludes that sender from the eligible count. This policy
records the choice; it does not prove the provider completed an unsubscribe.
The aggregate explanation now uses the same precise wording. Eligible rows carry no
exclusion label; Protected senders remain outside the sample. The paged
activation list still contains only eligible senders. The optional response
field lets older preview responses render without an invented status. This
uses existing policy metadata and adds no mailbox data collection or action.
The API regression covers a policy still at `action_required`, an eligible
sender, a Protected sender, and strict wire parsing. List and table tests bind
the label to the correct row; they failed before the fix. The API suite (96),
Autopilot UI suite (246), typecheck, lint, and Storybook build pass. The built-in
browser shows the explanation at 375px without horizontal overflow. Independent
review found and verified the status-neutral wording correction. No production
mailbox action was performed for this follow-up.
