# Product experience audit — Gmail-native transition and launch surface

Date: 2026-07-12

Branch: `feat/d132-public-product-site`

Scope: authenticated product, onboarding, public website, trust copy,
instrumentation, SEO, and the current D/ADR constraints.

## Summary:

DeclutrMail's strongest market position is not "another inbox." It is a
Gmail control companion: Gmail remains the place to read, search, reply, and
compose; DeclutrMail reduces recurring inbox noise into inspectable sender
decisions. The product already has unusually strong foundations for that
position—deterministic recommendations, a canonical action registry, real
previews, worker-confirmed outcomes, an Activity record, and a narrow Gmail
data boundary.

The largest adoption risk is a trust-and-familiarity gap, not missing cleanup
power. A native Gmail user must learn five product verbs, an 11-route app,
manual-versus-future action scope, a separate Later concept, and plan-specific
recovery behavior. Any vague promise—especially universal undo, "decide once"
for future mail, or an "exact" privacy inventory that omits persisted
fields—makes that learning burden feel dangerous.

This buildout closes the public-product gap with one shared public shell, an
interactive synthetic inbox simulator that reuses production components, a
Gmail terminology bridge, product and methodology walkthroughs, a complete
Free/Plus/Pro tier story, five source-backed comparison pages, five Gmail
how-to guides, five direct-answer pages, three substantive essays, an
evidence-linked changelog with RSS, FAQ, sign-in, legal/support pages, and
recursive sitemap/`llms.txt` coverage. There are 36 indexable public routes;
`/demo` is a deliberate redirect to `/inbox-simulator`.

Final post-integration verification completed on the exact draft-PR bytes:

- Web, API, shared, and workers TypeScript: **pass**.
- Full tests: **2,805 passed, 11 skipped** across 252 files — web 1,084;
  API 939 + 10 skipped; shared 269; workers 513 + 1 skipped.
- Repository ESLint: **0 errors** (11 pre-existing unused-disable warnings).
  Prettier, `git diff --check`, executable rollback-script status, and
  `bash -n scripts/revert-pr.sh`: **pass**.
- Production Next.js build: **pass**, including all 63 generated page entries.
  Recursive HTTP smoke: **40/40** — all 36 sitemap routes plus `/demo`, RSS,
  `llms.txt`, and `robots.txt`; `/demo` resolves to `/inbox-simulator`.
- In-app browser: **pass** at 390 × 844 and 1440 × 900 on landing, pricing,
  simulator, comparison, and sign-in. Public/mobile navigation opens, closes on
  Escape, and restores focus; wide tables are keyboard-focusable internal
  scrollers; the consent close target is 44 px; landing has no document-level
  horizontal overflow. The simulator completed preview → confirm → Activity →
  undo, with no browser warning/error logs. The temporary viewport was reset.
- Browser QA caught and fixed three issues before this final run: a long trust
  sentence causing desktop overflow, paid cards incorrectly saying “No card
  required,” and a 36 px consent close target. New public-route traffic, demo
  preview/confirm/reset, pricing intent, and authenticated internal-UUID
  identity bridging remain consent-gated and privacy-scrubbed by implementation
  and tests.

## Strengths:

1. **Correct strategic unit:** sender-first review materially compresses the
   problem while Gmail continues to handle message reading and composition.
2. **Trustworthy mutation architecture:** previews, queued work, terminal
   worker confirmation, receipts, and verb-specific recovery are stronger
   than optimistic "done" UI.
3. **Deterministic recommendations:** volume, engagement, reply/protection
   signals, and explicit rules are inspectable; the product does not pretend
   to classify categories with an opaque model.
4. **Canonical product contracts:** KAULD verbs and tier capabilities come
   from shared registries/manifests, reducing public/app drift.
5. **Useful privacy wedge:** full bodies and attachments are not fetched; the
   public methodology now distinguishes the two bounded Anthropic paths and
   PostHog's non-Gmail product events.
6. **Recovery model:** Activity is a durable source of truth, Archive/Later
   have real inverse operations, and Delete now points to Gmail Trash recovery
   only while Gmail still retains the message rather than claiming a universal
   client-side undo.
7. **Launch discoverability:** every built public route is represented in the
   sitemap and `llms.txt`; comparisons expose unknown states instead of
   converting missing evidence into favorable checkmarks.
8. **Reversibility of this buildout:** implementation slices and intentional
   D amendments are recorded in
   `docs/execution/d-break-ledger-2026-07-11.md`; a merged slice can be reverted
   with `scripts/revert-pr.sh <PR_NUMBER> --push`.
9. **Registry-backed plan enforcement:** single-sender Free actions remain
   available, while multi-sender actions are now checked against the canonical
   selector tier before preview resolution and enqueue; the UI and structured
   402 upgrade path mirror the server rule.
10. **Entitlement checks at execution:** Autopilot apply/action workers now
    re-read the canonical capability before evaluating rules or touching Gmail.
    A Free/Plus downgrade leaves queued matches unapplied and preserves the
    user&rsquo;s prior Observe/Active state for a safe future upgrade.
11. **Mailbox-bound idempotency:** unsubscribe replay keys are reserved before
    policy/activity/outbox effects and bound to mailbox, sender ID, sender key,
    and verb. Cross-mailbox or cross-sender reuse fails with a structured 409
    instead of returning foreign identifiers or action handles.
12. **Conversion continuity without redirect risk:** pricing carries the exact
    Plus/Pro plan, billing cycle, and eligible promotion through Google OAuth
    and first-run onboarding. Both API callback and web route accept only a
    canonical local `/billing` destination, and billing opens the validated
    choice only after its authoritative availability read succeeds.
13. **Untrusted demo state fails closed:** simulator persistence accepts only
    canonical synthetic rows, verbs, sender names, recomputed counts, unique
    safe timestamps, and the exact versioned object shape. A malformed snapshot
    is discarded as a whole instead of crashing or rendering forged Activity.
14. **Export copy matches the export:** Settings and Privacy now enumerate the
    mailbox, sender-policy, message-metadata, and decision/activity datasets
    actually returned, plus the explicit exclusions. They no longer promise an
    “everything” export that omits preferences, billing, or encrypted OAuth
    credentials.

## Risks & Concerns:

### Gmail-native friction inventory

| Priority | Friction                                                       | Why a Gmail user hesitates                                                                                                                                                                | Current response                                                                                                                                      |
| -------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0       | Gmail deep links assume `/u/0`                                 | A multi-account user can land in the wrong mailbox, breaking the most basic round-trip trust                                                                                              | Separate `fix/d029-gmail-roundtrip-trust` worktree; merge before launch                                                                               |
| P0       | "Decide once" can imply future-mail policy                     | Manual Archive/Later/Delete currently affect the previewed messages, not all future mail                                                                                                  | Public copy and demo corrected; founder must choose whether standing sender rules are still desired                                                   |
| P0       | Unsubscribe was described like reversible mailbox work         | A delivered request leaves DeclutrMail and cannot be recalled                                                                                                                             | Canonical safety copy, legal/help, simulator, methodology, landing, and comparisons now state the one-way boundary                                    |
| P0       | Later is not Gmail Snooze                                      | Users expect a return time; DeclutrMail/Later is a label/review queue and its management surface is Pro-gated even when Free can invoke the action                                        | Public Gmail mapping added; recovery route/tier mismatch remains a founder decision                                                                   |
| P0       | Privacy headline can be read as the whole system inventory     | The locked list omits accepted outbound-recipient, unsubscribe, outbound-flag, and size metadata plus operational OAuth/action/account/billing records and bounded third-party processing | Public policy now lists non-message records and both Anthropic paths; the locked allowlist itself is founder-gated and already tracked in follow-ups  |
| P0       | Free could reach multi-sender actions through a forged request | A UI-only plan gate would let an under-tier client resolve a bulk preview or enqueue work that the Action Registry marks Plus-only                                                        | Implemented server checks before preview resolution and enqueue, disabled under-tier bulk controls/shortcuts, structured 402, and global upgrade flow |
| P0       | Downgraded workspaces could retain queued Autopilot effects    | A plan check only at rule creation leaves a race where an already-queued worker mutates Gmail after Pro access ends                                                                       | Apply/action worker choke points now re-check `hasCapability(tier, 'autopilot')`; Free/Plus do no evaluation, rescheduling, or Gmail effects          |
| P0       | Unsubscribe replay keys were not fully mailbox-bound           | Reusing one idempotency key across inboxes or senders could expose another request&rsquo;s result identifiers and couple side effects                                                     | Transactional reservation plus mailbox/sender/verb binding now returns 409 on conflicting reuse and preserves same-request replay                     |
| P0       | Mailbox scope is not always obvious                            | In a two-inbox Pro workspace, users need to know which account a count, action, Gmail link, or rule belongs to before confirming                                                          | Destructive previews now name the active Gmail account; multi-account links still depend on `fix/d029-gmail-roundtrip-trust`                          |
| P1       | Strict initial-sync blockade                                   | Waiting without a useful shell feels broken and hides value until the most failure-prone step completes                                                                                   | Keep accurate progress/error recovery; test a read-only progressive shell against D6                                                                  |
| P1       | Onboarding presents Pro automation to Free users               | The first-run promise can become an upsell before the user completes one useful action                                                                                                    | Default onboarding to a Free-safe first decision; introduce Autopilot after demonstrated value                                                        |
| P1       | Product vocabulary precedes familiar Gmail language            | Keep/Protect, Later/Snooze, Activity/undo, Observe/Active, Triage, Screener, Brief, and Quiet all arrive at once                                                                          | Public Gmail companion and sign-in expectation page now bridge terms; authenticated labels still need progressive disclosure                          |
| P1       | Eleven equal-weight sidebar destinations                       | A Gmail immigrant sees product architecture, not a guided cleanup journey                                                                                                                 | Group navigation into Decide, Automate, Review, and Settings; hide or collapse unavailable/advanced routes                                            |
| P1       | Undo visibility is surface-dependent                           | The recent undo tray is mounted in Triage, while Activity is the dependable recovery destination                                                                                          | Make Activity recovery explicit after every mutation; evaluate a shell-level recent-action control                                                    |
| P1       | Preview behavior is inconsistent                               | Several app actions bypass the same preview pattern used by sender cleanup, weakening learned safety                                                                                      | Mail-moving confirmations now fail closed when live scope is missing and name the active account; keep harmless Keep immediate                        |
| P1       | Session payoff implied future mail was prevented               | Adding a sender's monthly volume after a one-time Archive/Later or an unsubscribe attempt converted an estimate into an outcome claim                                                     | Replaced with terminal worker `affectedCount` as "messages moved"; unsubscribe attempts add no projected future volume                                |
| P1       | Paid pricing choices disappeared during sign-in                | After choosing Plus/Pro and a cycle, a Gmail user could finish OAuth/onboarding at a generic page and have to reconstruct the decision                                                    | A strict local billing intent now survives auth/onboarding and preselects the exact live checkout state; invalid or external destinations are dropped |
| P1       | Free cleanup quota is not concurrency-serialized               | Many distinct concurrent idempotency keys can all pass the read-before-write cap check, granting more than five Free actions in one burst                                                 | Rate limiting bounds abuse but does not make the cap atomic; add a workspace-scoped reservation/counter transaction before treating it as a hard gate |
| P1       | Three canonical outcome events do not reach analytics          | `rule_fired`, `unsubscribe_attempted`, and `billing_event` are typed and documented, but no server-to-PostHog emitter completes those terminal/webhook funnels                            | Activity and billing logs retain operational evidence; add a consent-aware terminal-event sink before building PostHog cohorts from these names       |
| P2       | Error and empty states share visual treatment                  | A failed fetch can look like an empty mailbox, producing incorrect user decisions                                                                                                         | Introduce a shared retryable ErrorState distinct from EmptyState                                                                                      |
| P2       | Mobile tables, cards, and drawer behavior drift                | Small targets, horizontal density, missing focus containment/Escape behavior, and selection bars make cleanup harder on mobile                                                            | Address in `fix/d207-ux-consistency-sweep`; verify at 390/768/1440 px                                                                                 |
| P2       | Color/spacing/width primitives drift                           | Literal colors, residual violet, inconsistent max widths, and per-screen headers make the product feel assembled rather than designed                                                     | Adopt shared PageShell/PageHeader/content-width/status-color primitives before further feature work                                                   |

### Launch and product-truth blockers

- **Privacy contract ratification:** the locked six-item message list in
  `CLAUDE.md` §2.1 and `packages/shared/src/copy/privacy.ts` says it is exact,
  while accepted ADR-0004/ADR-0021 and the schema also store outbound To/Cc
  recipients; unsubscribe HTTPS/mailto URLs and sender URL/method; the RFC
  8058 one-click flag; the derived outbound flag; and whole-message size
  estimate. If "exact" is interpreted system-wide, it also omits account
  identity/preferences, encrypted OAuth tokens and mailbox/sync state, sender
  decisions/automation, action jobs/Activity/undo identifiers, and
  billing/customer/subscription references. Surrounding policy copy now names
  operational classes and processors, but only a founder-ratified D-decision
  can reconcile the locked artifact. Until then, this is a launch blocker.
- **Annual Pro price:** D126 says $149/year while the current manifest says
  $190/year. Public pricing continues to derive from the manifest; the conflict
  remains explicit.
- **Canonical host:** apex `declutrmail.com` versus `app.declutrmail.com` must
  be settled before indexing and OAuth redirect review.
- **Paid conversion is operationally disabled:** deploy configuration still
  sets `BILLING_ENABLED=false`, and provider catalog price IDs are not present.
  Public paid CTAs therefore lead to the honest billing-disabled product state,
  not a purchasable checkout. Enable and verify the provider catalog before a
  commercial launch.
- **CORS correction requires a production redeploy:** the workflow source now
  accepts both apex and `app` origins without the `gcloud` comma-separator bug,
  but production does not change until that revision is deployed and smoked.
- **Operational proof:** a current redacted CASA letter, live support/privacy
  mailboxes, payment catalog IDs, production OAuth redirects, and a real
  multi-account smoke cannot be fabricated by code.
- **Comparison freshness:** competitive facts are dated "Last verified July
  2026" and link primary sources. They require a scheduled re-check, not a
  permanent claim.

## Trade-offs & Alternatives:

| Choice                                 | Selected posture                                                                   | Alternative                                         | Consequence                                                                                                                                    |
| -------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Gmail companion vs replacement inbox   | Keep Gmail as the reading/reply/search surface                                     | Build a full mail client                            | Companion posture lowers scope/access risk and preserves muscle memory; it must provide excellent round trips                                  |
| Synthetic demo vs live OAuth sandbox   | Local synthetic data using production TriageRow and ActionPreview                  | Require Gmail connection before proof               | Synthetic demo gives safe pre-auth understanding; it must stay visibly illustrative and never imply a real mailbox mutation                    |
| Manual action scope vs standing rules  | Manual cleanup affects only the preview; enabled Pro presets affect future matches | Make every sender verdict a permanent future rule   | Current split is safer and more inspectable, but "decide once" marketing must remain scoped                                                    |
| Familiar labels vs expert vocabulary   | Add Gmail mappings and staged education                                            | Rename every power feature                          | Mapping protects the distinctive product model; authenticated UI should still default to plain-language subtitles                              |
| Strict sync gate vs progressive access | Current gate remains until tested                                                  | Show partial sender index/read-only app during sync | Progressive access may improve activation, but counts and readiness must never be presented as final                                           |
| One large launch branch vs atomic PRs  | Work is implemented together but documented as fourteen revertible slices          | Merge as a monolith                                 | Split PRs make trust, demo, content, pricing, entitlement, metrics, analytics, visual, and SEO changes independently reversible and reviewable |
| Worker hard-stop vs rewriting rules    | Re-check entitlement at both mandatory Autopilot worker choke points               | Rewrite Active/Observe rules to Paused on downgrade | The selected gate is immediately reversible and preserves intent; rewriting would erase whether each rule had been Active or Observe           |

## Actionable Recommendations (Priority-Ordered):

1. **Merge the four existing trust/consistency branches before adding more
   features.** In order: multi-account Gmail round trips, sync error recovery,
   app layout consistency, then Gmail muscle-memory shortcuts/coaching. Review
   each against the D-break ledger and keep PR reverts independent.
2. **Resolve the six founder product decisions:** the locked privacy allowlist,
   manual future-mail scope, Later recovery access, progressive sync
   onboarding, default plain/power labels, and the $149/$190 annual Pro
   conflict. Canonical host is a seventh launch-operational decision.
3. **Make the first value loop Gmail-familiar:** Connect → accurate sync state →
   one synthetic practice row → one real previewed sender decision → Activity
   receipt → "Open in the correct Gmail account." Do not introduce Autopilot
   before that loop succeeds.
4. **Standardize authenticated layout:** one PageShell/PageHeader, content-width
   scale, retryable ErrorState, dialog/focus contract, responsive action bar,
   mailbox-context chip, and shell-level route grouping.
5. **Create a recovery contract:** every confirmation must state (a) messages
   affected now, (b) future-mail effect, (c) Gmail destination, (d) recovery
   mechanism/window, and (e) whether an external unsubscribe request is
   one-way. Activity is the canonical destination.
6. **Use the data already emitted to run a weekly product review:**
   - acquisition: public family view → demo preview → demo confirm → OAuth CTA;
   - activation: connect → sync success → first real preview → first confirmed
     action → onboarding finished;
   - trust: preview abandonment, recommendation override rate, undo/regret rate
     by verb and token age, Autopilot pause/reject rate, unsubscribe outcomes;
   - value: terminal worker-confirmed affected messages, time to first safe
     decision, weekly sender decisions, repeat-week rate, and observed future
     Autopilot outcomes; never infer recurring noise prevented from a one-time
     sender-volume estimate;
   - monetization: free-cap prompt → checkout start → verified billing event,
     split by the value already received before the prompt.
7. **Repair telemetry interpretation before optimizing from it:** auth now
   identifies with internal UUID after consent and requests a best-effort
   identity reset on logout without allowing analytics failure to block local
   cache clearing or navigation. The on-screen D33 payoff now uses terminal
   affected-message counts instead of projected monthly volume. Next, connect
   the currently dark `rule_fired`, `unsubscribe_attempted`, and
   `billing_event` contracts to a consent-aware terminal/webhook sink; verify
   server-side sync/action events join the same user/workspace model; and
   publish a dashboard dictionary so an unsubscribe request is never read as
   confirmed sender compliance.
8. **Keep public proof alive:** re-verify competitor sources quarterly, update
   changelog entries from shipped evidence, add screenshots only from a tested
   release, and never add testimonials/outcome percentages until first-party
   data supports them.
9. **Run accessibility and responsive acceptance as a release gate:** keyboard
   navigation, visible focus, reduced motion, dialog focus containment, 44 px
   touch targets, no horizontal overflow, and semantic heading/table structure
   at 390, 768, and 1440 px.

## Next Steps:

1. Keep the draft PR open for handoff with the verification above attached.
   Do not mark it ready until the privacy, Gmail round-trip, billing/catalog,
   canonical-host, CORS-redeploy, and current CASA/operational proofs below are
   resolved or explicitly waived by the founder.
2. Review and land this branch as the fourteen slices in the D-break ledger; use
   `scripts/revert-pr.sh` for any post-merge rollback.
3. Merge the independent authenticated-app worktrees after rebasing and
   resolving overlap; do not fold their behavior changes into the marketing PR.
4. Complete the founder/operations checklist (privacy ratification, host,
   annual price, mailboxes, billing catalog, OAuth/CASA evidence).
5. Establish the weekly funnel/trust dashboard and take the next product bet
   from observed drop-off—not from route count or feature volume.

## Optional Architecture Blocks:

```mermaid
flowchart LR
  Gmail["Gmail remains the inbox"] --> Index["Allowlisted metadata index"]
  Index --> Review["Sender-ranked review"]
  Review --> Preview["Current count + sample + Gmail changes"]
  Preview --> Confirm["Explicit confirmation"]
  Confirm --> GmailMutation["Gmail label / Trash mutation"]
  Confirm --> ExternalUnsub["External unsubscribe request"]
  GmailMutation --> Activity["Worker-confirmed Activity receipt"]
  ExternalUnsub --> Activity
  Activity --> Undo["Undo only where an inverse exists"]
  Review --> Autopilot["Explicit Pro preset: Observe → Active"]
  Autopilot --> GmailMutation
```

The architectural rule is simple: every downstream effect must preserve
mailbox context, current-versus-future scope, and recovery truth all the way
back to the preview that authorized it.
