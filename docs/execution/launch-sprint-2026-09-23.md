# Gmail-first launch sprint — 2026-09-23

Candidate branch: `claude/product-simplification-ideas-5a8515`. This is a working launch plan, not evidence of a production release. Preserve the existing [founder launch checklist](founder-launch-checklist.md) as the detailed acceptance procedure. Do not merge or promote this branch until the founder has tested the candidate.

## Product decision

Launch a focused Gmail product. The first promise is: review years of mail by sender, inspect exactly what a cleanup will affect, then confirm and find the result in Activity. Gmail remains the place to read and reply. Make the first safe cleanup easy to reach; do not make multi-provider support a launch dependency.

The immediate competitive advantage to prove is a trustworthy first result, not a longer feature list. Clean Email, SaneBox, Leave Me Alone, and Gmail's built-in tools already cover parts of cleanup. A buyer needs to see the difference in this product's actual preview, deliberate action, and recoverability. Use an explicitly illustrative demo and a real, consented, redacted walkthrough once the release candidate is accepted. Do not invent testimonials or outcome metrics.

## Parallel work and release gates

| Workstream                       | Owner in this sprint          | Acceptance evidence                                                                                                                                                                                |
| -------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Integration and release decision | Orchestrator                  | Review combined diff; run exact-candidate checks and desktop/mobile browser smoke; reconcile all P0/P1 findings.                                                                                   |
| Independent criticism            | Critic                        | Reproduce launch risks on actual screens, label source-only inferences, and recheck fixes.                                                                                                         |
| Clear public promise             | Marketing implementer         | Homepage and pricing explain Gmail-only scope, first value, and Free/Plus/Pro jobs without changing prices or inventing proof.                                                                     |
| First useful action              | Home and Senders implementers | Suggested sender has current Inbox mail; count label matches the source and preview remains authoritative. Senders list offers an honest route to current cleanup opportunities across pagination. |
| Provider expansion               | Architecture reviewer         | Document provider-specific auth, sync, action, undo, and privacy gaps from code and official docs; keep broad claims off launch pages.                                                             |

The code and local browser checks can close implementation defects. The following **must be checked in the intended accounts and environment before public promotion**:

1. Confirm current Google OAuth Branding and Data access state for the final consent logo/client. Historical `gmail.modify` approval is documented; the changed brand asset's approval state is not established by a repository test. A read-only Console attempt on 2026-09-23 returned insufficient project access in the browser's signed-in account, so this remains unverified.
2. Run a fresh controlled Gmail signup: OAuth permissions, first sync, sender detail, filtered preview, one agreed safe action, Activity outcome, and supported Undo. Confirm the result in Gmail. Test a narrow phone viewport and mailbox switching. Unsubscribe requests and Gmail drafts need their own distinct review; do not use real destructive mail to inspect a preview.
3. Follow the existing Paddle sandbox sequence: catalog read, notification destination read, purchase, webhook grant, cancellation/refund and entitlement state. Check the exact plan/price shown at checkout. Only perform live low-value purchase/refund during the explicitly approved cutover, per [billing runbook](billing-go-live-runbook-2026-07-17.md) and `AGENTS.md`.
4. Run deployment, support-delivery, monitoring-dashboard, consent-analytics, and real watch/sync checks in the intended production environment, with time-stamped evidence. A green local test does not prove these external systems.

When these pass: freeze the candidate, capture its commit and evidence, let the founder complete branch testing, merge, deploy, verify public URLs and a fresh test inbox, then launch outreach. Record discovered regressions against this candidate rather than broadening the feature scope indefinitely.

## Local smoke evidence after restart

On 2026-09-23, the local API, worker, Redis, and web app were restarted without resetting the database. Both previously connected Gmail accounts remained available, and switching accounts changed Home, sender, and Brief data. The populated account loaded Home, Senders, Triage, Screener, Brief, Follow-ups, Later, Autopilot, Quiet Hours, Activity, billing, settings, privacy, protected senders, and help. The smaller account loaded its own Home, sender inspector, archive preview, and Brief. The inspected sender opened in the right panel; Archive displayed a live Inbox count and age choices. Public home, pricing, comparison, how-it-works, and the interactive demo loaded without a browser error overlay. The demo's Unsubscribe preview exposed historical Archive/Delete, age ranges, and Inbox-only versus Inbox-plus-archived Delete scope.

The populated Brief exposed an unsafe-seeming default: a generated list of dozens of possible-noise senders was preselected, while its live Archive preview covered thousands of current Inbox messages, far more than the previous day's summary. Long lists now start with no selection, require sender-by-sender choice, and link to Senders for a broader review. No Gmail-changing action, unsubscribe request, account deletion, or checkout was submitted during this smoke test. Those controlled end-to-end checks remain release gates above; passing a preview is not proof of the worker outcome or Undo in Gmail.

At a 390 px viewport, public home, pricing, comparison and demo, plus Home, Senders, Triage, Screener, Brief, Follow-ups, Autopilot, billing, settings and sender detail were checked for horizontal overflow and error overlays. Sender detail correctly uses a full page on the narrow viewport. The root test suite passed with 6,757 tests passing and 15 skipped; typecheck, lint, formatting, the production web build, bundle budget, static-prerender checks and whitespace validation passed. These checks cover the local candidate, not the external release gates above.

## Competing on value and learning quickly

- Give Free users a visible first win before asking them to pay. Measure mailbox connected → real preview → accepted action → completed outcome → next-session return. Use first-party records for paid outcomes and consent-gated analytics for behavior; never send mailbox content to telemetry.
- Test the value proposition with five new users on the accepted branch. The [launch readiness audit](launch-readiness-audit-2026-09-22.md) contains the task protocol. Observe what they believe will move, whether they can explain Undo and Unsubscribe, and whether they understand Plus versus Pro.
- Publish a short real-product walkthrough from a controlled inbox after acceptance. Label synthetic demo data. Gather consented customer quotes and outcomes later; until then, use verifiable workflow proof and clear security/privacy explanations.
- Keep current prices through initial user interviews. Test Plus as a likely default for a one-inbox buyer and a limited one-time cleanup pass only after measuring checkout objections and support costs. Competing by lowering price alone would not fix trust or activation.

## Provider roadmap after Gmail launch

The schema only admits Gmail today; sync tracks Gmail history IDs; categorization, actions, Undo, deep links, and sign-in all assume Gmail semantics. Account ownership, sender aggregates, Activity, and inbox-count entitlements are reusable. “All email platforms” is a family of integrations, not a permission switch.

1. Add a simple provider-interest capture after launch and interview demand by provider and account type. Do not promise a date or full parity.
2. Spike Outlook.com and Microsoft 365 with a personal and a work account, a large mailbox, preview → move/delete → Undo, permissions, and admin-consent failure. Microsoft's Graph requires [per-folder delta sync](https://learn.microsoft.com/en-us/graph/delta-query-messages), [renewable change notifications](https://learn.microsoft.com/en-us/graph/outlook-change-notifications-overview), [immutable message IDs](https://learn.microsoft.com/en-us/graph/outlook-immutable-id), and delegated [Mail.ReadWrite](https://learn.microsoft.com/en-us/graph/permissions-reference). Make message selection and data minimization explicit.
3. Introduce provider-neutral auth, identity, sync, action, capability, and undo contracts. Ship Outlook personal/work beta with provider-specific behavior and honest feature flags. Planning range: roughly 6–10 weeks for two experienced engineers plus QA after a 3–5 day spike; refine against actual code and provider approval.
4. Evaluate Yahoo, iCloud and generic IMAP separately. [IMAP UIDs are folder-scoped and can change on move](https://www.rfc-editor.org/rfc/rfc9051.html); Yahoo and Apple have different [app-password](https://help.yahoo.com/kb/technical-support/generate-password-access-yahoo-mail-sln15241.html) and [authorization](https://support.apple.com/en-us/121539) paths. A further 6–10 weeks after the provider seam is a planning range, with per-host certification and likely reduced capabilities.

Do not map Outlook Focused/Other onto Gmail Promotions/Social, claim identical unsubscribe behavior, or expose actions whose preview and Undo cannot be honored on that provider.
