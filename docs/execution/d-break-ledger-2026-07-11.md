# D-break ledger — 2026-07-11 product-experience buildout

This ledger records every deliberate deviation from the current D-plan and
every independently revertible PR slice proposed by this buildout. No row
overrides the privacy, destructive-action, category-prediction, webhook, or
offline-action hard guardrails in `CLAUDE.md` §2.

Revert any merged slice with:

```bash
./scripts/revert-pr.sh <PR_NUMBER> --push
```

## Interpretation

- **Implements** — ships the decision as written.
- **Amends** — changes the implementation detail while preserving the goal.
- **Breaks** — intentionally contradicts a locked decision and needs founder
  ratification or a revert.
- **D-candidate** — a product decision that is not yet numbered.

## Proposed PR slices

| PR      | Slice                                      | D / ADR relation                                             | Deviation and rationale                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Revert             |
| ------- | ------------------------------------------ | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| planned | Public truth + shared chrome               | Implements D131, D134, D146, D209, D228; amends D138         | Replaces false blanket undo/future-policy claims, adds Anthropic to the public processor disclosure, removes the anonymous auth probe, and gives every public route one header/footer. D228 wording wins over older D138 copy.                                                                                                                                                                                                                                                     | `revert-pr.sh <N>` |
| planned | Interactive inbox simulator                | Implements most of D133; **amends D133**                     | Reuses production Triage row and preview components, but uses clearly labeled synthetic recommendations instead of moving the worker-only scoring engine into the browser. This avoids a duplicated or unsafe client engine.                                                                                                                                                                                                                                                       | `revert-pr.sh <N>` |
| planned | How it works + methodology                 | Implements D132, D139–D141                                   | CASA download and current-verification claims are omitted until a current redacted letter exists. Public trust copy states that the current Tier 2 assessment cycle/evidence is still in progress rather than fabricating an artifact or passed status.                                                                                                                                                                                                                            | `revert-pr.sh <N>` |
| planned | Comparison program                         | Implements D132, D142–D145                                   | Current official sources and verification dates are visible; unknown competitor facts remain unknown rather than inferred.                                                                                                                                                                                                                                                                                                                                                         | `revert-pr.sh <N>` |
| planned | Education, answers, FAQ, blog, changelog   | **Amends D132 sequencing**; implements D218                  | D132 planned Tier 3/4 content during the first eight post-launch weeks and empty Tier 5 shells. This slice ships substantive content at launch because the requested finished public product should not expose empty pages.                                                                                                                                                                                                                                                        | `revert-pr.sh <N>` |
| planned | Pricing truth pass                         | Implements D19; amends presentation                          | Team loses the speculative Q3 2026 date, unavailable tiers are excluded from the feature matrix, and Founding Pro availability is confirmed at checkout instead of implied by static manifest data. Prices and entitlements do not change.                                                                                                                                                                                                                                         | `revert-pr.sh <N>` |
| planned | Entitlement enforcement                    | Implements D19 + ADR-0015; corrects enforcement gaps         | Enforces Action Registry selector tiers before preview resolution and enqueue; Free keeps five single-sender cleanup actions while multi-sender actions return structured `ACTION_TIER_REQUIRED` (402). Triage is Plus-gated at route and API level, with the Free onboarding stats read explicitly exempt. Unsubscribe consumes one Free unit and preflights two when a separate backlog action is confirmed. The remaining concurrent-request cap race is recorded in the audit. | `revert-pr.sh <N>` |
| planned | Visual identity alignment                  | Implements D1 + ADR-0016                                     | Restores Geist Sans/Mono for body and chrome while retaining ADR-0016's narrowly scoped Fraunces numeric/editorial display accent. Public pages use one light-theme behavior.                                                                                                                                                                                                                                                                                                      | `revert-pr.sh <N>` |
| planned | SEO + public route integration             | Implements D128, D132, D159                                  | Recursive sitemap coverage, `llms.txt`, metadata, and consented demo-funnel events are updated only after all route slices land.                                                                                                                                                                                                                                                                                                                                                   | `revert-pr.sh <N>` |
| planned | Honest action/recovery + session payoff    | **Breaks D33's payoff display**; corrects D58/D208/D226/D232 | Replaces the unprovable "~N emails/mo prevented" estimate after one-time/manual actions with the terminal worker result's `affectedCount` shown as messages actually moved. Unsubscribe attempts add no projected future volume. The slice also scopes preview promises to manual actions, makes Autopilot's no-per-message-approval boundary explicit, and removes guaranteed unsubscribe/Trash wording.                                                                          | `revert-pr.sh <N>` |
| planned | Consented acquisition-to-product analytics | Implements D147/D159; amends mounting                        | Adds bounded public route families, demo preview/confirm/reset, internal-UUID identification after consent, and a best-effort identity-reset request on sign-out that cannot block cache clearing/navigation. No Gmail content or address enters analytics. Three documented server outcome events still need a consent-aware analytics sink and are called out in the audit.                                                                                                      | `revert-pr.sh <N>` |
| planned | Billing-intent continuity                  | Implements D17/D117/D134; security boundary clarification    | Carries only canonical Plus/Pro plan, monthly/annual cycle, and eligible Founding Pro intent through OAuth and onboarding. API start/callback and the web billing route independently reject hosts, fragments, duplicate/extra keys, and impossible promo combinations. Billing-disabled remains an honest non-checkout state.                                                                                                                                                     | `revert-pr.sh <N>` |
| planned | Mailbox-bound action idempotency           | Corrects D68/D76 isolation gap                               | Reserves unsubscribe intent/execution rows transactionally and binds replay to mailbox, sender ID, sender key, and verb. Same-request replay/self-healing remains; conflicting cross-mailbox or cross-sender key reuse returns structured 409 before policy, Activity, outbox, Gmail, or undo effects.                                                                                                                                                                             | `revert-pr.sh <N>` |
| planned | Autopilot execution entitlement            | Implements D19/D45/D91 + ADR-0015 at worker boundary         | Re-checks the canonical `autopilot` capability before both rule evaluation and action execution. Free/Plus workspaces produce no matches or Gmail effects; a queued approved match remains unapplied after downgrade. Rules are not rewritten to Paused because doing so would destroy the user&rsquo;s Active-versus-Observe intent and make re-upgrade unsafe.                                                                                                                   | `revert-pr.sh <N>` |

## Parallel authenticated-app PRs already in progress

These pre-existing worktrees themselves were left untouched. The launch branch
now also corrects one Activity trust sentence and enforces the Senders
multi-sender tier. Those files overlap the branches below and must be
reconciled deliberately during rebase rather than resolved by dropping either
side:

| Branch                           | Purpose                                                | Decision posture                                                    |
| -------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------- |
| `fix/d029-gmail-roundtrip-trust` | Multi-account-safe Gmail links and message round trips | Implements accepted D231; corrects D29 trust gaps                   |
| `fix/d207-ux-consistency-sweep`  | Shared layout/labels/tier presentation consistency     | Implements D207/D211; label-default remains a D-candidate           |
| `feat/d224-sync-error-banner`    | Honest sync failure and recovery UI                    | Implements D224/D211                                                |
| `feat/d227-gmail-muscle-memory`  | Keyboard/row-navigation familiarity                    | D227-adjacent; aliases and swipe coaching need founder ratification |

## Decisions still requiring founder ratification

1. **Locked privacy allowlist:** the six-item list in `CLAUDE.md` §2.1 and
   `packages/shared/src/copy/privacy.ts` still calls itself the exact list of
   stored message data, but accepted ADR-0004/ADR-0021 and the production
   schema also persist outbound To/Cc recipients; HTTPS and mailto
   unsubscribe URLs; sender-level unsubscribe URL/method; the RFC 8058
   one-click flag; the derived outbound flag; and Gmail's whole-message size
   estimate. The word "exact" can also be read as excluding required
   operational records: account identity/preferences, encrypted OAuth tokens
   and mailbox/sync state, sender decisions and automation settings, action
   jobs/Activity/undo identifiers, and billing/customer/subscription
   references. The surrounding public policy now names those operational
   classes, but it cannot repair a contradictory locked artifact. This is a
   founder-gated launch stop: ratify and update the locked source through a new
   D-decision, or revert the schema amendments/features that require the extra
   fields.
2. **“Decide once” behavior:** either implement standing Archive/Later rules
   or retain the corrected public promise that manual actions affect only the
   previewed messages and Pro Autopilot handles future matches.
3. **Later recovery:** Free/Plus users can invoke Later but the management
   route is Pro-gated. Recovery must not be paywalled; scheduling automation
   may remain Pro.
4. **Progressive onboarding:** test a useful read-only shell during initial
   sync against D6's strict blockade.
5. **Plain versus power labels:** default Gmail immigrants to familiar labels
   or retain the current power vocabulary behind an explicit choice.
6. **Annual Pro price (resolved 2026-07-14):** standard Pro is $190/year; the
   $129/year Founding Pro offer remains limited to the first 250 paying users.
   Product surfaces derive both values from the canonical tier manifest.
7. **Canonical production host:** apex `declutrmail.com` versus
   `app.declutrmail.com` must be resolved before indexing; code cannot infer
   DNS cutover state.

## Explicit non-breaks

- No category prediction or auto-protection model.
- No new Gmail scope, token path, retention behavior, destructive mutation,
  billing webhook, or production migration.
- No silent edit to the locked privacy badge or `CLAUDE.md`; the accepted-ADR
  mismatch remains explicitly founder-gated.
- No testimonials, review counts, customer logos, or measured outcome claims
  without first-party evidence.
- No fabricated CASA letter, SOC 2 claim, competitor fact, founding-slot
  count, or Team ship date.
