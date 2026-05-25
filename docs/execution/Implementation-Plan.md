# DeclutrMail V2 — Drive Docs Audit

## Context

Before implementing anything, this audit reviews the 14 Codex-generated docs
in the "DeclutrMail - V2" Drive project against (a) each other and (b) the
Claude Design bundle (`declutrmail-design-system/`). The goal is to surface
concrete contradictions, gaps, and unrealistic decisions that would otherwise
become bugs the moment code starts being written.

**Source documents reviewed:**

- 00 Documentation Index
- 01 PRD Product Strategy
- 02 HLD Architecture
- 03 LLD Backend Design
- 04 Database Schema
- 05 UX Design System
- 06 Activity Audit Undo Model
- 07 Sync and Provider Integration
- 08 Observability Support Runbook
- 09 Claude Subagent Execution Plan
- 10 Testing QA Strategy
- DeclutrMail V2 — Product Market Validation, Pricing, and GTM Strategy (PMV)
- DeclutrMail V2 — Claude Autonomous Execution Setup
- Reddit Strategy (not yet reconciled — flagged separately)

**Bundle reference:** `declutrmail-design-system/project/DeclutrMail-v2/`
(colors_and_type.css, app.jsx, screens/*, lib/*, marketing/*).

Severity legend: **🔴 BLOCKER** = will produce wrong code if unresolved.
**🟠 GAP** = decision/spec missing, can't write confident code.
**🟡 NICE** = improvement, deferrable.

---

## Category 1 — Direct contradictions between Codex docs and the bundle

### 1. 🔴 Typography stack (Doc 05 §3 vs `colors_and_type.css`)

- **Codex 05:** "Primary: Geist Sans. Secondary: Geist Mono only for
  timestamps, operation IDs, Activity details, and rule previews."
- **Bundle:** Inter (sans) + Fraunces (display) + Source Serif 4 (body) +
  JetBrains Mono (eyebrow/grp/micro).

These produce *different products visually*. Geist reads austere/neutral
(Vercel-style); Fraunces reads editorial/warm. You spent 24 chat threads
landing on the bundle's stack. Doc 05 was written without seeing the bundle.

**Fix:** Pick one. Recommend the bundle wins → rewrite Doc 05 §3 to mirror
`colors_and_type.css` (Inter / Fraunces / Source Serif 4 / JetBrains Mono).

### 2. 🔴 Color tokens (Doc 05 vs `colors_and_type.css`)

- **Codex 05:** "calm neutral background, white elevated cards, restrained
  accent color." No hex values anywhere.
- **Bundle:** specific HSL — deep teal `#006B5F` primary, warm newsprint
  `#FAFAF7` background, three-layer paper system, defined gradients, line
  tokens with rgba on ink, shadow scale.

**Fix:** Make the bundle's CSS the canonical source. Doc 05 should *import*
it (or be marked superseded by it).

### 3. 🔴 Component vocabulary mismatch (Doc 05 §6 vs `lib/`)

- **Codex names:** PageShell, PageHeader, AccountSwitcher, MetricCard,
  SenderCard, SenderTable, SenderActionBar, ActionConfirmationSheet,
  ActionTray, ActivityLogTable, UndoBanner, AttentionBanner, EmptyState.
- **Bundle names** (`lib/*.jsx`): primitives, modals, cmdk, why-recommend,
  api-catalog, api-inspector, connection-state, tokens, search-sort-filter,
  DVAppShell, DVCommandPalette, DVToastHost, DVStressTestSwitcher,
  DVConnectionSwitcher.

Codex names things that don't exist in the bundle; the bundle ships things
Codex never anticipates (CommandPalette, ConnectionSwitcher, StressTest
Switcher, API Inspector).

**Fix:** Unify the component inventory. Recommend keeping Codex's *semantic*
names (PageShell, SenderCard, etc.) but mapping them to the bundle's
existing implementations. Add CommandPalette, ConnectionSwitcher, and API
Inspector to Doc 05 as first-class components — they are clearly part of
the user's intended experience.

### 4. 🔴 Screen list mismatch (Codex PR roadmap vs `screens/`)

- **Codex Doc 09 PR roadmap** ships: dashboard, sender list, sender detail,
  action framework, archive sender, activity, action feedback UX, undo,
  Autopilot rules, incremental sync, support admin, observability, billing.
- **Bundle `screens/`:** triage, brief, screener, snoozed, followups, quiet,
  senders, sender-detail, senders-review-session, senders-weekly-hero,
  activity, autopilot, settings, billing, onboarding.

Codex never names **Triage, Brief, Screener, Snoozed, Followups, Quiet
Hours**. PRD §4 mentions Screener and Morning Brief as "should-have soon"
but the bundle treats them as core screens.

**Fix:** Reconcile per screen — for each of {Triage, Brief, Screener,
Snoozed, Followups, Quiet}, decide *V2 launch* / *Phase 2* / *V3*. Then
update Doc 01 §4 and Doc 09 PR roadmap. Recommend: V2 launch = Triage +
Senders + SenderDetail + Activity + Settings + Billing + Onboarding;
Phase 2 = Brief + Screener + Quiet + Followups + Snoozed + Autopilot rules.

---

## Category 2 — Internal contradictions within the Codex docs

### 5. 🔴 "V2" vs "MVP" used interchangeably (Doc 01 §4 vs PMV §6)

- **Doc 01 §4 V2 must-haves:** OAuth, multi-account, readiness, metadata
  replica, sender profiles, recommendations, review list, detail page,
  Keep/Mute/Archive/Unsubscribe, bulk historical cleanup, future sender
  policy, Activity, Undo, **Autopilot rules foundation**, support/admin
  basics, observability.
- **PMV §6 MVP:** OAuth, metadata indexing, sender profiles, list, detail,
  recommendations, Keep/Archive/Auto-archive/Unsubscribe attempt, Activity,
  Undo for archive, simple Pro gate. **Explicitly excludes** Morning Brief,
  full Screener, Outlook, team/admin, complex rule builder, mobile,
  enterprise.

So "V2 must-haves" *includes* Autopilot foundation and support/admin, but
PMV's MVP explicitly excludes them.

**Fix:** Distinguish "V2 launch MVP" from "V2 full." Rename Doc 01 §4 to
"V2 Roadmap (all)" and add explicit "V2 Launch MVP" subsection that matches
PMV §6.

### 6. 🟠 Unsubscribe scope conflict (PRD §4 vs §9 vs PMV §6)

- PRD §4: Unsubscribe is V2 must-have.
- PRD §9 open: "Do we include Unsubscribe in launch or Phase 2?"
- PMV §6: included in MVP.

Three docs, three answers.

**Fix:** Decide. Recommend Phase 2. Unsubscribe is the riskiest provider
work (mailto: vs `List-Unsubscribe-Post`, opt-out tracking, no guarantee
of effect, complaints if it "didn't work"). Ship auto-archive-future as a
strict substitute at launch.

### 7. 🟠 Autopilot scope conflict (PRD §4 vs PMV §6 vs PRD §9)

- PRD §4: Autopilot foundation is V2 must-have.
- PMV §6 MVP: explicitly excludes "complex rule builder as first release."
- PRD §9 open: "Does Autopilot default to Observe Mode for all users or
  only work accounts?"

**Fix:** Define exactly what "Autopilot foundation" means in MVP. Recommend:
MVP ships "apply future-policy to one sender at action time" (sender_policy
table). True rule-evaluator + observe-mode = Phase 2.

### 8. 🟠 Free-tier cap undefined (PMV §8 vs PRD §9)

- PMV §8 Free: "1 inbox, see top noisy senders, 10–25 sender actions, basic
  Activity, 7-day undo, limited or no Autopilot."
- PRD §9 open: "What is the free-tier cap: senders, actions/day, inboxes,
  or Autopilot disabled?"

The Free → Cleanup Pass → Pro funnel needs a crisp boundary; "10–25 actions"
is vague.

**Fix:** Pick the cap. Recommend Free = read-only sender intelligence + **25
lifetime cleanup actions** + no future-policy + 1 inbox; Cleanup Pass =
unlimited cleanup for 7 days, no Autopilot, 1 inbox; Pro = unlimited +
Autopilot + 2 inboxes; Power = 5 inboxes.

### 9. 🟠 Multi-account in Free conflict (PRD §9 vs PMV §8)

- PRD §9 open: "Is multi-account Pro-only or free with a limit?"
- PMV §8: Free=1, Pro=1–2, Power=5.

**Fix:** Decide. Recommend Free=1, Pro=2, Power=5 (lock the lower band to
drive Pro upgrades).

---

## Category 3 — Architectural gaps / footguns

### 10. 🔴 Gmail API quota math is absent (Doc 07)

Initial sync of a 250k-message mailbox (Doc 10 names this as a target
size) = ~1.25M Gmail quota units per user. A Google Cloud project has 1B
units/day default. **At 1,000 concurrent paying users syncing on launch
day, you hit the quota.** Doc 07 mentions "rate-limit" but no per-user
budget, no concurrent-sync cap, no plan for quota increases.

**Fix:** Add Doc 07a — "Gmail API Quota & Budget":
- Compute estimated units per mailbox size.
- Define concurrent-sync ceiling per Google Cloud project.
- Plan project sharding or quota-increase request.
- Cap initial sync to N most-recent days for free tier; full sync gated
  behind Cleanup Pass / Pro.

### 11. 🔴 OAuth verification timeline absent (Doc 07, Doc 01)

`gmail.modify` is a restricted scope. Google requires **CASA Tier 2
security assessment** (4–12 weeks, $500–$15k) before unblocking >100 user
cap. Nowhere in 14 docs.

**Fix:** Add Doc 07b — "Gmail OAuth & Security Verification":
- Scopes requested (recommend `gmail.modify` + `gmail.metadata`).
- CASA tier required, assessment vendor, ballpark cost.
- 100-user cap reality: structure private beta to fit.
- Brand verification + homepage/privacy/terms requirements.

### 12. 🔴 No idempotency for inbound Pub/Sub (Doc 02 §6, Doc 07 §6)

Google Pub/Sub is **at-least-once**. Doc 03 §9 has idempotency for user
commands, but the *incoming* webhook handler has no dedupe — duplicate
historyIds will run sync twice.

**Fix:** Document handler dedupe. Either (a) a `processed_history_id` per
mailbox account and a `WHERE history_id > last_processed` gate, or (b) a
`pubsub_message_id` dedupe table with a 24h TTL.

### 13. 🟠 `sender_key` definition is hand-wavey (Doc 03 §11, Doc 04 §8/§9)

"stable sender_key scoped to mailbox account" — but no formula. What
about `notifications@notion.so` vs `team@notion.so`? Both Notion. One
key, two keys, or merged via aliases?

**Fix:** Define precisely. Recommend default
`sender_key = sha256("v1|" + normalized_email)` where normalize lowercases
and strips `+suffix` aliases. Add `sender_aliases` table later if users
want "treat all Notion sub-senders together." Document this in Doc 03 §11
and Doc 04.

### 14. 🟠 Drizzle vs Prisma not resolved (Doc 03 §2)

"Drizzle or Prisma" — every backend PR depends on this choice.

**Fix:** Pick. Recommend Drizzle: better JSONB handling, citext support,
schema-as-TypeScript, lighter at runtime. Document in Doc 03 §2 and an ADR.

### 15. 🟠 Outbox consumer mechanism unspecified (Doc 03 §9)

"Workers process outbox events" — but *how*? Poller? LISTEN/NOTIFY?
`SELECT FOR UPDATE SKIP LOCKED`?

**Fix:** Recommend `SELECT … FOR UPDATE SKIP LOCKED` poller every 200ms,
LISTEN/NOTIFY as a low-latency wake-up. Documented in Doc 03 §9.

### 16. 🟠 Encryption key management absent (Doc 04 §5)

"encrypted_refresh_token bytea" — but where does the key live? KMS? env
var? rotation policy?

**Fix:** Add Doc 03 §10b — "Secrets & Encryption":
- Envelope encryption via cloud KMS (recommend Google Cloud KMS since
  Gmail-adjacent).
- Per-record DEKs wrapped by KEK; rotate KEK quarterly.
- Plain env-var fallback for local dev only.

---

## Category 4 — UX / product reality checks

### 17. 🔴 "No partial product UI during sync" + 250k mailboxes = activation crater
(PRD §5, UX §10)

For a 50k–250k message mailbox, sync runs minutes to hours. Holding the
*entire* product behind a "Preparing your inbox" screen means users close
the tab and forget. Email notification helps a fraction. The trust-first
posture costs activation rate.

**Fix:** Reconsider the absolutism. Three options:
- (a) Tier the gate: dashboard + top-50-senders unlock at 5k messages
  indexed; rest unlocks at completion. Avoids "partial product" feel by
  framing it as "First look" vs "Full library."
- (b) Keep gate, invest hard in browser push + email + SMS notification.
- (c) Accept the trade-off, instrument funnel ruthlessly, kill the gate
  if drop-off > X%.

Recommend (a) — it's still safe, and the framing prevents the "incomplete
data" anxiety the gate is meant to avoid.

### 18. 🟠 MRR runway implication unacknowledged (PMV §7)

"$20k MRR in 12–24 months." That's $0 MRR for the first 6–12 months while
you're paying for OAuth verification, Gmail-app review, infra,
domain/email, and your time. The PMV doc doesn't say how this is funded.

**Fix:** Add PMV §19 — "Cash & Runway":
- Estimate burn (infra + verification + tooling).
- Cleanup Pass is the only near-term cash path. Time it to launch *before*
  Pro to bridge the gap.
- Decide: bootstrap (need savings), grant, or freelance income offset.

### 19. 🟡 Sample sender report mockup missing (PMV §17)

"Create sample sender report mockup" listed as a day-7 deliverable. Bundle
has `marketing/inbox-simulator.html` — is that the sample report or not?

**Fix:** Either (a) declare `inbox-simulator.html` as the sample report
and link it from the landing CTA, or (b) design a distinct "Sample Sender
Report" page that simulates what the user would see post-sync. Recommend
(a) — it already exists.

### 20. 🟡 Reddit Strategy doc not reconciled with PMV §11 distribution

The Drive has a "DeclutrMail Reddit Strategy" doc (20KB) plus a separate
PMV §11 distribution section. They probably overlap or contradict. Did
not read Reddit doc yet.

**Fix:** Read both, reconcile, fold Reddit-specific tactics into a single
distribution doc.

---

## Category 5 — Doc-organization gaps

### 21. 🟠 Drive folder structure is flat (Doc 00 self-admits)

Doc 00: "Drive connector exposed Google Doc creation/editing, but not
folder creation. I created all docs as native Google Docs with the same
prefix."

**Fix:** Either (a) you manually move all 14 docs into a Drive folder, or
(b) Claude OS bootstrap moves them all into `/docs/` in the repo, which is
where they belong long-term anyway (Doc 09 §4 prescribes this exact
structure). Recommend (b) — Drive is the wrong home for engineering docs.

### 22. 🟠 No ADRs for major decisions

Drizzle vs Prisma, Inter vs Geist, Free-tier cap, Autopilot scope — none
have a written decision log.

**Fix:** Create `/docs/adr/` during Claude OS bootstrap. Backfill ADRs for
the decisions resolved in this audit.

### 23. 🟡 No glossary / CONTEXT.md

14 docs use specific vocabulary (operation, Activity, sender_key,
readiness, Autopilot, Screener, Morning Brief, Cleanup Pass, observe mode)
with no single definition page.

**Fix:** Add `docs/Glossary.md` or `CONTEXT.md` during Claude OS bootstrap.

---

## Category 6 — Privacy / trust copy holes

### 24. 🔴 "Metadata only" doesn't define what counts as metadata

- Doc 04 §8 `mail_messages.snippet text` — Gmail snippets are ~200 chars of
  body text.
- Doc 07 §15: "Do not store full bodies/attachments."

Snippet *is* body text, just truncated. The "metadata only" claim is
technically violated by the schema.

**Fix:** Pick one and document precisely:
- (a) Drop `snippet`. Strictly metadata. Lose subject/preview context.
- (b) Keep `snippet` and rewrite privacy copy: "We store sender, subject,
  and a short ~200-char preview that Gmail generates — no full body, no
  attachments, no images, no link tracking."

Recommend (b). Then update privacy page wording so it's truthful.

### 25. 🟠 No legal/DPA review trigger documented (Doc 08 §10)

GDPR/CCPA implications of storing snippets + OAuth tokens. Doc 08
mentions "Data Retention and Privacy Operations" but no review process.

**Fix:** Add "Legal/Privacy review" entry to Doc 09's Human Approval Gates
list (which itself doesn't exist yet — referenced but not written).

---

## Quick-reference fix list (by severity)

**🔴 BLOCKERS to resolve before any UI/code (8):**
1. Typography stack — pick bundle (Inter + Fraunces)
2. Color tokens — bundle CSS is canonical
3. Component vocabulary — unify Codex names → bundle implementations
4. Screen list — reconcile per-screen launch/Phase 2/V3
5. "V2" vs "MVP" — distinguish launch MVP from full V2
10. Gmail API quota math — add quota & budget doc
11. OAuth CASA verification — add timeline & cost doc
12. Pub/Sub inbound idempotency — document dedupe
17. Sync gate UX — tier the readiness gate

**🟠 GAPS to resolve before backend code (12):**
6, 7, 8, 9, 13, 14, 15, 16, 18, 21, 22, 25

**🟡 NICE (3):** 19, 20, 23

---

## Recommended sequencing

1. **This session — close the 8 BLOCKERS.** I'll keep grilling one branch
   at a time until each has a written decision; capture decisions inline
   in this file.
2. **Next session — close the 12 GAPS** in the same way.
3. **After that — Claude OS bootstrap** (Doc 09's "first task"), which
   then materializes all 14 docs (now corrected) into `/docs/`.
4. **Then PR 0 → PR 1 → ... → PR 20** as Doc 09 prescribes.

---

## Decisions log (filled in as grilling resolves them)

### D1 — Typography stack: **Geist Sans + Geist Mono** (Doc 05 canonical)

User chose Codex Doc 05 over the bundle.

**Implications / follow-on work:**
- Bundle's `colors_and_type.css` must be rewritten: drop Inter/Fraunces/Source
  Serif 4/JetBrains Mono. Use Geist Sans for all body+display, Geist Mono
  for chrome (eyebrows/grp/micro/timestamps/operation IDs).
- Bundle's editorial niceties dropped: `.font-display-italic` with
  "WONK"/"SOFT" axes, `.editorial-dropcap`, the FAQ italic accents.
- Marketing pages (landing, FAQ, methodology, blog) lose the "warm
  editorial" feel and will read more like Vercel/Linear product pages.
- `.eyebrow / .grp / .micro` utility classes survive but switch to Geist
  Mono.
- The display scale `--text-display-xl … --text-display-sm` (clamp-based
  fluid sizes) still works with Geist; only the family changes.

**Action items captured:**
- Rewrite bundle `colors_and_type.css` fonts section to import Geist via
  `next/font/local` (or the `geist` npm package) once code starts.
- Update Codex Doc 05 §3 to be the canonical reference (no change needed).
- Re-design the marketing landing hero treatment for Geist (Fraunces
  italics → Geist semibold or oblique substitute).

### D2 — Color palette: **Cool/Vercel-style everywhere**

White background (`#FFFFFF`) + Geist + deep-teal `#006B5F` primary across
*both* product and marketing surfaces. Drop the warm-newsprint editorial
direction entirely.

**Implications / follow-on work:**
- Bundle `--background: 60 14% 97%` (warm #FAFAF7) → `0 0% 100%` (pure
  white), or promote `--background-cool: 210 20% 98%` to canonical.
- Drop `--paper: 70 11% 95%` (mid-layer warm) and the three-layer paper
  system. Use a single-elevation card system on white.
- `--foreground: 174 18% 7%` (warm ink) → cool dark `#0A0A0A` or
  `#171717` (Vercel/Linear standard).
- Keep `--primary: 174 100% 21%` (`#006B5F`) — it's the only carried
  accent.
- Drop `--secondary` mint and the `--gradient-hero` mint blend; keep
  `--gradient-primary` (teal → darker teal) for occasional emphasis.
- Hairline tokens (`--line`, `--line-soft`) recomputed against cool ink.
- Marketing pages (landing/methodology/pricing/blog/FAQ) need cooler
  treatment: drop newsprint, drop drop-cap, lean on white space + Geist
  weight contrast + occasional eyebrow chrome.

**Action items captured:**
- Rewrite bundle `colors_and_type.css` colors section to cool palette.
- Re-design marketing landing visuals — emphasize white space, teal
  buttons, Geist weight contrast (300/400/600/700), and the mono-eyebrow
  utility as the only "decorative" device.
- Codex Doc 05 §2 ("Visual Personality") remains canonical and matches
  this direction.

### D3 — Screen scope at V2 launch: **Bundle-loyal (ship everything)**

V2 launch includes all 13 bundle screens: Triage, Brief, Screener,
Snoozed, Followups, Quiet, Senders, SenderDetail, Activity, Autopilot,
Settings, Billing, Onboarding.

**Implications / follow-on work:**
- Doc 01 §4 (V2 must-haves) rewritten to add Triage, Brief, Screener,
  Snoozed, Followups, Quiet Hours.
- PMV §6 (MVP scope) rewritten to remove the "not initial V2" exclusions
  for Morning Brief, full Screener, complex rule builder.
- Doc 09 PR roadmap expanded by ~5 PRs (Brief, Screener, Snoozed,
  Followups, Quiet Hours) with their own data models.
- Schema additions needed beyond Doc 04:
  - `snoozed_threads` (id, mailbox_account_id, provider_thread_id,
    snoozed_until, snooze_reason, restore_on_reply, created_at)
  - `followup_tracker` (id, mailbox_account_id, provider_thread_id,
    sent_at, last_reply_check_at, status, escalate_at)
  - `quiet_hours_schedule` (id, workspace_id, mailbox_account_id, days,
    start_local, end_local, timezone, enabled)
  - `morning_brief_runs` (id, mailbox_account_id, brief_date,
    selected_message_ids, delivered_at, opened_at)
  - `screener_quarantine` (id, mailbox_account_id, sender_key,
    message_count, first_seen_at, decision, decision_at)
- Worker modules needed beyond Doc 03:
  - `MorningBriefWorker` (daily cron per timezone)
  - `SnoozeRestoreWorker` (timer-based)
  - `FollowupCheckWorker` (periodic reply-check)
  - `QuietHoursEvaluator` (gate inside ActionExecutionWorker)
- **Positioning risk acknowledged:** Snoozed/Followups/Quiet are
  productivity-tool features. Marketing copy and PMV doc must justify
  them as *sender-control extensions* (Snooze a sender's emails, not
  individual; Followup tracking via sender; Quiet Hours pause Autopilot
  per account) — not as standalone productivity features that compete
  with Gmail/Gemini.
- **Build-time risk acknowledged:** 13 screens before user feedback ≈ 6+
  months. Either accept the bet or break into launch waves (see below).

### D4 — OAuth verification: **Already approved (from V1)**

User has existing `gmail.modify` scope approval from Google and CASA
Tier 2 approval, both carried over from DeclutrMail V1. V2 is a redesign
on top of the same approval.

**Implications / follow-on work:**
- No 100-user cap. V2 can launch publicly from day 1.
- No $5-15k CASA spend at launch.
- No 4-12 week wait for assessment.
- Blocker #11 in the audit is **resolved**.

**Action items / follow-ups:**
- **Confirm the existing Google Cloud project + OAuth client is reused
  for V2.** If V2 uses a *new* GCP project, the verification is tied to
  the old project and would need to be re-applied. Recommend reusing the
  V1 project; renaming labels/branding is fine.
- **Confirm annual re-verification date.** CASA approval expires ~12
  months from issuance; schedule renewal at least 6 weeks ahead.
- **Confirm privacy policy + data handling alignment.** CASA approval is
  granted against a specific privacy posture. If V2 changes what is
  stored (e.g., adding `snippet` — see audit #24), Google may want a
  notice. Recommend treating the snippet decision as a CASA-relevant
  change.
- **Confirm OAuth scopes claimed match V2 scopes used.** If V1 claimed
  `gmail.modify` only and V2 needs `gmail.send` (for Followups
  escalation — see D3), that's a scope expansion and needs new approval.
- Add to `/docs/adr/` an ADR documenting carried-over verification, with
  the GCP project ID, CASA letter date, and renewal reminder.

### D5 — Gmail API quota plan: **Throttled queue + defer scaling decision**

Cap concurrent initial-syncs at ~50 via BullMQ rate-limiter. Request quota
increase from Google at 100 connected users. Defer multi-project sharding
unless growth surprises.

**Implications / follow-on work:**
- Add quota & throttling spec to Doc 07 (Sync) as new §17.
- BullMQ rate-limiter: configure per-mailbox-account concurrency=1 (one
  in-flight initial-sync per account) and global concurrency=50.
- Apply for quota increase via Google Cloud Console when MAU > 100. Pre-
  approval typically comes within 1-2 weeks for verified Gmail apps.
- Instrument `gmail_api_units_used` per project per day in observability
  (Doc 08 metric list — add to "Provider metrics").
- Alert at 60% of daily quota.
- Plan-B trigger documented: if quota wall is hit before increase is
  granted, fall back to capped sync depth (last 90 days only) for new
  users until headroom restored.

### D6 — Sync readiness gate: **Strict gate everywhere + waiting polish**

Bundle-as-designed. Full-block until sync complete. Heavy investment in
notification UX to make tab-closure recoverable.

**Implications / follow-on work:**
- Onboarding Step 3 (`screens/onboarding.jsx:223-291`) keeps the strict
  gate but the fake 5-second animation gets replaced with realistic
  progress reflecting actual backend state.
- Add browser-push permission request during Step 3 (before sync starts).
- Add email notification on completion ("Your inbox is ready").
- Add +24h reminder email if user has not returned.
- Add periodic estimated-time-remaining copy ("Usually 5-15 minutes for
  your mailbox size; we'll email you when done.").
- Add "tab can be closed" reassurance copy prominently.
- Sync error states (OAuth revoked mid-sync, Gmail outage, quota wall)
  need user-facing email copy too.
- Sync worker must emit reliable lifecycle events: `sync.started`,
  `sync.progress`, `sync.completed`, `sync.failed`, `sync.degraded`.
- These events drive both UI progress AND notifications.
- Document the notification trigger matrix in Doc 06 (Activity model)
  and Doc 08 (Observability).
- **Activation drop-off risk acknowledged.** Instrument funnel: %
  OAuth-completed → %-tab-still-open-at-+5min → %-clicked-completion-email
  → %-returned-and-took-first-action. Reconsider gate if drop-off
  cliff appears.

### D8 — Inbound Pub/Sub idempotency (no user input needed)

Standard fix for at-least-once delivery:
- Add `processed_history_id` column to `provider_sync_state` (already
  has `last_sync_cursor` per Doc 04 §6 — use that field).
- Webhook handler: load `last_sync_cursor`, only process if
  `incoming_history_id > last_sync_cursor`, advance the cursor inside
  the same DB transaction that upserts the message rows.
- Add a `pubsub_processed_messages` dedupe table for the Pub/Sub
  `message_id` itself (24h TTL) as defense-in-depth — Google can re-deliver
  the same message_id within ack deadline.
- Both gates documented in Doc 07 §6 as a new §6a.

### D7 — Snippet policy: **Keep, frame as "Gmail Preview"**

Store the ~160-char snippet that Gmail itself surfaces in the inbox list.
Privacy copy is explicit and accurate: *"We store sender, subject, and the
preview Gmail shows you in your inbox list. We do not read the email body,
attachments, or images."*

**Implications / follow-on work:**
- Schema keeps `mail_messages.snippet text` per Doc 04 §8.
- Rewrite Doc 07 §15 — remove "metadata only" absolutism, replace with:
  "Store sender, subject, snippet (~160 chars, as Gmail surfaces in
  inbox list), provider message/thread IDs, label IDs, dates, and read
  state. Do not store full body, MIME, attachments, images, or full
  headers."
- Onboarding `screens/onboarding.jsx:230-287` already uses this framing
  ("160-character preview Gmail shows you"); keep verbatim.
- Privacy page must mirror this exact language. Methodology page should
  show a side-by-side: "What Gmail's inbox shows / What we store" — same
  content, no extra.
- Bundle's "bodies read: 0" counter survives because *snippets are
  Gmail-surfaced previews, not body reads*. Make this explicit somewhere
  technical: snippets are fetched via `messages.get` with `format=metadata`,
  which returns Gmail's pre-computed preview, not the raw message body.
- **CASA disclosure:** If V1 disclosed strict metadata-only, the snippet
  change is a *material change* to the data-handling posture. Recommend
  emailing the CASA assessor with a short notice describing the snippet
  addition and the framing. May be a no-op, may trigger a re-review of
  one section — better to ask than to be surprised.

---

## 🔴 BLOCKERS — ALL RESOLVED (8/8)

Next: 12 🟠 GAPs to walk through. Sequencing roughly:
- pricing/tier mechanics (gaps 6, 7, 8, 9)
- backend implementation details (gaps 13, 14, 15, 16)
- governance & runway (gaps 18, 21, 22, 25)

### D19 — Pricing/tier structure (resolves gaps #8 + #9)

**5-tier ladder** (Notion/Linear/Figma shape), capability-bucket
differentiation, Cleanup Pass dropped, premium positioning at $9/$19.

| Tier | Price | Annual (2 months free) | Job (1 sentence) | Inboxes | Screens unlocked |
|---|---|---|---|---|---|
| **Free** | $0 | — | See what's noisy. | 1 | Senders + SenderDetail + Activity (read-only) + Onboarding + Settings + Billing. **5 lifetime cleanup actions** as taste. |
| **Plus** | $9/mo | $90/yr ($7.50/mo effective) | Clean it yourself, unlimited. | 1 | + Triage + unlimited manual Archive/Mute/Unsubscribe |
| **Pro** | $19/mo | $190/yr ($15.83/mo effective) | Let DeclutrMail keep it clean. | 2 | + Autopilot + Brief + Screener + Quiet + Snoozed + Followups; 30-day undo |
| **Team** | "Coming Q3 2026" | — | Do this together, with audit. | n/a | Visible on pricing page as waitlist entry — no purchase available at launch. |
| **Enterprise** | Contact Sales | — | Do this safely at scale. | n/a | Form gated to companies 50+ employees; auto-reply with Pro signup link for smaller. |

**Launch offer:**
- **Founding Pro: $129/yr** (32% off vs $190 standard annual, 43% off
  vs $228 monthly equivalent). First 250 paying users only. Price
  locked while subscription remains active.

**Funnel narrative (the key upgrade triggers):**
- **Free → Plus:** "I hit the 5-action limit; I actually want to clean
  this up."
- **Plus → Pro:** "I cleaned everything, but I want it to *stay* clean
  without me thinking about it." (Behavioral prompt after a Plus user
  has executed ~50 manual actions: *"You spent 12 min cleaning this
  week. Pro could do this for you automatically."*)
- **Pro → Team:** "I want my assistant / co-founder to see this too."
  (Team waitlist captures intent; build feature when waitlist hits 50.)
- **Team → Enterprise:** "Our security team asked about SOC 2 / DPA /
  data residency."

**Why these specific decisions:**
- **Capability buckets (Free=see / Plus=clean / Pro=automate)** instead
  of more-of-the-same-stuff quotas. Each tier opens a new chapter.
- **Cleanup Pass dropped** because Plus at $9/mo *is* the recurring
  Cleanup Pass — a cleanup-only user signs up monthly and cancels after
  their cleanup, with better margins than $29 one-time would have given.
- **$9/$19 moderate premium** because $19 is the last "individual
  purchase decision" psychological band before company-card friction.
  Headroom to raise to $12/$24 in 12 months when testimonials exist.
- **$10 gap between Plus and Pro** is the minimum credible upgrade
  incentive. A $5 gap wouldn't move people.
- **Team coming-soon at launch** — bundle has no real collab features
  yet; selling what doesn't exist burns trust. Enterprise placeholder
  alone carries legitimacy signal.
- **Enterprise auto-gated by company size** — prevents the form from
  becoming a Pro-signup-bypass channel.

**MRR math at this structure:**
- **Pure Pro:** 1,053 paying Pro users × $19 = $20k MRR (PMV target hit).
- **Mixed realistic:** 5k Free + 600 Plus ($5.4k) + 950 Pro ($18.0k) +
  100 Founding annual amortized ($1.07k) = **$24.5k MRR**.
- Both within PMV's 12-24 month window if SEO + Reddit + referrals
  perform as PMV §11 anticipates.

**Action items captured:**
- [CODEX PATCH 2026-05-18] Billing items below superseded — see **D117**
  (Paddle + Razorpay, no Stripe) and **D126** (Pro annual = $149, not $190).
  Originals retained for audit:
- Stripe products to create:
  - `plus_monthly` $9.00, `plus_annual` $90.00
  - `pro_monthly` $19.00, `pro_annual` $190.00
  - `pro_annual_founding` $129.00 (limited-redemption coupon, max 250 uses)
- `feature_flag` columns in workspaces: `tier` (free/plus/pro/team/enterprise),
  `seat_count`, `founding_member` (bool, locks price).
- Free-tier server-side gate: `lifetime_cleanup_actions_used` counter,
  blocks at 5 with upgrade modal.
- Pro feature gates: Autopilot/Brief/Screener/Quiet/Snoozed/Followups
  routes return 402 Payment Required if `tier ∉ {pro, team, enterprise}`.
- Multi-inbox gate: Free=1, Plus=1, Pro=2 inboxes; second inbox connect
  for Plus shows upgrade modal.
- Behavioral upgrade trigger in app: at action #50 on Plus, surface the
  "Pro could do this for you" modal once.
- Pricing page: 4 visible tiers (Free / Plus / Pro / Enterprise) with
  Team shown as "Coming Q3 2026 — join waitlist" entry below Pro.
- Document the full pricing in `docs/product/Pricing.md` per D16.
- ADR-0014 (added to D17's list) documents the tier-job framework.

**Open follow-ups (not blocking launch):**
- Family plan? (2 users at Plus price discounted, addresses "my spouse
  wants this too" segment) — defer to post-launch data.
- Educational/non-profit pricing? — defer.
- Per-region pricing? — defer; launch USD only.
- Refund policy: 14-day no-questions-asked for monthly, 30-day for
  annual. Adds to `docs/product/Pricing.md`.

### D9 — Unsubscribe behavior: **Auto-try with RFC 8058 → mailto → fallback**

When user clicks Unsubscribe on a sender:
1. If message has `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058)
   → fire one-click POST silently. ~95% success rate.
2. Else if message has `List-Unsubscribe: <mailto:opt-out@...>` →
   send opt-out email from a no-reply DeclutrMail address; include the
   user's actual email address in the body so the sender's system can
   match. ~50% success rate.
3. Else (no header) → log "no unsubscribe link available, auto-archive
   future applied" and create the future-archive sender_policy only.
4. **Always** pair the action with a future-archive sender_policy as
   defense.

**Implications / follow-on work:**
- Doc 07 §11 rewritten to specify the three-step cascade.
- New worker module: `UnsubscribeWorker` calling
  `ProviderAdapter.attemptUnsubscribe()` (per Doc 03 §10).
- Activity row records *attempt* not success: `status = succeeded` if
  RFC 8058 200 OK; `status = pending` if mailto sent; `status =
  needs_attention` only if both failed AND auto-archive also failed.
- Provider error mapping (Doc 07 §9) updated to handle `unsubscribe_*`
  outcomes distinctly.
- UI copy is *deliberately uncertain*: "We'll try to unsubscribe…" —
  never promise.
- An advanced setting in `Settings` enables a "Manual confirmation
  before send" toggle for paranoid users (per option B). Default off.

### D10 — Autopilot default mode: **Observe-first, prompt to activate after 7 days**

When user enables Autopilot:
- Mode = `observe` for 7 days from enable time (per-rule, not per-account
  — because user may add new rules later).
- Each rule match generates a `pending_autopilot_suggestion` row (new
  table) instead of an `action_operation`.
- UI shows "Pending Autopilot suggestions" tray with bulk-approve /
  bulk-dismiss / approve-some.
- At day 7, one-time prompt: "Autopilot has suggested X actions this
  week. Switch to active?" → toggles rule to `mode = active`.
- User can flip back to `observe` at any time per rule.

**Implications / follow-on work:**
- Schema: add `automation_rules.mode text default 'observe'` (values:
  observe/active/paused) and `automation_rules.activated_at timestamptz`.
- Schema: add `pending_autopilot_suggestion` table — id, workspace_id,
  mailbox_account_id, rule_id, sender_key, target_message_ids jsonb,
  preview_payload jsonb, status (pending/approved/dismissed/expired),
  expires_at, created_at.
- Rule evaluator (Doc 03 §12) branches: if rule.mode=observe → insert
  suggestion row; if active → insert action_operation as today.
- Autopilot screen has new "Suggestions" tab (Pending / Activity history
  / Rules).
- Cron job at day-7 anniversary of rule enable: insert
  `system_event(type='autopilot_promote_prompt')` that surfaces the
  upgrade prompt to user.
- Default 7-day window configurable per-workspace later (some users
  will want longer Observe).
- Doc 06 §10 (Undo model) needs to clarify: dismissing a suggestion
  is not an "operation" and doesn't need undo (it was never executed).

### D11 — Backend ORM: **Drizzle**

Schema-as-TypeScript. First-class JSONB, citext, partitioning support.
Lightweight runtime. Matches the Postgres-heavy schema in Doc 04.

**Action items:**
- Doc 03 §2 rewritten to specify Drizzle (drop the "or Prisma" caveat).
- Migration tooling: `drizzle-kit` for generation, `drizzle-kit push`
  for dev, `drizzle-kit generate:pg` + manual SQL for prod migrations.
- ADR documenting the choice and the JSONB/citext/partitioning rationale.

### D12 — sender_key formula: **sha256("v1|" + normalized_email)**

Normalize email: lowercase the entire address, strip `+suffix` aliases.
Example: `foo+notion@gmail.com` → `foo@gmail.com` → key.
Plus `sender_aliases` table for manual merges (user can group all
`*@notion.so` addresses under one Notion sender).

**Schema additions:**
- `sender_aliases` table — id, workspace_id, mailbox_account_id,
  primary_sender_key, aliased_sender_key, created_by_user_id, created_at.
- Sender lookup in API resolves via primary_sender_key when alias exists.

### D13 — Outbox dispatcher: **FOR UPDATE SKIP LOCKED poller + LISTEN/NOTIFY wake-up**

User said "no clue" — recommendation taken as default.

**Plain-English version (for the plan file's future readers):**

When the API accepts a user action, it writes a row to `outbox_events`
("todo for the workers"). The workers need to pick that up and act on it.

The pattern:
1. Workers `LISTEN outbox_inserted` (Postgres pub/sub — low latency).
2. When the API commits a transaction containing an outbox row, the same
   transaction runs `NOTIFY outbox_inserted` — Postgres delivers the wake
   signal to all listening workers.
3. A worker `SELECT id FROM outbox_events WHERE status='pending' ORDER BY
   created_at LIMIT 1 FOR UPDATE SKIP LOCKED` — Postgres atomically locks
   one row per worker, others "skip" and grab the next.
4. As safety net, workers also re-poll every 200ms in case a NOTIFY was
   missed (network hiccup, worker restart). Two redundant paths.

**Why it matters:** ~10ms typical latency from user action to worker
starting, durable through restarts, scales horizontally by adding more
workers (each one just grabs different rows).

**Action items:**
- Doc 03 §9 specifies this pattern.
- Migration adds `CREATE TRIGGER` on `outbox_events` insert →
  `NOTIFY outbox_inserted, NEW.id::text`.
- BullMQ optional layer on top if more sophisticated retry/backoff
  scheduling is needed later — for now plain Postgres is enough.

### D14 — Encryption keys: **Google Cloud KMS envelope (per-record DEK ← KEK)**

User said "no clue" — recommendation taken as default.

**Plain-English version:**

OAuth tokens (the secret that lets the worker act as the user on Gmail)
must be encrypted in the database. The encryption *key* itself has to
live somewhere safe — outside the database, outside the app's memory.

Pattern: **envelope encryption.**
1. Master key (KEK = Key Encryption Key) lives in Google Cloud KMS. App
   has IAM permission to *use* it but never sees the raw bytes.
2. For each OAuth token, app generates a random 256-bit key (DEK = Data
   Encryption Key), encrypts the token with the DEK (AES-256-GCM).
3. App asks KMS to encrypt the DEK with the KEK. Stores the encrypted
   DEK alongside the encrypted token in Postgres.
4. To decrypt: ask KMS to decrypt the DEK with KEK, then use DEK to
   decrypt the token.

**Why this and not a key in an env var:**
- Env var key never rotates without rolling all tokens.
- DB dump leak with env var key still in source control = total
  compromise.
- KMS keys rotate quarterly; even an old DB dump becomes unreadable
  after the KEK rotates.
- CASA renewal will ask "how are tokens encrypted at rest" — this is
  the answer that doesn't trigger findings.

**Action items:**
- Pick Google Cloud KMS (since you're already in GCP for Gmail). Region
  matches Gmail-accessing service region (us-central1 default).
- App service account gets `roles/cloudkms.cryptoKeyEncrypterDecrypter`.
- Schema: `provider_connections.encrypted_refresh_token bytea`,
  `encrypted_access_token bytea`, `dek_encrypted bytea`,
  `kek_version int` (so rotation can be tracked).
- Doc 03 §10b (new section) documents the envelope flow.
- Local dev posture: env-var-based key with a giant warning comment;
  dev tokens are test-account only.

### D15 — Runway: **Side-income funded, no monetization-driven phasing**

User funds the build via job/freelance income. No pressure to ship a
3-screen MVP for cash flow. **Full 13-screen V2 ships together when
feature-complete.**

**Implications:**
- Pricing/tier brainstorm (D-deferred-1) is not on a deadline.
- Cleanup Pass can be a *fast-follow* (week 2 post-launch) rather than
  the wedge, freeing the launch story to be the full Pro experience.
- PMV §19 (runway) entry in the doc: "Build funded by external income;
  no internal cash-flow constraints on scope phasing."
- Time-pressure constraints come from product-market validation cycles
  (does the wedge work?) rather than burn rate.

### D16 — Doc location: **Move 14 Drive docs into `/docs/` in the repo**

Drive is the wrong long-term home for engineering docs. Doc 09 §4
prescribes the exact `/docs/{product,architecture,backend,frontend,
operations,execution}/` tree.

**Plan:**
- Claude OS bootstrap PR copies each Drive doc verbatim (then patches
  per the decisions in this grill) into:
  - `docs/product/PRD.md` ← Doc 01 + applicable PMV sections
  - `docs/product/Pricing.md` ← PMV §8 + D-deferred-1 outcome
  - `docs/product/Open-Decisions.md` ← Remaining open questions
  - `docs/architecture/HLD.md` ← Doc 02
  - `docs/architecture/Provider-Abstraction.md` ← Doc 07 §2-4
  - `docs/architecture/Sync-Architecture.md` ← Doc 07 §4-8
  - `docs/architecture/Action-Orchestration.md` ← Doc 03 §6-10
  - `docs/architecture/Security-Privacy.md` ← extracted from 04+07+08
  - `docs/backend/API-Design.md` ← Doc 03 §5
  - `docs/backend/Database-Schema.md` ← Doc 04 (with D-additions)
  - `docs/backend/Workers-and-Queues.md` ← Doc 03 §3 workers
  - `docs/backend/Rules-Engine.md` ← Doc 03 §12 + D10
  - `docs/backend/Idempotency.md` ← Doc 03 §9 + D13
  - `docs/frontend/UX-Design-System.md` ← Doc 05 (with D1 + D2)
  - `docs/frontend/Component-Spec.md` ← Doc 05 §6 + bundle components
  - `docs/operations/Observability.md` ← Doc 08
  - `docs/operations/Support-Runbook.md` ← Doc 08
  - `docs/operations/Testing-QA.md` ← Doc 10
  - `docs/operations/Release-Checklist.md` ← from D6 + Doc 10 §11
  - `docs/execution/Claude-Subagent-Plan.md` ← Doc 09
  - `docs/execution/PR-Roadmap.md` ← Doc 09 §5 + D3 additions
  - `docs/execution/Guardrails.md` ← Codex Autonomous Execution Setup §5
  - `docs/execution/Human-Approval-Gates.md` ← Codex Autonomous Setup §12 + D25
  - `docs/Glossary.md` ← new, from terminology used across docs
- Drive copies marked "SUPERSEDED — see repo `/docs/`" via a banner at
  the top of each Drive doc.

### D17 — ADR system: **`/docs/adr/` with template; backfill from this grill**

Add `/docs/adr/0000-template.md` (Markdown Architecture Decision Record
template — title, status, context, decision, consequences). Backfill:

- ADR-0001 — Typography: Geist Sans + Geist Mono (from D1)
- ADR-0002 — Color palette: Cool/Vercel-style (from D2)
- ADR-0003 — Screen scope: bundle-loyal 13 screens at V2 (from D3)
- ADR-0004 — OAuth/CASA: V1 approval reused (from D4)
- ADR-0005 — Gmail quota: throttled queue + defer scaling (from D5)
- ADR-0006 — Sync gate: strict everywhere + waiting polish (from D6)
- ADR-0007 — Snippet: stored, framed as "Gmail preview" (from D7)
- ADR-0008 — Unsubscribe: RFC 8058 → mailto → fallback (from D9)
- ADR-0009 — Autopilot default: Observe-first, prompt at day 7 (from D10)
- ADR-0010 — Backend ORM: Drizzle (from D11)
- ADR-0011 — sender_key: sha256("v1|" + normalized_email) (from D12)
- ADR-0012 — Outbox dispatcher: FOR UPDATE SKIP LOCKED + LISTEN/NOTIFY (D13)
- ADR-0013 — KMS: Google Cloud KMS envelope encryption (from D14)

### D18 — Legal/DPA review trigger: **Add to Human-Approval-Gates**

Add `docs/execution/Human-Approval-Gates.md` entry: any change that
materially affects data-handling posture (storing new field types, adding
new OAuth scopes, opening new data sharing) requires legal/DPA review
*before* schema migration ships.

**Triggers:**
- New columns storing user content (body, attachments, headers).
- New OAuth scopes requested.
- New third-party data processors (e.g., adding an LLM API call).
- Pricing pages or terms that imply data use changes.
- Annual CASA re-verification cycle.

**Action:** the hook `verify-no-body-storage.sh` (Codex Autonomous Setup
§8) already enforces some of this at the code level. Pair it with the
manual approval gate for non-code triggers.

---

## 🟠 GAPs — RESOLVED (8 of 12) + DEFERRED (2 of 12)

- ✅ #6 Unsubscribe → D9
- ✅ #7 Autopilot → D10
- ⏸ #8 Free-tier cap → D-deferred-1 (pricing brainstorm)
- ⏸ #9 Multi-account → D-deferred-1 (pricing brainstorm)
- ✅ #13 sender_key → D12
- ✅ #14 Drizzle vs Prisma → D11
- ✅ #15 Outbox consumer → D13
- ✅ #16 Encryption KMS → D14
- ✅ #18 Runway → D15
- ✅ #21 Doc location → D16
- ✅ #22 ADR system → D17
- ✅ #25 Legal/DPA review → D18

## 🟡 NICE items — to revisit during Claude OS bootstrap

- #19 Sample sender report — promote `marketing/inbox-simulator.html` as
  the secondary CTA target on the landing page; revisit if a distinct
  page is needed after first user feedback.
- #20 Reddit Strategy doc — read and reconcile with PMV §11 distribution
  during marketing/GTM work (not blocking core build).
- #23 Glossary — created as `docs/Glossary.md` during D16 doc migration.

---

## Status: Audit + initial grill complete. Now in deep brainstorm.

User has elected to brainstorm every product, backend, infra, and GTM
decision before producing the final implementation plan, because the
build will be executed by Claude subagents/hooks/guardrails and spec
precision matters more than speed.

## Brainstorm Roadmap (approved)

**Phase 1 — Product behavior specs (most leveraged, locks downstream)**
1. Recommendation engine rules ← *IN PROGRESS*
2. Triage screen UX
3. Sender Detail screen
4. Senders list screen (table + grid)
5. Activity screen
6. Brief feature
7. Screener feature
8. Snoozed feature
9. Followups feature
10. Quiet Hours feature
11. Autopilot rule format
12. Onboarding flow + copy
13. Settings screen
14. Billing screen

**Phase 2 — Marketing + brand**
15. Brand name / domain
16. Marketing site IA
17. Landing hero + sections
18. Methodology page
19. Comparison pages
20. Privacy + Terms drafts

**Phase 3 — Backend specs**
21. Database schema final
22. API endpoint specs
23. Worker job specs
24. Notification system
25. Error / empty / loading states

**Phase 4 — Infra + governance**
26. Repo structure
27. Hosting
28. Observability stack
29. CI/CD pipeline
30. Security hardening
31. Test strategy
32. CLAUDE.md content
33. Subagent definitions
34. Hook scripts
35. Skill definitions

**Phase 5 — GTM**
36. Launch sequencing
37. Reddit strategy reconciliation
38. SEO content plan

---

## Phase 1 / Topic 1 — Recommendation engine rules

### D20 — Verdict set: **4 verdicts (Keep / Archive / Unsubscribe / Screen)**

Drop Mute (no clear distinct use case in DeclutrMail's wedge — users who
want manual management aren't the target). Drop Open as a verdict (move
to `is_primary` classification flag on `sender_profiles`).

**Verdict definitions (operational):**
- **Keep** — No Gmail call. Records `sender_policy(policy_type=keep)`.
  Sender disappears from Triage permanently. *No action sheet.*
- **Archive** — Action sheet opens asking: (a) archive existing N
  messages yes/no, (b) auto-archive future yes/no. Worker uses Gmail
  `batchModify` to remove INBOX label per (a); creates
  `sender_policy(future_action=archive)` per (b).
- **Unsubscribe** — Action sheet opens asking: (a) try unsubscribe
  (RFC 8058 → mailto → fallback per D9), (b) historical handling
  (archive / delete / leave alone), (c) future auto-archive fallback
  yes/no (default yes). Parallel workers execute.
- **Screen** — Sender moved to `DeclutrMail/Screened` Gmail label
  (out of inbox, not archived). Surfaces in Screener queue for batched
  user review. Screener flow asks user to pick Keep/Archive/Unsubscribe
  for each.

### D21 — Decision architecture: **Hybrid (cascade + scoring + protection model)**

**Three phases of evaluation in order:**

**Phase A — Hard cascade ("respect rules" — always Keep, exit):**

1. User has `sender_policies(policy_type=protect)` set manually
   → **Keep (locked, conf=1.0)**, exit.
2. User has replied to this sender ≥ 1 time (any time, any account)
   → **Keep (locked, conf=0.98)**, exit. *Reply is the strongest
   positive engagement signal a user can give.*
3. Gmail classifies sender as `Primary` group
   → **Keep (conf=0.95)**, exit. Sender_profile flagged `is_primary=true`.
4. User has starred ≥ 1 message from this sender in the past year
   → **Keep (conf=0.92)**, exit.
5. `read_rate ≥ 50%` over last 90 days
   → **Keep (conf=0.85)**, exit. "Engaged reader."
6. `first_seen_months ≥ 60 AND read_rate ≥ 30%`
   → **Keep (conf=0.80)**, exit. "Long relationship still engaged."

**Phase B — Insufficient signal (always Screen, exit):**

7. `total_messages < 3 OR first_seen_days < 7`
   → **Screen (conf=0.70)**, exit. "Too new to judge."

**Phase C — Scoring (Archive vs Unsubscribe; max wins):**

For senders that fall through, compute scores from independent signals:

```
archive_score =
  + 0.30 if monthly_volume >= 30          # noisy
  + 0.20 if monthly_volume >= 60          # very noisy
  + 0.30 if user_manually_archived >= 3   # user pattern
  + 0.15 if has_unsubscribe_header        # corroborating

unsubscribe_score =
  + 0.40 if read_rate < 0.05              # near-zero engagement
  + 0.30 if read_rate < 0.20              # weak engagement
  + 0.30 if spike_ratio >= 3              # behavior change
  + 0.20 if has_unsubscribe_header        # opt-out cheap
  + 0.20 if gmail_category in {Promotions, Forums, Social}
  + 0.20 if monthly_volume >= 60          # ongoing burden
  + 0.10 if last_seen_days >= 30          # stale
```

**Verdict = argmax(archive_score, unsubscribe_score).**
**Confidence = winner / (winner + loser)** clamped to `[0.55, 0.95]`.

If **both scores < 0.50** → **Screen (conf=0.60)** ("low confidence,
defer to user"). This catches the ambiguous-known-sender case.

**Why hybrid:**
- Cascade gives a *clean audit story* for protections — "we kept this
  because *you replied to them*" reads better than a probability score.
- Scoring lets nuance live in the middle — Archive vs Unsubscribe is
  often close, and the relative weights matter more than absolute
  thresholds.
- Screen as low-confidence fallback prevents the engine from making
  bad calls on ambiguous senders.

### D22 — Protection model: **Sender-layer-only, engagement-respect + user-defined**

**No category prediction anywhere in the product.** The 6 "engagement
respect" rules in D21 Phase A serve as protection. Plus user can mark
any sender as Always-Keep manually (sender_policies.policy_type=protect),
which is rule #1 in the cascade.

**Why:** DeclutrMail's wedge vs Clean Email / SaneBox is *we don't guess
categories.* Category prediction is unreliable (the same bank sends both
2FA codes and marketing emails) and a sure way to lose trust. Engagement
signals are observed, not predicted, and reliable.

**Removed from earlier draft:**
- ~~Domain pattern matching (`*.irs.gov`, etc.)~~ — category prediction
  in disguise.
- ~~Subject-keyword sniffing~~ — fragile and feels invasive.
- ~~"Transactional sender" auto-detection~~ — same problem.

**Action items captured:**
- Schema addition: `sender_policies.policy_type` extended to include
  `protect` (already in Doc 04 §11; just confirm).
- UI: Sender Detail page has "Always Keep this sender" toggle that sets
  the protect policy.
- Settings has a "Protected Senders" list view (manage all protects).

### D23 — New sender default: **Screen**

Senders with `total_messages < 3 OR first_seen_days < 7` default to
**Screen verdict** (Phase B in D21). User reviews in Screener queue on
first encounter.

**Implications:**
- First-time onboarding: user sees the bulk of their inbox already
  decided (existing senders with engagement signals), plus a small
  Screener queue of truly new senders.
- After onboarding, the Screener acts as a quarantine for new
  unknown-sender mail — they don't land in inbox until user decides.
- Pairs with `screener_quarantine` table (per D3).

### D24 — LLM role: **Haiku for explanation only, template fallback**

Recommendation *verdict* is fully deterministic (D21 cascade + scoring).
LLM is used **only** to generate the human-readable explanation copy that
appears in the Triage hero, sender card popover, and Sender Detail.

**Architecture:**
- Model: Claude Haiku 4.5 (cheapest, fastest current).
- Prompt: sender display name + domain, monthly volume, read rate, Gmail
  category, top 2-3 supporting rule labels. *Never the actual email
  content.*
- Output: 1-2 sentence explanation in DeclutrMail brand voice.
- Caching: explanation tied to `(sender_key, stats_version)` — if
  sender's signals don't change, explanation is reused. Most senders
  won't re-generate after first compute.
- Async/non-blocking: explanation generation runs in the
  `RecommendationWorker` (D21 trigger event); if it hasn't completed
  by render time, UI falls back to a deterministic template
  (`"{name} sends {N}/mo. You open {pct}%. Recommended: {verdict}."`).
- If LLM call fails (timeout, rate limit, content filter), template
  copy is used. Activity records `generated_by='template'` in that case.

**Cost estimate:**
- ~$0.0001 per explanation call (Haiku pricing).
- 5k senders/user at onboarding = ~$0.50/user one-time.
- ~50 trigger events/user/day for signal-change re-explanations = ~$0.005/user/day.
- At 1,000 Pro users: ~$5/day = **~$1.8k/year LLM spend**. Acceptable.

**Action items captured:**
- Doc 03 §11 amended: deterministic verdict; LLM for explanation only.
- Schema: `sender_recommendations.generated_by text` (heuristic_template /
  llm_explanation / llm_failed) and `model_version text`.
- Worker: `RecommendationWorker.generateExplanation()` async with
  template fallback baked in.
- Brand-voice prompt template lives in `lib/llm-prompts/recommendation.ts`
  and is version-controlled (changing the prompt = new model_version).
- Privacy: Haiku calls never include email content — only sender
  metadata + computed signals. Document in privacy page.

### D25 — Re-score cadence: **Trigger-based (sync + signal change)**

Initial computation at sync completion. Re-computation triggered by:
- New message arrives from sender (Pub/Sub → sync worker emits
  `sender.stats_changed` event)
- User takes a related action (clicked Keep/Archive/Unsubscribe nearby)
- Volume spike detected (≥3× over rolling 30-day baseline)
- Cron sweep (weekly safety-net rebuild for any senders missed by
  trigger events)

**Implications:**
- `sender_profiles.stats_version` increments on each re-score; UI
  invalidates cache on version change.
- `RecommendationWorker` consumes `sender.stats_changed` events from
  the outbox (D13 mechanism).
- Pub/Sub burst on a noisy sender → debounced to one re-score per 60s
  per sender to avoid thundering herd.
- Daily batch is replaced by *weekly safety-net* — cron sweep that
  re-computes any sender not touched in 7 days. Cheap insurance.

### D26 — Reasoning UX: **Mixed (inline on Triage hero, popover elsewhere)**

- **Triage hero card:** Reasoning shown inline (1-2 lines under the
  verdict badge). Premium, transparent.
- **Sender card in table/grid:** Bundle's `DVWhyPopover` on hover/click
  shows full reasoning. Compact rest state.
- **Sender Detail screen:** Full reasoning section, always expanded.
  Includes supporting rules and dissenting rules ("we also noticed: …").
- **Activity row:** "Why this happened" expanded view shows the
  reasoning that was in effect *at the time of the action* (frozen
  copy of the explanation, not regenerated).

**Implications:**
- `sender_recommendations.reason_summary text` stores the LLM-generated
  or template-generated 1-2 sentence copy.
- `sender_recommendations.supporting_facts jsonb` stores the rule IDs
  and human-readable labels for popover rendering.
- Activity captures a snapshot: `activity_log.metadata.reason_at_time`
  freezes the explanation so historical context doesn't drift.

---

### Topic 1 complete: **Recommendation engine decisions D20–D26 captured.**

Topic 1 produced 7 decisions covering verdict set, decision architecture,
protection model, new-sender default, LLM role, re-score cadence, and
reasoning UX. Ready for Topic 2.

---

## Phase 1 / Topic 2 — Triage Screen

### D27 — Triage cadence: **Daily ritual**

"Today only." Queue refreshes once per 24h with a curated handful of
senders. Empty state after clearing = "You're done for today. Come back
tomorrow." Drives daily-active-user metric.

**Implications:**
- Queue is computed at `daily_triage_run` time (early morning user-local).
- `daily_triage_queues` table: id, mailbox_account_id, queue_date_local,
  sender_keys jsonb (ordered), generated_at, completed_at.
- Refresh trigger: cron worker runs per-mailbox at user's local 6am
  (timezone from settings).
- User can request manual refresh after clearing (button) but it advances
  to *tomorrow's* queue rather than expanding today's — preserves the
  "30 seconds of work" framing.
- Each verbal decision excludes the sender from the next ~7 days of
  Triage queues (configurable per-verdict: Keep = permanent exclude;
  Archive/Unsub = excluded forever from Triage unless decision is
  reversed; Screen = excluded for 7 days then re-evaluated).

### D28 — Queue ranking: **Hybrid (confidence-first first 30 days, noise-impact after)**

**First 30 days post-onboarding:**
Queue ordered by `confidence DESC` from the recommendation engine. New
users see easy wins (high-confidence Archive/Unsubscribe) first to build
trust through quick early successes.

**Day 30 onward:**
Queue ordered by `inbox_noise_score = monthly_volume × (1 − read_rate)`
DESC. Returning users see max-clutter senders first for max value per
minute.

**Implications:**
- `users.triage_ranking_mode` flag flips on day 30 (or after user has
  completed N ≥ 50 triage decisions, whichever comes first).
- Both rankings still respect the recommendation engine — Triage only
  surfaces senders with non-Keep verdicts (Keep senders are excluded
  by design; the user has nothing to decide there).
- Verbose ranking debug surfaces in API Inspector (already in bundle as
  `lib/api-inspector.jsx`).

### D29 — Screen as the 4th verb (S key)

Triage buttons: **K**eep / **A**rchive / **U**nsubscribe / **S**creen.
Each row gets all four buttons with single-letter keyboard shortcuts.

**Implications:**
- The bundle's existing `triage.jsx` VERBS array needs `mute` replaced
  with `screen` (S key, color = neutral gray rather than amber).
- "Screen" verbatim in UI = "Skip — decide later." Tooltip explains:
  *"Move to Screener queue; review in a batch later."*
- Screened-from-Triage senders show in Screener with "snoozed from
  Triage on {date}" context.

### D30 — Queue size: **Adaptive 5–12 based on inbox activity**

Queue defaults to 5–8 senders most days. Pushes up to 12 max on days
when there's a backlog of new noisy senders accumulated since last visit.

**Algorithm sketch:**
```
backlog_count = senders with non-Keep verdict, not seen by user in last 7 days
target_size = clamp(max(5, ceil(backlog_count × 0.4)), 5, 12)
queue = top `target_size` senders by ranking algorithm (D28)
```

The 40% factor means a user with 50-sender backlog clears it in ~5 days,
not all at once — preserves daily-ritual feel while progressing
meaningfully.

### D31 — Recommended verb emphasis: **Highlight only when confidence > 0.85**

Recommended verb button gets a subtle pre-focused glow / soft background
fill when engine confidence ≥ 0.85. Below 0.85, all 4 buttons render
equally weighted.

**Implications:**
- Visual treatment: matched button gets `palette.bg` at 1.5× intensity
  + a 1px solid border in palette.fg color. Distinct but not screaming.
- Keyboard: highlighted button doesn't auto-focus — user still presses
  the letter explicitly (preserves the "you decide" feel). No accidental
  Enter-applies.
- Tooltip on highlighted button: *"Recommended (high confidence)"*.
- Action surfaces in sender_recommendations.confidence value — UI reads
  it server-side, no client computation.

### D32 — No bulk operations in Triage

Bulk archive / bulk unsubscribe / multi-select live on the Senders screen
(power-user surface). Triage is strictly one-row-at-a-time to preserve
the "30 seconds of work" daily-ritual feel.

**Implications:**
- Triage row UI shows only single-sender action buttons. No checkbox.
- Senders screen UI exposes multi-select with shift-click + bulk-apply
  via top-of-table action bar (per Topic 4 — Senders screen brainstorm).

### D33 — Empty state: **Stats summary + come back tomorrow + subtle upgrade nudge**

When the daily queue is cleared:

```
"You cleared 8 senders today."

Estimated impact:
• ~840 future emails will skip your inbox
• ~12 min/week saved on email triage

Come back tomorrow for tomorrow's queue.

[ Pro could do this for you automatically. Learn more → ]
```

**Implications:**
- "Estimated impact" numbers computed from decided senders' monthly_volume
  × 12 (annual extrapolation, scaled to per-week display).
- Upgrade nudge is a single soft link, not a banner. Pro tier badge in
  the corner if user is on Free/Plus. Hidden for Pro users (replaced
  with a streak/momentum graphic).
- Stats are *real, not gamified* — no fake "achievements" or badges.
  Calm/premium tone preserved.

### D34 — Action sheet on Archive/Unsubscribe: **Always show + remember-preference toggle in Settings**

Doc 05 §8 strict by default — every Archive/Unsubscribe opens the sheet
to confirm historical/future scope. Settings has an opt-in
**"Apply last preference by default for Archive and Unsubscribe"**
toggle (default off). Power users can flip it on to skip the sheet.

**Implications:**
- `users.preferences.skip_action_sheet bool default false`.
- When toggle is on, action sheet only opens for sender_policies that
  conflict with last preference (e.g., user defaulted to "archive
  existing + future" but is now Archiving a protected sender — sheet
  re-opens for explicit confirmation).
- The sheet's "remember this" checkbox stores per-verdict last choice
  on the user record.
- Onboarding doesn't mention this toggle — discovery is reserved for
  users who naturally look at Settings (power-user feel).

### D35 — Undo via persistent action tray (Doc 05 §11)

Footer strip appears after first action of the session:

```
3 decisions applied · Undo last · View Activity
```

**Implications:**
- Tray persists during the session and for 3 seconds after queue
  empties (so user can still undo).
- Tray expandable: click on the count → drops a list of decided
  senders with per-row undo links.
- Z keyboard shortcut bound to "Undo last" — power-user invisible
  shortcut.
- After 3-second post-empty delay, tray collapses into Activity link
  in the empty state.
- Toast NEVER fires for individual Triage decisions (Doc 05 §7
  prohibition).

### D36 — Row content: **Collapse/expand pattern — critical info default, full stats on click**

**[GRILL PATCH 2026-05-18 → D198]** This row's collapse/expand behavior
(state, keyboard nav, ARIA, animation timing, single-row accordion
enforcement) is supplied by the shared `useExpandableRow` hook in
`packages/shared/hooks/`. Rendering below is feature-owned in
`apps/web/src/features/triage/`.

Each Triage row is a collapsible card. Clicking the row body expands it
to show full context. Clicking a verb button applies the verb (and
collapses any expanded row in the queue).

**Collapsed state (default — minimal, scan-friendly):**
- Avatar (initials, color seed)
- Sender name
- Recommendation badge — *verdict + confidence pip* (the "why this is in
  the queue" signal). E.g., `↓ Archive · 0.92` or `↓ Unsubscribe · 0.85`
  using a small monochrome chevron + verdict word.
- 4 verb buttons (K/A/U/S with keyboard letter labels)

**Expanded state (on click — full context, single-row accordion):**
- Sample subject — *the latest message's subject line*, the recognition
  cue ("oh, that's the Notion weekly digest"). Truncated to ~80 chars.
- Reasoning — LLM-generated 1-2 sentence explanation (D24) inline
- Weekly volume number + 4-bar sparkline (trailing 4 weeks)
- Read rate (%) — e.g., "You open 2%"
- Last seen — e.g., "Last message: 3 days ago"
- Cadence chip (daily / weekly / monthly / spike indicator)
- "Open sender →" link to full Sender Detail page

**Expansion behavior — single-row expand:**
- Only one row expanded at a time. Clicking another row collapses the
  current and expands the new (Notion-style accordion).
- Esc key collapses any expanded row.
- Verb button click collapses the expanded row after applying.
- Animation: 220ms ease-out expand; 180ms ease-in collapse.

**Implications:**
- API DTO for Triage rows always returns *both* the collapsed-state
  fields and expanded-state fields (one round trip). No lazy-load
  for expansion to keep UX instant.
- Client-side `useTriageExpansion` hook tracks expanded sender_key per
  session.
- Reasoning copy comes from `sender_recommendations.reason_summary`
  (D24). If not yet generated, expanded card shows a "Computing
  recommendation…" line for ≤ 2s then falls back to template.
- Recent message subjects come from `mail_messages` ordered by
  received_at desc limit 3 for the sender_key.
- Keyboard nav: `j`/`k` (or ↓/↑) navigate rows; `Enter` toggles
  expansion; letters apply verbs without needing expansion.

### D37 — Mobile layout: **Vertical card with same collapse/expand pattern + swipe gestures**

Same logic as D36 — collapsed card shows critical info, tap to expand
for full stats.

**Collapsed mobile card:**
- Sender name + sample subject (stacked vertically)
- Recommendation badge (right-aligned)
- 4 verb buttons (full-width row at bottom)

**Expanded mobile card:**
- Same content as collapsed, plus:
- Reasoning, weekly volume + sparkline, read rate, last seen
- Recent subjects list

**Gestures (mobile only):**
- Swipe-right → Keep
- Swipe-left → Archive
- Swipe gestures collapse any expanded card. Verbs U and S require tap
  (lower-risk gestures only on common verbs).
- Tap card body → expand.

**Implications:**
- Bundle's responsive grid in `triage.jsx:80-83` still applies as a
  break trigger; we replace the small-breakpoint layout with the
  card-collapse pattern.
- Swipe handling via Framer Motion (or react-use-gesture). Gate to
  touch devices only (no swipe on desktop).
- Card spec lives in `lib/triage-card.jsx` as a reusable component
  used by both screen and mobile breakpoints.

### D38 — First-time education: **Onboarding-only tour + tooltips on hover**

Day 1 (during onboarding Step 5 "First Triage"): inline tour points
out the 4 verbs, the keyboard shortcuts, the action tray, the
recommended-verb highlight. User completes 1-2 sample decisions
inside the onboarding scaffold.

Day 2+: no re-education. Tooltips on hover for each verb explain
themselves once. No tour, no banner, no "tip of the day" — the calm/
premium tone is incompatible with persistent education chrome.

**Implications:**
- Bundle's `screens/onboarding.jsx` Step 5 `StepFirstTriage` already
  exists — needs to be updated to teach the now-locked 4 verbs (Mute
  removed, Screen added).
- `users.onboarded_at` timestamp + `users.triage_tour_completed_at`
  separate flags. Tour can be re-triggered manually from Settings
  ("Replay the Triage tour") for users who skipped onboarding or
  forgot.

---

### Topic 2 complete: **Triage screen decisions D27–D38 captured.**

12 decisions covering cadence, ranking, verbs, queue size, recommendation
emphasis, bulk-ops policy, empty state, action sheet, undo, row content,
mobile, education. Ready for Topic 3 (Sender Detail).

---

## Phase 1 / Topic 3 — Sender Detail Screen

### D39 — Sender Detail layout order: **Header → Recommendation banner → Actions → Messages → Stats → Charts → History**

```
┌─ Header ─────────────────────────────────────────────┐
│  [Avatar] LinkedIn  ·  linkedin.com  ·  Gmail: Social │
│           ⭐ VIP   🔒 Protect                          │
└──────────────────────────────────────────────────────┘
┌─ Recommendation banner (slim, only when not VIP) ─────┐
│  ▼ Archive recommended · confidence 92%               │
│    "You open 2% of LinkedIn's 47/mo. They send daily." │
│                                            [Why? →]    │
└──────────────────────────────────────────────────────┘
┌─ Action toolbar ──────────────────────────────────────┐
│  [ Keep ]  [ Archive ]  [ Unsubscribe ]  [ Screen ]   │
└──────────────────────────────────────────────────────┘
┌─ RECENT MESSAGES (top fold of body) ──────────────────┐
│  • Jobs you may be interested in     2d ago  • • 12KB │
│  • Connection requests               4d ago  ○ • 8KB  │
│  • ...                                                │
│                                       [Load more →]   │
└──────────────────────────────────────────────────────┘
┌─ Stats strip (single row, reflows) ───────────────────┐
│ 47/mo  ·  2% read rate  ·  3.2y relationship  ·  …    │
└──────────────────────────────────────────────────────┘
┌─ Volume / Open charts (secondary) ─────────────────────┐
│ [Volume over time bar chart]                          │
│ [Open rate over time line chart]                      │
└──────────────────────────────────────────────────────┘
┌─ Decision history (trust loop, bottom) ────────────────┐
│ Mar 12 · Triage · Archived · 47 emails                │
│ Feb 04 · Manual · Kept                                │
│ ...                                       [Older →]    │
└──────────────────────────────────────────────────────┘
```

Bundle's order preserved (post-Chintan-review pass) with the addition of
the Recommendation banner between header and actions.

**Implications:**
- API endpoint: `GET /api/senders/:sender_key/detail?mailbox_account_id=`
  returns one DTO with all sections (header, recommendation, recent
  messages paginated, stats, charts data, history paginated).
- Recommendation banner is hidden when sender is VIP (VIP locks to Keep;
  no recommendation to surface).
- Recent messages paginates with page-size 10. "Jump to page N" affordance
  for large senders (bundle calls this out).
- Decision history pulls from `activity_log WHERE sender_key=? ORDER BY
  occurred_at DESC` with 25 per page.

### D40 — Action toolbar: **4 verbs (K/A/U/S), no Always-Keep button**

Action toolbar contains exactly the 4 verbs from D20: Keep, Archive,
Unsubscribe, Screen. Same 4 buttons that Triage uses.

VIP and Protect are NOT in the action toolbar — they live in the header
(D43). Rationale: action toolbar = *immediate verdicts* (decisions on
the current state). VIP/Protect = *standing policies* (long-term flags).
Mixing them confuses the mental model.

**Implications:**
- Clicking Archive/Unsubscribe on Sender Detail opens the same action
  sheet as Triage (D34: always show, with remember-preference toggle).
- Keep applies immediately, records `sender_policy(policy_type=keep)`.
- Screen on Sender Detail = "send back to Screener" — useful escape
  hatch when user reached Sender Detail uncertain.
- Recommended verb highlighted via D31 (confidence > 0.85).

### D41 — Clicking a recent-message subject: **Open in Gmail (new tab, deep link)**

Click on any recent-message row → opens that message in Gmail web UI
in a new tab via the Gmail deep-link format:
`https://mail.google.com/mail/u/0/#inbox/<provider_message_id>`.

DeclutrMail never renders message bodies. Preserves the "bodies read: 0"
trust artifact in onboarding (`screens/onboarding.jsx:275`).

**Implications:**
- Recent-message row UI: subject (truncated), snippet (truncated),
  received_at relative time, size, attachment icon if present, unread/
  read dot. **No body, no preview pane.**
- Open-in-Gmail link uses `provider_message_id` from `mail_messages`.
- For multi-account users, the deep link uses the correct Gmail account
  index (looked up from `mailbox_accounts.provider_account_id`).
- Privacy copy on the screen explicitly: "We don't render emails.
  Clicking a subject opens the message in Gmail."

### D42 — VIP and Protect: **Two distinct standing policies, both visible in header**

**VIP** (elevational — "this sender is important"):
- Locks engine verdict to Keep (never auto-suggest changes)
- Includes sender in every Morning Brief regardless of read-rate
- Shows ⭐ badge next to sender name throughout the app (Triage, Senders,
  Activity)
- Optional push notification on new message (Pro-tier feature, post-launch)

**Protect** (defensive — "let me handle this sender"):
- Locks engine verdict to Keep (never auto-suggest changes)
- Does NOT surface in Brief
- Does NOT show ⭐ badge
- Silent guard. The "I have this under control" toggle.

A sender can be:
- *Neither* — default; engine recommends normally
- *VIP only* — elevated + locked Keep
- *Protect only* — silent locked Keep
- *Both* — your accountant case (rare but valid)

**Schema:**
- `sender_policies.is_vip bool default false`
- `sender_policies.is_protected bool default false`
- (these are *modifiers* on top of policy_type; both override verdict to
  Keep when true)

**Engine integration:** Phase A cascade in D21 rule list updated:
- Rule 1 (was: user-defined Always-Keep toggle) → "is_protected = true
  OR is_vip = true → Keep, locked"

### D43 — VIP and Protect location: **Both as small icons in header, next to sender name**

```
[Avatar] LinkedIn  ·  linkedin.com  ·  Gmail: Social
         ⭐ VIP   🔒 Protect
```

Both rendered as small toggleable chips beneath the sender name. Filled
state = active; outlined state = inactive. Click toggles.

**Implications:**
- ⭐ icon (Lucide `Star`) for VIP — Gmail-star metaphor.
- 🔒 icon (Lucide `Shield`) for Protect — defensive metaphor.
- Tooltip on each explains the difference: VIP = "elevated in Brief and
  notifications"; Protect = "never re-suggested, silent guard."
- VIP badge ⭐ also appears next to sender name in Triage rows, Senders
  list, Activity rows. Protect badge does *not* appear elsewhere (it's
  meant to be invisible until the user revisits Sender Detail).
- Activity records VIP and Protect toggles as separate audit entries:
  `activity_log(action_type='marked_vip' | 'unmarked_vip' |
  'marked_protected' | 'unmarked_protected')`.
- Settings has "VIPs" and "Protected senders" list views for
  management at scale.

### D44 — Stats strip: **5 stats, single reflow row**

Below recent messages, a single-row strip showing:

1. **Monthly volume** — e.g., `47/mo`
2. **Read rate** — e.g., `2% read`
3. **Relationship length** — e.g., `3.2 years`
4. **Last seen** — e.g., `2 days ago`
5. **Total all-time** — e.g., `2,143 emails`

Mono font for numbers (tabular-nums), small label below each. Reflows
gracefully to 2 columns on tablet, vertical stack on mobile.

**Implications:**
- All 5 come from `sender_profiles` columns (already in Doc 04 §9).
- No interactivity — stats are scan-only. Clicking does nothing.
- The values *update live* when a sync arrives — debounced via the
  D25 trigger so they don't flicker.

### D45 — Charts: **Volume + open-rate over 12 months, side-by-side**

Two small charts below the stats strip:

- **Volume over 12 months** — bar chart, monthly buckets.
- **Open-rate over 12 months** — line chart, monthly buckets.

Both ~280px wide, side-by-side on desktop, stacked on mobile.

**Implications:**
- API: `GET /api/senders/:sender_key/timeseries?mailbox_account_id=&months=12`
  returns `[{ month: '2025-06', volume: 42, opens: 1 }, …]`.
- Pre-aggregated nightly into `sender_monthly_aggregates` table to keep
  the chart endpoint cheap. New table:
  `sender_monthly_aggregates(workspace_id, mailbox_account_id,
  sender_key, year_month date, volume int, opens int, replies int)`.
  PK on (mailbox_account_id, sender_key, year_month).
- Chart library: Recharts or visx; lean toward visx for control. Final
  pick during Topic 22 (frontend stack).
- Y-axis grid only, no axes labels (Linear-style minimalism per D2's
  cool/Vercel direction).

### D46 — Decision history: **10 most recent inline, all V2 actions, link to full**

The bottom-of-page Decision History section shows the **10 most recent**
Activity entries scoped to this sender, with a "View full history →"
link routing to `/activity?sender=<sender_key>` (the Activity screen
pre-filtered).

Each row shows:
- Date (relative for ≤7d, absolute for older)
- Source (You / Triage / Manual / Autopilot / Screener / System)
- Action (Archived / Kept / Unsubscribed / Screened / Marked VIP /
  Unmarked VIP / Protected / Unprotected / Restored / etc.)
- Count if applicable (e.g., "47 emails")
- Operation ID in monospace (small, tooltip on hover)
- Undo link if still in window (D9 unsub window, archive's 7-day window)

**Implications:**
- API: `GET /api/senders/:sender_key/history?limit=10&mailbox_account_id=`
  returns the 10 most recent `activity_log` rows for that sender.
- All action types make the list — including VIP/Protect toggles (per
  user preference for the "hybrid" answer).
- Each row links to the full Activity entry detail.

---

### Topic 3 complete: **Sender Detail decisions D39–D46 captured.**

8 decisions covering layout order, action toolbar, message-click
behavior, VIP and Protect concepts, header placement, stats strip,
charts, decision history. Ready for Topic 4.

---

## Phase 1 / Topic 4 — Senders list screen

### D47 — Senders shape: **Weekly Hero (Mondays) + grid/table below + Review Session overlay**

Bundle's structure preserved. Senders screen has three integrated parts:

1. **Weekly Hero** at top — refreshes Monday morning per user timezone.
   Shows 3 themed slice cards (D48). Each card has a CTA that opens
   the Review Session overlay focused on that slice. Hero auto-dismisses
   for the week after user reviews any slice OR clicks "Not now."
2. **Grid/Table** below the hero — full power-user surface for browsing
   all senders. Toggleable view (D49).
3. **Review Session overlay** — full-bleed modal triggered by Hero CTA.
   Shows exactly the slice promised (10–40 senders), per-row decision
   controls, bulk-default-override at top, bottom tally + commit
   button. Keyboard-first (j/k/↓/↑ navigates, Esc cancels,
   ⌘/Ctrl+Enter commits).

**Implications:**
- Two parallel cleanup cadences: Triage daily (D27), Senders Weekly
  Hero on Mondays. Each owns a distinct user behavior — both retained.
- `weekly_hero_runs` table — id, mailbox_account_id, run_date_local,
  slice_definitions jsonb, dismissed_at, completed_at, generated_at.
  Hero builds Sunday night per timezone (cron worker).
- `review_sessions` table — id, mailbox_account_id, source_slice
  (high_confidence/spike/quiet), sender_keys jsonb, started_at,
  completed_at, decision_count, default_verdict (the bulk-default the
  user landed with).
- Review Session decisions create `action_operation` rows the same way
  Triage decisions do — single uniform action lifecycle.

### D48 — Weekly Hero slices: **3 — High-confidence cleanups / Volume spikes / Long-quiet senders**

Three slice cards on the hero, refreshed Monday morning:

1. **High-confidence cleanups** — engine confidence > 0.85 on
   Archive/Unsubscribe verdicts. Sorted by `inbox_noise_score` desc.
   Slice limit: top 12–24 senders.
   - Card copy: *"12 senders we're confident about. Two-minute cleanup."*

2. **Volume spikes** — senders with spike_ratio ≥ 3× over rolling
   30-day baseline this week. Sorted by spike ratio desc.
   - Card copy: *"4 senders sending more than usual."*

3. **Long-quiet senders** — senders silent for 30+ days, with read_rate
   < 30%. Easy unsub before they re-awaken. Sorted by
   `monthly_volume × first_seen_months` desc (target senders that were
   noisy when active).
   - Card copy: *"8 senders gone quiet. Easy unsubscribe before they
     come back."*

**Card content (per bundle's chat23 polish):**
- 3-stat row at top (vol/mo, avg read rate, top sender name)
- Sparkline
- Up to 4 avatar dots (more "+N" indicator)
- CTA button ("Review →")

**Implications:**
- `weekly_hero_slice` enum: high_confidence / spike / quiet.
- Slice computation runs in a cron worker (Sunday 11pm local). Output
  cached in `weekly_hero_runs.slice_definitions`. UI reads from cache.
- If any slice has < 3 senders, the card hides itself (don't surface
  empty cards).
- Long-quiet slice deliberately *softer* in copy ("easy unsubscribe")
  — the user said it could feel creepy to "wake them up to unsubscribe."
  Mitigation: only surface senders the user has had inbox presence
  with for ≥ 6 months (no surprises).

### D49 — Senders default view: **Always grid; table is per-session toggle**

Every page visit starts in grid. Segmented control at top right offers
`[Grid | Table]` switch. Toggle does not persist across sessions —
each new visit starts fresh in grid. Mobile = always card list (no
table option).

**Rationale:** Grid surfaces decisions (card format with verdict badge
visible). Table is a power-user analytical mode. Defaulting to table
would feel like a spreadsheet; defaulting to grid feels like a curated
review.

### D50 — Per-row interaction: **Collapse/expand pattern matching Triage D36**

**[GRILL PATCH 2026-05-18 → D198]** Uses the shared `useExpandableRow`
hook from `packages/shared/hooks/`. Rendering feature-owned in
`apps/web/src/features/senders/`.

Each sender card starts *collapsed* showing critical info:
- Avatar / initials
- Sender name + ⭐ if VIP
- Recommendation badge (verdict + confidence pip)
- 4 verb buttons (K/A/U/S)

Click card body → expands inline to show:
- Sample subject (latest)
- Reasoning (LLM-generated)
- Monthly volume + sparkline
- Read rate, last seen, relationship length
- "Open sender →" link to Sender Detail

Single-row accordion — clicking another card collapses the prior.

In *table* view, columns replace the card; clicking a row opens an
expandable detail row beneath (same content as the expanded card).

### D51 — Filter UI: **Hybrid — 4 quick-filter chips + "More filters" drawer**

**Quick-filter chips** (always visible at top of grid):
1. **VIPs** — filters to senders where `is_vip = true`
2. **Recommended Archive** — filters to engine verdict = Archive
3. **Recommended Unsubscribe** — filters to engine verdict = Unsubscribe
4. **New senders** — filters to senders with `total_messages < 5 OR first_seen_days < 14`

Each chip click adds/removes from active filter set. Multi-select
allowed. Each chip displays its count: e.g., `⭐ VIPs · 12`.

**"More filters →" button** opens a right-slide drawer with:
- Gmail category checkboxes (Primary / Promotions / Social / Updates / Forums)
- Engine verdict checkboxes (Keep / Archive / Unsubscribe / Screen)
- Volume range slider (0–500+/mo)
- Read rate slider (0%–100%)
- Last seen slider (today / 7d / 30d / 90d / 1y+)
- Relationship length slider (<1mo / 1-6mo / 6mo-1y / 1y+ / 5y+)
- Has unsubscribe header toggle
- Has reply history toggle
- Protected toggle

Drawer footer: `[Apply filters]` + `[Clear all]`. Active filter count
shown as badge on the "More filters →" button.

**Implications:**
- Filter state lives in URL query params (deep-linkable).
- Drawer is right-slide on desktop, bottom-sheet on mobile.
- Server-side query composes filters into Postgres WHERE clauses on
  `sender_profiles`.
- Quick-filter chip counts re-query on signal change (debounced).

### D52 — Bulk operations: **Shift-click range + Ctrl/Cmd-click individual + sticky bottom action bar**

**Selection mechanics:**
- Click a card body → opens expand (D50).
- **Shift-click another card → selects range** (does *not* expand).
- **Ctrl/Cmd-click → adds/removes individual card** to selection.
- Esc clears selection.
- Long-press on mobile enters multi-select mode (every card gets a
  checkbox; tap toggles).

**Sticky action bar** (appears at bottom of viewport when ≥ 1 selected):
```
5 senders selected · [Archive] [Unsubscribe] [Keep] [Screen] [Cancel]
```

Click Archive (bulk) → single action sheet shows aggregated impact:
- Estimated total emails affected (sum across 5 senders)
- Future auto-archive yes/no (applies to all 5)
- "Per-sender breakdown" expandable list for verification

Single confirm processes all 5 as one `action_operation` with
`target_type=multi_sender` and per-sender items in
`action_operation_items`.

### D53 — Search: **Live by name + domain (metadata only)**

Search box in the Senders header. As user types, filter the grid
client-side first (instant), then server-side for senders not yet
loaded.

**Scope:** Match against `sender_profiles.display_name` AND
`sender_profiles.sender_domain` only. No subject matching, no body.
Preserves the "bodies read: 0" trust artifact and keeps the search
endpoint indexable on (workspace_id, mailbox_account_id, lower(name) +
lower(domain)).

**Implications:**
- Search uses Postgres trigram index (`pg_trgm`) on
  `lower(display_name || ' ' || sender_domain)`.
- Server-side endpoint: `GET /api/senders/search?q=…&mailbox_account_id=`
- Live debounce: 150ms.
- Empty search results: "No senders match — try [a filter chip] or
  [clear filters]."

### D54 — Mobile: **Vertical card list + bottom-sheet drawer + horizontal-scroll chips**

- Each sender = full-width card stacked vertically.
- Filter chips scroll horizontally at top (touch-friendly).
- "More filters →" opens a **bottom-sheet drawer** (slides up from
  bottom, full-screen takeover with backdrop).
- Bulk select: long-press any card → enters selection mode. Each card
  gets a checkbox. Tap toggles. Bottom action bar slides up with bulk
  verbs.
- Search box collapses to a search icon in the header; tap expands.

**Implications:**
- Same components as desktop (DRY): the responsive breakpoint just
  changes layout, not data flow.
- Long-press handled via `onTouchStart` + 500ms timer or use
  react-use-gesture's `useLongPress`.

---

### Topic 4 complete: **Senders list decisions D47–D54 captured.**

8 decisions covering shape (Weekly Hero + grid/table + Review Session),
slices, default view, per-row interaction, filter UI, bulk operations,
search, mobile. Ready for Topic 5 (Activity).

---

## Phase 1 / Topic 5 — Activity Screen

### D55 — Time window default: **Last 30 days; picker for All time / 7d / 90d**

Top of Activity has a time-window picker. Default selection: **Last 30
days**. Options: Last 7 days / Last 30 days / Last 90 days / All time.

**Implications:**
- All Activity rows are stored forever (no pruning) — only the *view*
  is windowed. Aligns with "Activity is a trust moat."
- Time-window selector lives in URL query param `?window=30d` for
  deep-linking.
- For Free/Plus tier: data older than 90 days is filtered out at API
  level. Pro/Power: All time available.

### D56 — Filter set: **Bundle's 5 (source) + Doc 06's additions (action, sender, status, undo-available)**

**Top filter chips (quick filters, always visible):**
- All / Triage / Senders / Autopilot / Brief / Screener / Manual

**Right-rail filter panel (collapsible, "More filters →"):**
- Action: Archive / Unsubscribe / Keep / Screen / VIP / Protect / Undo
- Sender: search input or pick from common senders
- Status: In progress / Completed / Needs attention / Failed / Undone
- Undo available: toggle (on = show only entries where undo is still
  in window)

**Implications:**
- Multi-select chips: clicking "Triage" + "Autopilot" shows both
  sources.
- Filter state in URL query params (deep-linkable).
- Server-side query: composed WHERE on `activity_log` indexed columns
  per Doc 04 §15.

### D57 — Row expansion: **Accordion pattern matching Triage/Senders**

**[GRILL PATCH 2026-05-18 → D198]** Uses the shared `useExpandableRow`
hook from `packages/shared/hooks/`. Rendering feature-owned in
`apps/web/src/features/activity/`.

**Collapsed row:**
- Time (relative, e.g., "2h ago")
- Source pill (Triage / Autopilot / etc.)
- Action verb + verb icon (Archived / Unsubscribed / Kept / etc.)
- Sender display name + domain (or "Noise · 4 senders" for batched)
- Count if applicable (e.g., "47 emails")
- Status pill (In progress / Completed / Needs attention / Failed / Undone)
- Undo affordance (per D58)

**Expanded row (on click):**
- "Why this happened" — rule that fired or user action that triggered
- Operation ID in monospace (small, copyable)
- Connected inbox label
- Sender identity (display name, email, domain — all metadata)
- Affected message count breakdown (succeeded / failed / skipped)
- Undo status + expiration date
- Link to Sender Detail / link to filtered Activity for this sender
- (For Autopilot entries) Link to the rule that fired

Single-row accordion (one expanded at a time, like Triage/Senders).

### D58 — Undo affordance: **Inline "Undo" when in window; greyed "Undo expired" tooltip when out**

Each Activity row in undo window shows an **active "Undo" button**
at the row's end (or in expanded detail). Clicking opens a small
confirm sheet (per D9/Doc 06 §13): "Restore the X archived emails?"
+ for Autopilot/rule actions, "Also disable the rule that triggered
this?"

When out of window, the button becomes a **greyed "Undo expired"
chip** with tooltip: *"Undo window was 7 days from the action. Expired
on Mar 12."*

**Implications:**
- `activity_log.undo_expires_at` already in Doc 04 §15.
- UI checks `now() < undo_expires_at` to render active vs expired.
- For unsubscribe actions where opt-out was actually delivered to the
  sender, the *unsub portion* is permanently un-undoable (can't recall
  an email we sent); only the future-archive policy is undoable.
  Activity row shows split state: "Unsub: not reversible · Auto-archive:
  Undo →".

### D59 — Stats header: **Minimalist single-line summary**

Above the filter chips, a single line of mono-font micro-stats:

```
This week: 47 archived · 12 unsubscribed · 8 kept · 0 needing attention
```

Updates based on the active time-window selection (e.g., switching to
"All time" updates header to "All time: 1,243 archived · …").

Calm, non-decorative. No chart. No emoji. Mono font ties it to the
"chrome vs content" type system (D1).

### D60 — Mobile Activity: **Vertical card list + bottom-sheet filter drawer**

- Each Activity entry becomes a card with the same fields as desktop
  row, stacked.
- Tap card → expands inline.
- Swipe-left → triggers Undo (if in window) with toast confirmation.
- Filter chips scroll horizontally at top. "More filters →" opens
  bottom-sheet drawer.

**Implications:**
- Reuses the card pattern from Senders/Triage mobile (D54/D37).
- Swipe-undo + tap-expand both gestural; no conflict (swipe is
  horizontal, tap is on body).

---

### Topic 5 complete: **Activity decisions D55–D60 captured.**

6 decisions covering time-window, filters, row expansion, undo
affordance, stats header, mobile. Ready for Topic 6 (Brief).

---

## Phase 1 / Topic 6 — Brief (Morning Digest)

Brief is a Pro-tier feature (per D19). At launch, Free and Plus users
see a "Brief preview" placeholder with upgrade CTA. Pro users get the
full Brief experience below.

### D61 — Brief delivery channel: **In-app screen + optional email digest (default off)**

Primary delivery is the in-app `/brief` screen. Pro users can optionally
enable an email digest version (Settings → Notifications → "Send me my
Brief by email at 8am"). Email lands in Gmail inbox like any email.

**Implications:**
- `brief_runs` table — id, mailbox_account_id, run_date_local,
  brief_payload jsonb (the 3 sections), generated_at, opened_at,
  email_sent_at (null if not opted in).
- Brief screen reads from `brief_runs.brief_payload` for the most-recent
  same-day run. No live recomputation if user visits later (static
  snapshot, see D69).
- Email version sent via Resend (per D162) with the in-app Brief copy
  rendered as HTML. [CODEX PATCH 2026-05-18: was "SendGrid/Resend"]

### D62 — Brief AI: **Haiku LLM with deterministic template fallback**

One Haiku 4.5 call per user per Brief run, using the bundle's prompt
shape (`screens/brief.jsx:23-49`): "sharp executive assistant" voice,
explicit rules, sender + subject + 160-char preview only.

If LLM call fails or times out, fall back to deterministic template
that groups senders by recommendation verdict.

**Cost estimate:** ~$0.001/Brief call × ~5 days/week × 1,000 Pro users
≈ **$260/year LLM spend on Brief alone.** Acceptable.

### D63 — Brief categories: **3 sections (Reply / FYI / Noise)**

- **Reply:** items genuinely needing human response (work, vendors,
  scheduling). Max 6.
- **FYI:** transactional facts the user should know (money moved,
  bookings, deadlines). Max 4.
- **Noise:** marketing/newsletter/digests — archivable in bulk. No cap.

### D64 — Brief timing: **Default 8am local; user-configurable**

Default delivery time: **8am in user's local timezone** (from
`users.timezone`). Settings has a time picker (any 30-min slot) and
per-day toggles (default Mon-Fri).

### D65 — Noise bulk archive: **Per-sender checkboxes always visible, default-all checked**

```
NOISE
  ☑ LinkedIn (7)
  ☑ Old Navy (3)
  ☑ Groupon (4)
  ☑ DoorDash (2)

  [ Archive 4 senders / 16 messages ]
```

- Each noise sender shown as a row with checkbox (default checked).
- Bottom CTA dynamically updates: "Archive X senders / Y messages."
- Click to uncheck a sender → CTA recomputes.
- Mobile: tap any part of a row to toggle, swipe-left also deselects.
- Confirm click → single `action_operation` archives the message IDs
  from those senders' yesterday emails (not future — that's a separate
  decision).

**Implications:**
- Operation creates `action_operation` with target_type=brief_archive_batch,
  with `action_operation_items` referencing the specific
  provider_message_ids.
- 7-day undo per D58.

### D66 — Brief schedule: **Default Mon-Fri only; weekends opt-in**

Aligns with the assumption that most Pro users (founders, prosumers)
work weekdays. Pro users can enable weekend Briefs in Settings →
Notifications → "Generate Brief on weekends too." Coordinates with
Quiet Hours (Topic 10).

### D67 — VIP in Brief: **Inline ⭐ star on Reply rows**

VIPs who emailed yesterday appear in Reply (or FYI/Noise) as normal,
with a small ⭐ icon next to their name. No separate VIP section.

**Auto-elevation rule:** If a VIP sent yesterday and the engine *would
have* put them in FYI or Noise, they're promoted to Reply automatically
(because by definition VIPs are people you'd want to respond to).

### D68 — Free/Plus tier preview: **Placeholder + upgrade CTA**

Free and Plus users visiting `/brief` see a placeholder card:

```
⭐ Your Morning Brief
───────────────────────

A daily summary of yesterday's email,
written in plain English:

  REPLY  — what actually needs you
  FYI    — facts to know
  NOISE  — one-click archive

8am daily, in-app or by email.

[ Upgrade to Pro to see your Brief →  $19/mo ]
```

### D69 — Brief snapshot behavior: **Static 8am snapshot, no recomputation**

Once generated at 8am, the Brief is *frozen* for the day. User actions
taken throughout the day (archive, unsubscribe) don't update the Brief
text — they only update Activity. Actions on a Brief row visually mark
that row as "Done ✓" (strike-through + checkmark), but the rest of
the Brief remains as it was.

**Rationale:** Brief is a daily *ritual artifact*, not a live view.
Live recomputation would feel unsettled. Activity is the live view.

### D70 — Brief empty state: **Calm message when no email yesterday**

If yesterday had zero new messages:

```
Your inbox was quiet yesterday.

Enjoy the morning — we'll be back tomorrow.
```

If yesterday only had VIPs/Reply candidates (no Noise to archive):
hide the Noise section entirely.

---

### Topic 6 complete: **Brief decisions D61–D70 captured.**

10 decisions covering channel, AI, categories, timing, bulk archive
pattern, schedule, VIP integration, Free/Plus preview, snapshot
behavior, empty state. Ready for Topic 7 (Screener).

---

## Phase 1 / Topic 7 — Screener

### D71 — Classification: **Drop bundle's category labels; show only engine recommendation**

Each Screener row shows:
- Avatar / initials
- Sender name + domain
- Sample subject (latest message)
- First-seen (e.g., "8 min ago", "Yesterday")
- Engine recommendation verdict + confidence pip (e.g., `↓ Archive · 0.65`)
- 4 verb buttons (K/A/U/S)

**No "Newsletter / Promotional / Receipt / Real Person" labels.**
Honors D22's no-category-prediction rule.

### D72 — Quarantine mode: **Soft (DB-flag only; Gmail untouched until user decides)**

New unknown senders' messages **continue to arrive in Gmail inbox
normally**. DeclutrMail flags them in the Screener queue but does not
move, label, or archive Gmail messages until the user decides.

**Implications:**
- `screener_quarantine` table tracks senders awaiting decision but does
  NOT trigger any Gmail API calls.
- No surprise "where's my doctor's email?" risk.
- User opens Screener when they want to review.
- The "no unknowns surprise you" framing in marketing must be honest:
  *"We catch new senders for your review — they still arrive in your
  inbox until you decide."*

### D73 — Review UX: **Accordion list (matching Triage D36 / Senders D50)**

Same collapse/expand pattern. Each Screener row is collapsed by default
(critical info only); click → expands with sample subject, first-seen,
message count so far, engine reasoning, "Open sender →" link.

### D74 — Notification: **Sidebar badge with count + subtle pulse on first arrival**

Left sidebar shows `Screener (3)` with the count of pending decisions.
When a new sender lands during an active session, the badge briefly
pulses (e.g., teal glow for 1.5s), then settles to static count.

No email notification per new sender. Pulse animation respects
`prefers-reduced-motion`.

### D75 — Onboarding handling: **Compute at sync; surface count if > 0 after Step 5**

During initial sync, the recommendation engine's Phase B rule (D21)
routes truly unknown senders to Screener. After the user completes
onboarding Step 5 (First Triage), if Screener count > 0, show a brief
message:

> *"You also have 3 new senders waiting in Screener when you're ready
> to review them. Take your time."*

Single CTA: "View Screener" (optional). User can also continue to Triage.

### D76 — Empty state: **Calm single-line message**

```
No unknown senders.

We'll let you know when one shows up.
```

No illustration. No CTA. Matches the calm/premium voice.

### D77 — Pro gating: **Screener is Pro-only; Free/Plus get basic deferred-decision queue**

D19 placed Screener behind Pro. Refinement:
- **Free / Plus tiers:** S key in Triage works as "Decide later" — sender
  goes to a basic deferred-decision list (no auto-routing of new
  senders, no sidebar badge, no recommendations on rows). Functions as a
  vanilla queue.
- **Pro / Power tiers:** Full Screener as specced (D71-D76). Auto-routes
  new senders. Sidebar badge with count. Engine recommendations on
  rows. Daily new-sender summary (post-launch).

---

### Topic 7 complete: **Screener decisions D71–D77 captured.**

7 decisions covering classification, quarantine mode, review UX,
notification, onboarding handling, empty state, Pro gating. Ready for
Topic 8 (Snoozed).

---

## Phase 1 / Topic 8 — Snoozed (sender-level pause)

### D78 — Snooze scope: **Sender-level only at launch; message-level deferred**

Snooze applies to a sender, not individual messages. Bundle's
message-level pattern (Superhuman-style) deferred indefinitely because
DeclutrMail has no message-list view and the privacy posture
("we don't render emails") makes message-level UI awkward.

Schema is designed for future extensibility — a `snoozed_messages`
table could be added later if a message-list surface ever ships.

### D79 — Snooze mechanic: **Future-only by default; opt-in to also archive existing**

When user snoozes a sender:
- **Default behavior:** future messages from that sender (during the
  snooze window) get auto-routed to `DeclutrMail/Snoozed/<sender_domain>`
  Gmail label as they arrive. Existing inbox messages stay where they are.
- **Action sheet checkbox** (default unchecked): *"☐ Also archive existing
  X messages from this sender"* — when checked, snooze also moves current
  inbox messages from this sender to the same label.

At wake-time (per D80), all messages in the snooze label move back to
INBOX, and the sender_policies row clears.

**Schema:**
- `sender_policies.snoozed_until timestamptz nullable`
- `sender_policies.snoozed_at timestamptz nullable`
- `sender_policies.snoozed_reason text nullable` (optional user note)

**Workers:**
- New message arrives → `ActionExecutionWorker` checks if sender has
  active snooze → if yes, applies the snoozed label instead of letting
  it land in INBOX.
- Hourly `SnoozeRestoreWorker` cron: for any sender with
  `snoozed_until <= now()`, batch-move all label-snoozed messages back
  to INBOX, clear sender_policies.snoozed_until.

### D80 — Snoozed screen layout: **Grouped by wake-time with actions per row**

Sections by wake-time bucket:
- **Later today** (wake within today)
- **Tomorrow** (wake on tomorrow)
- **This week** (wake within 7 days)
- **Eventually** (wake > 7 days)

Each row in a section:
- Avatar + sender name + domain
- Wake-time (e.g., "Tomorrow 9:00 AM", "Fri 7:00 AM", "May 23")
- Count of intercepted messages so far during the snooze (e.g.,
  "3 intercepted so far")
- Optional snooze reason note (if user added one)
- Actions: [Wake now] [Edit] [Cancel snooze]

Mobile: same groups, full-width cards, swipe-left to wake now, swipe-
right to cancel.

### D81 — Snooze trigger surfaces

Snooze is triggered from:
- **Sender Detail toolbar overflow ("…" menu):** "Snooze sender →"
- **Senders grid card overflow (hover-"…" on desktop, long-press on
  mobile):** "Snooze →"
- **No Triage keyboard shortcut** — Triage already has 4 verbs; snooze
  doesn't belong in the rapid-decision flow. Users wanting to snooze
  during Triage can press S (Screen → defer) or open the sender's
  detail page.

### D82 — Snooze presets

When user clicks "Snooze sender" in any trigger surface, an action
sheet opens with preset durations:

- **Later today** (wakes at 5:00 PM local)
- **Tomorrow** (wakes at 9:00 AM local tomorrow)
- **This weekend** (wakes Saturday 9:00 AM local)
- **Next week** (wakes Monday 9:00 AM local)
- **Next month** (wakes 1st of next month, 9:00 AM)
- **Custom date / time** (opens date picker)

Plus the "☐ Also archive existing" checkbox (D79).

### D83 — Pro gating

Snoozed is Pro-only per D19. Free/Plus tier sees the Snooze action in
overflow menus as "(Pro) Snooze →" — clicking shows the upgrade modal
rather than executing.

---

### Topic 8 complete: **Snooze decisions D78–D83 captured.**

6 decisions covering scope (sender-level), mechanic (future-only with
opt-in), screen layout, trigger surfaces, presets, Pro gating. Ready
for Topic 9 (Followups).

---

## Phase 1 / Topic 9 — Followups

### D84 — Scope: **Followups-Lite (list only) at launch; Nudge as fast-follow with new scope**

V2 launch ships:
- Read-only list of unreplied sent emails grouped by thread age
- Click any row → opens original sent email in Gmail (new tab, deep
  link to thread)
- No Nudge feature, no template, no DeclutrMail-sent reminders

Uses existing `gmail.modify` scope (covers Sent folder read).

**V2.1 fast-follow (post-launch):**
- Add `gmail.send` scope (CASA re-disclosure required)
- Add Nudge button with template preview + send
- Add "remind in N days" scheduling

### D85 — Priority: **Thread age only**

- **High:** thread age > 7 days
- **Medium:** thread age 3–7 days
- **Low:** thread age 1–3 days

No interpretation of subject, no recipient-relationship weighting at
launch. Pure age-based.

**Implications:**
- Sort within each group by age desc (oldest first).
- Re-computed at API request time from `mail_messages.sent_at`.

### D86 — Exclusion rules: **Filter out non-followup-worthy threads**

Followups list excludes:
- Threads sent to bulk recipients (To/Cc has > 5 addresses or contains
  mailing list patterns like `*@googlegroups.com`)
- Threads sent to senders marked Archive/Unsubscribe in DeclutrMail
- Auto-response threads (Subject starts with "Re: " AND original
  inbound is from a known automated sender)
- Promotional senders (sender_profile shows Gmail Promotions group)
- Threads where any later message in thread is from the recipient
  (already replied)
- Threads explicitly dismissed by user (per D88)

Result: only genuine 1-to-1 correspondence with humans who haven't
replied.

### D87 — Schema: **followup_tracker denormalized table**

```
followup_tracker:
- id uuid pk
- workspace_id uuid fk
- mailbox_account_id uuid fk
- provider_thread_id text
- recipient_email citext
- recipient_display_name text
- subject text
- sent_at timestamptz
- last_check_at timestamptz
- status text (awaiting / replied / dismissed)
- dismissed_at timestamptz nullable
- created_at timestamptz
- updated_at timestamptz
- unique (mailbox_account_id, provider_thread_id)
```

Computed via `FollowupCheckWorker` cron (every 6h) that scans
recent sent messages and updates the table.

### D88 — User dismissal: **"Mark resolved" affordance per row**

If user followed up via phone / Slack / in-person, they can click
"Mark resolved" on the row → status becomes `dismissed`, row hides from
the list. Logged to Activity.

Trash icon on hover (desktop) or swipe-left (mobile).

### D89 — Pro gating

Followups is Pro-only per D19. Free/Plus see a preview card with
upgrade CTA.

### D90 — Followups screen layout

- Top: stats summary line — *"7 threads awaiting reply · 2 over a
  week"*
- Grouped sections by age bucket (High / Medium / Low)
- Each row: recipient name + domain, subject (truncated to 60 chars),
  sent-at relative time, [Open in Gmail →] link, [Mark resolved]
  affordance
- Mobile: vertical card list with swipe-left to dismiss

### D91 — Followups empty state

```
No follow-ups waiting.

We watch your Sent folder for emails that haven't gotten a reply.
Nothing's overdue right now.
```

---

### Topic 9 complete: **Followups decisions D84–D91 captured.**

8 decisions covering scope (Lite at launch), priority, exclusion rules,
schema, user dismissal, Pro gating, layout, empty state. Ready for
Topic 10 (Quiet Hours).

---

## Phase 1 / Topic 10 — Quiet Mode

### D92 — Trigger: **Both manual toggle + scheduled recurring windows**

Top of Quiet screen has a large toggle: *"Quiet until [time picker]"*
for ad-hoc usage. Settings has scheduled windows (e.g., "Mon-Fri
6pm-9am", "Weekends always quiet").

**Schema:**
- `mailbox_accounts.quiet_state jsonb` — current active quiet state
  (enabled, started_at, until_at, source: manual/scheduled)
- `quiet_schedules` table: id, mailbox_account_id, days bigint (bitmask
  Mon-Sun), start_time_local time, end_time_local time, timezone text,
  enabled bool

### D93 — Non-essential rule: **Non-VIP AND not active correspondent (smart)**

A message gets held during quiet mode if:
- Sender is NOT marked VIP (`sender_policies.is_vip = false`), AND
- User has NOT replied to this sender within last 30 days

VIPs and active correspondents always pass through quiet mode and
land in inbox normally.

**"Active correspondent" computation:**
- Query: any message in `mail_messages` where
  `sender_email = user_email` AND
  `provider_thread_id IN (threads where this sender appeared)`
  AND `received_at >= now() - interval '30 days'`
- Materialized per sender as `sender_profiles.user_has_replied_recently
  bool` (re-computed on signal change).

### D94 — Restoration: **Trickle over 10 minutes when quiet ends**

When quiet period ends:
- `QuietReleaseWorker` lists all messages currently in
  `DeclutrMail/Held` label for this mailbox account
- Schedule release in 6 batches (every ~100 seconds) over 10 minutes
- Each batch: `batchModify` to remove Held label + add INBOX label

User experience: at 5:01pm, you don't see 47 emails appear at once —
they trickle in over 10 minutes feeling like normal inbox activity.

### D95 — Per-inbox scope

Each connected inbox has its own quiet state and schedule. Founder/
prosumer with work + personal Gmail can quiet work at 6pm while
personal stays normal.

**Implications:**
- `quiet_state` and `quiet_schedules` keyed on `mailbox_account_id` not
  `workspace_id`.
- Top-level Quiet screen has an inbox selector if user has > 1 inbox.
- "Quiet all inboxes" master toggle as a convenience action.

### D96 — Held messages screen content

Quiet screen shows when quiet is active:
- Big quiet-active state at top (countdown, schedule context)
- "Currently held" list: senders + counts (e.g., "LinkedIn × 3 · 9:14am")
- "Always-exempt VIPs" reference list
- Schedule editor (presets + custom windows) below

When quiet inactive: shows the schedule editor + an enable-now CTA.

### D97 — Brief and Quiet interaction

Brief (D61) is delivered as scheduled (e.g., 8am) regardless of Quiet
state. Quiet doesn't suppress Brief — Brief is value, not noise.

User can opt out: "Don't deliver Brief during quiet hours" toggle in
Settings.

### D98 — Pro gating

Quiet Mode is Pro-only per D19. Free/Plus see preview card with upgrade
CTA.

---

### Topic 10 complete: **Quiet Mode decisions D92–D98 captured.**

7 decisions covering trigger (manual + scheduled), non-essential rule
(non-VIP + not active correspondent), restoration (trickle), per-inbox
scope, screen content, Brief interaction, Pro gating. Ready for Topic 11
(Autopilot rule format).

---

## Phase 1 / Topic 11 — Autopilot rule format

### D99 — Rule format: **Preset rules + custom rule builder, both at launch**

Both ship at V2 launch. Preset library covers ~80% of use cases out of
the box. Custom rule builder for power users who need precise control.

**Polished/intuitive UI** is a hard requirement — Linear/Notion-quality
condition chip UI, no SQL-like syntax, plain English-y phrasing.

**Build cost acknowledged:** Custom rule builder is a substantial UI
implementation. Worth scoping a dedicated PR (probably PR 16-A and 16-B
split: 16-A presets only, 16-B custom builder).

### D100 — Condition vocabulary (sender-layer only per D22)

| Field | Operators | Values |
|---|---|---|
| Sender email | contains / equals / is in list | text |
| Sender domain | contains / equals / is in list | text |
| Gmail category | is / is not | Primary / Promotions / Social / Updates / Forums (Gmail's own classification — observation, not prediction) |
| Read rate | < / > / between | 0–100% |
| Monthly volume | < / > / between | 0–500+/mo |
| Spike ratio (vs 30d baseline) | > | 1.5× / 2× / 3× / custom |
| Last seen | > | N days |
| **Sender age in your inbox** (renamed from "Relationship length") | > / < | N months/years |
| Has unsubscribe header | is | yes / no |
| Has reply history | is | yes / no |
| Engine verdict | is | Keep / Archive / Unsubscribe / Screen |
| Engine confidence | > / < | 0.5–1.0 |

**12 fields total.** Sender-layer only, no message content, no category
prediction (Gmail category is Gmail's own classification — we surface it
as observed metadata).

**Actions:** Archive / Unsubscribe / Keep / Screen / Mark VIP / Mark
Protected / Pause sender (snooze for N days).

**Trigger types:**
- On new message arrival (real-time eval per Pub/Sub notification)
- Nightly 3am batch (eval all senders matching condition)
- One-time apply (run once on existing data, then delete or convert)

### D101 — Preset library at launch (5 rules)

1. **Auto-archive low-engagement** — Engine verdict = Archive AND
   confidence > 0.85 → Archive future messages (Observe mode for 7 days)
2. **Auto-unsubscribe noisy senders** — Engine verdict = Unsubscribe
   AND confidence > 0.90 → Unsubscribe + auto-archive future (Observe
   mode for 7 days)
3. **Auto-screen new senders** — Sender age < 7 days OR total messages
   < 3 → Screen (D23 system rule, now exposed as a toggleable preset)
4. **Newsletter graveyard** — Read rate < 5% AND last seen > 90 days →
   Unsubscribe (Observe mode for 7 days)
5. **VIP Brief priority** — Is VIP = true → always elevated in Brief
   (system rule, can't disable; matches D67)

Each preset has:
- Single toggle (enable/disable)
- Threshold slider for confidence-based rules (rules 1, 2)
- "Apply to all inboxes" toggle (default off; per-inbox)
- Last-run summary inline (e.g., "Last run: 3:14 AM · 38 actions · 14
  senders")
- Recently-affected senders mini-list (last 5)

### D102 — Rule scope: **Per-inbox default; "Apply to all inboxes" toggle per rule**

Each rule scoped to one mailbox account by default. Toggle on the rule
edit form: *"☐ Apply to all my inboxes"* — with a confirmation modal
when enabling (impact preview: "This rule will run on 3 inboxes
affecting an estimated X senders.").

**Schema:** `automation_rules.scope text` already in Doc 04 §12
(values: account / all_accounts / workspace).

### D103 — Custom rule builder UI

Per the "polished, intuitive UI" requirement:

- **Trigger selector:** Dropdown — "When does this run?" → On new
  message / Nightly / One-time apply
- **Condition chips:** Linear-style. Click "+ Add condition" → chip
  appears with three dropdowns (field → operator → value). Multiple
  chips ANDed by default; "any" toggle changes to OR. Drag-reorder.
- **Action chip:** "Then do" → action picker.
- **Mode selector:** Observe (default) / Active — per D10.
- **Scope:** "This inbox" / "All my inboxes" toggle.
- **Dry-run preview:** Before saving, show "If active now, this rule
  would have affected: X senders, Y messages over the last 30 days."
  Link to a 10-row sample list.
- **Save:** Activates in Observe mode for 7 days unless user explicitly
  chose Active.

### D104 — Observe mode UI (per D10)

While a rule is in Observe mode, matched senders go to a "Pending
Autopilot suggestions" tab on the Autopilot screen:

```
Pending suggestions from "Auto-archive low-engagement"  (7 days left)
─────────────────────────────────────────────────────────
✓ Notion (3 msgs)        — would archive
✓ LinkedIn (47 msgs)     — would archive
✓ Old Navy (12 msgs)     — would archive
...

[ Approve all and switch to Active mode ]
[ Approve selected ]   [ Dismiss selected ]
```

After 7 days, a one-time prompt: *"Auto-archive low-engagement
suggested 14 actions this week. Switch to Active?"*

### D105 — Autopilot pause

Master pause button on the Autopilot screen pauses **all** rules
across all inboxes. Recorded to Activity. Banner shows "Autopilot
paused since [date]." Click to resume.

---

### Topic 11 complete: **Autopilot decisions D99–D105 captured.**

7 decisions covering rule format (presets + custom builder), condition
vocabulary, preset library, rule scope, builder UI, Observe mode UI,
master pause. Ready for Topic 12 (Onboarding).

---

## Phase 1 / Topic 12 — Onboarding flow + copy

### D106 — Onboarding 5-step structure

1. **Promise** (pre-OAuth, no inputs)
2. **Connect** (OAuth click + Google consent + callback)
3. **Sync** (strict gate, real backend progress)
4. **Style** (3 profile presets)
5. **First Triage** (3 real senders practice)

Skip-onboarding affordance in top-right of every step (sets
`users.onboarded_at = now()` and `users.is_onboarding_skipped = true`;
production should gate certain features for skip-onboarded users).

### D107 — Step 1: Promise screen content

**Title:** "Clean Gmail by sender, not by email."
**Sub:** "Before we connect, here's exactly what we'll and won't see."

**What we'll see:** sender name + domain, subject line, the 160-char
preview Gmail already shows in your inbox list.

**What we won't read:** full message bodies, attachments, images.

**Trust badge** (load-bearing): static "🔒 Bodies read: 0 — forever"
chip. Always-on, never animates, never changes value.

**Bottom:** [Connect Gmail →] CTA + small privacy policy / terms links.

### D108 — Step 2: Connect (OAuth)

Single primary CTA: "Connect Gmail." Click → redirects to Google OAuth
consent screen → returns to DeclutrMail after grant.

**Backend during this step:**
- `provider_connection` created with KMS-envelope-encrypted refresh +
  access tokens (per D14).
- `mailbox_account` created (status=connected).
- `provider_sync_state` initialized.
- `InitialSyncWorker` job enqueued (throttled per D5).

Auto-advances to Step 3 the moment OAuth callback returns.

### D109 — Step 3: Sync (strict gate, no time promise, no live counters)

**Title:** "Reading your inbox…"

**Visible to all users:**
- Progress bar (animated; backed by real backend stage progress — no
  fake ticking).
- Stage indicator list (6 stages, current one highlighted):
  - Reading sender info
  - Grouping by sender
  - Calculating email patterns
  - Detecting spikes & cadence
  - Preparing recommendations
  - Done — your inbox is ready
- Static "🔒 Bodies read: 0 — forever" trust badge (preserved from
  Step 1).
- Reassurance copy: *"This is a one-time scan. You can close this tab —
  we'll email you when your inbox is ready."* (No time promise.)
- Browser push permission ask (subtle, bottom-right): *"Get notified
  when ready? [Notify me]"*.

**Hidden behind devPreference (per D111):**
- Live "Headers read: 2,847 of ~18,000" counter
- Live "Senders found: 142" counter
- Sync ETA estimator

Auto-advances to Step 4 when `provider_sync_state.readiness_status =
'ready'`.

### D110 — Step 4: Style preset selection

**Title:** "How hands-on do you want to be?"
**Sub:** "You can change this in Settings later. Nothing happens
without your approval."

**Three preset cards:**

| Preset | Description | Defaults |
|---|---|---|
| Minimal | *"Just bulk-archive — I'll decide what to clean. Triage queue + manual control."* | autopilot=off, brief=off, screener=basic-queue (or Pro full), quiet=off |
| **Balanced** ⭐ | *"Help me catch up — Daily Brief + Screener for new senders. You stay in control of clean actions."* | autopilot=off, brief=on (Pro), screener=on (Pro), quiet=on (Pro 6pm-8am Mon-Fri) |
| Autopilot | *"Just keep it clean — Brief tells you what happened. Safe rules nightly. Undo any time."* | autopilot=on (Observe mode 7 days, per D10), brief=on, screener=on, quiet=on |

For Free/Plus tier: Pro features show with 🔒 icon + "Pro" tag. Card is
still selectable; choosing Balanced or Autopilot with Pro features
prompts upgrade flow. Minimal works fully on Free.

Selecting a preset writes to:
- `users.preferences.profile_preset` (minimal/balanced/autopilot)
- `automation_rules` (presets enabled accordingly)
- `mailbox_accounts.quiet_state` and `quiet_schedules` (if quiet
  enabled)
- `users.preferences.brief_enabled / screener_enabled` flags

### D111 — devPreference layer (new concept)

Third settings layer beyond user preferences and feature flags. Schema:

```
users.dev_preferences jsonb default '{}'
```

Toggled via super-admin tooling or `?dev=1` URL param (gated to
`@declutrmail.com` emails). Used for *internal observability* without
exposing UI to production users.

**Initial devPreference keys:**
- `show_sync_live_counters` (default false; per D109)
- `show_sync_eta` (default false)
- `show_recommendation_engine_scores_in_ui` (default false)
- `show_operation_ids_inline` (default false)
- `bypass_observe_mode_window` (default false; for QA)

This is distinct from `feature_flags` (which control rollout to user
segments) and `users.preferences` (which are user-toggleable settings).

### D112 — Step 5: First Triage with real senders

**Source:** API endpoint `GET /api/onboarding/first-triage` returns the
3 highest-confidence non-Keep recommendations from the just-completed
sync. Falls back to the 3 lowest-read-rate non-Keep senders if engine
confidence is uniformly low (small mailbox edge case).

**UI:** uses the same row component as production Triage (D36 collapse/
expand pattern), with K/A/U/S keyboard shortcuts.

**Decisions:**
- Each click triggers real action (creates `action_operation` and
  records to Activity).
- For Archive/Unsubscribe, the action sheet (D34) opens; the
  "remember preference" toggle is highlighted here as a first-use
  affordance.
- Decisions are reversible per D58 (7-day undo).

**Completion:**
```
That's it. You just cleaned 506 emails.

Every decision you just made applies to all of that sender's past
and future mail. Welcome aboard.

[ Open Triage queue → ]   [ Open dashboard ]
```

**Plus** (if applicable):
- "You also have 3 new senders waiting in Screener when you're ready."
  (per D75)
- Action tray persists with the 3 decisions and undo links (per D35).

### D113 — Onboarding completion side effects

When user completes Step 5:
- `users.onboarded_at = now()`
- `users.profile_preset` set
- Activity log records the onboarding completion event
- Browser push subscribed (if user said yes in Step 3)
- Welcome email scheduled (T+1h: "Welcome to DeclutrMail")
- Trial period starts for Pro features if user picked Balanced/Autopilot
  preset (default: 14-day free trial of Pro features for users on Free
  who pick Balanced/Autopilot during onboarding — surfaces upgrade
  organically before trial ends)

---

### Topic 12 complete: **Onboarding decisions D106–D113 captured.**

8 decisions covering 5-step structure, Promise screen, Connect, Sync
(with devPreference for stats), Style presets, devPreference layer,
First Triage real senders, completion side effects. Ready for Topic 13
(Settings).

---

## Phase 1 / Topic 13 — Settings

### D114 — Settings structure: **9 sections, left-nav (Linear/Notion-style)**

Left sidebar of categories, content panel on right.

| Section | Contains |
|---|---|
| **Account** | Display name, email, timezone, language (later), profile preset (Minimal/Balanced/Autopilot), "Replay Triage tour" link |
| **Inboxes** | Connected Gmail accounts list, per-inbox state cards (connection health, last sync, ready status, account-kind tag personal/work/founder, Disconnect / Delete data actions), "+ Connect another Gmail" |
| **Notifications** | Brief email opt-in, browser push, completion alerts ("Your inbox is ready"), new-sender summary email frequency |
| **Triage & Brief** | "Apply last preference by default for Archive/Unsubscribe" toggle (D34), Brief time + weekend toggle, Brief email opt-in |
| **Autopilot** | Master pause, list of all rules (preset + custom), per-rule status (active/observe/paused), link to "+ New custom rule" form |
| **Quiet schedules** | Per-inbox quiet schedules (weekday/weekend/custom windows per D92), VIP/active-correspondent exemption explanation |
| **Sender lists** | Sub-tabs: VIPs / Protected / Snoozed — list views with quick toggle/remove actions |
| **Privacy & Data** | What we store + what we don't (mirroring Step 1 promise), Export all my data (download JSON), Disconnect inbox / Delete inbox data / Delete DeclutrMail account (3 distinct actions), CASA letter + privacy/terms links |
| **Plan & Billing** | Current plan summary + "Manage plan & billing →" link to standalone /billing screen |

### D115 — Inboxes management: **Settings → Inboxes section + top-bar Account Switcher**

Settings has a rich Inboxes section with cards per connected inbox.
App shell top-bar also has a compact Account Switcher (per Codex Doc 05
§6) for fast context switching.

**Inbox card content:**
- Avatar + email address + display name
- Account-kind tag (personal / work / founder / shared) — editable
- Connection health (✓ Healthy / ⚠ Token expiring soon / ✗ Disconnected)
- Last sync time
- Ready status (Ready / Syncing N% / Failed)
- Quick actions: [Resync] [Open inbox in Gmail →] [Manage scopes →]
- Trust exits: [Disconnect] (revoke OAuth) and [Delete data] (wipe DeclutrMail data) buttons

### D116 — Privacy & Data section: **Rich with 3 deletion actions + data export + CASA evidence**

Content layout:
```
🔒 PRIVACY POSTURE
What we store (sender info, subject lines, 160-char Gmail-shown
preview, dates, label IDs) and what we never store (bodies,
attachments, images, full headers). Same content as onboarding Step 1.

🔍 BODIES READ: 0
(static badge — visible always in this section)

📦 EXPORT MY DATA
[ Download as JSON → ] (Activity log + sender profiles + preferences;
excludes OAuth tokens for security)

🚪 LEAVE CLEANLY
- Disconnect inbox → revoke OAuth, stop sync, keep historical Activity
  (reconnect later)
- Delete inbox data → wipe all DeclutrMail data for one inbox (keeps
  OAuth alive for re-sync if user changes mind)
- Delete DeclutrMail account → full GDPR delete (all inboxes, all
  Activity, all preferences, no recovery)
All three require a typed confirmation modal.

📄 LEGAL
- CASA Tier 2 letter (PDF, current renewal date)
- Privacy Policy
- Terms of Service
- Subprocessors list
```

**Action items:**
- Export endpoint: `GET /api/me/export-data` streams JSON.
- Disconnect endpoint: revokes Google OAuth token, sets
  `mailbox_accounts.status = disconnected`, stops all workers for that
  account. Keeps `activity_log` and `mail_messages` intact.
- Delete inbox data: deletes all rows in `mail_messages`,
  `sender_profiles`, `sender_recommendations`, `sender_policies`,
  `activity_log` etc. WHERE `mailbox_account_id = ?`. OAuth stays
  connected.
- Delete account: full cascade delete + 30-day soft-delete grace
  period before hard purge (matches CASA expectations).

---

### Topic 13 complete: **Settings decisions D114–D116 captured.**

3 decisions covering structure (9 sections, left-nav), inboxes
management, privacy & data section. Most Settings content is "where
features specced elsewhere are configured," so detailed UX inherits from
the per-feature topics. Ready for Topic 14 (Billing).

---

## Phase 1 / Topic 14 — Billing screen

### D117 — Billing providers: **Paddle (international) + Razorpay (India)**

Split by user region:
- **Paddle** is merchant-of-record for non-India users — handles
  global VAT/GST/sales tax compliance, ~5% fees. Cleaner for
  India-based founder targeting global market.
- **Razorpay** handles India users with native UPI + Indian cards +
  GST + INR settlement.

**Architecture:**
- `users.billing_region` (auto-detected from IP at signup, user can
  override in Settings → Account)
- `billing_customers` table abstracts provider:
  - id, user_id, provider (paddle/razorpay), provider_customer_id,
    region, created_at
- `subscriptions` table:
  - id, billing_customer_id, plan_code, status (active/past_due/
    canceled/paused), current_period_end, cancel_at_period_end,
    pause_until, created_at, updated_at
  - [CODEX PATCH 2026-05-18] `trialing` removed from enum — D121 locked
    no-trial mechanic; subscriptions are paid from day 1.
- Webhook handlers normalize both providers into a single
  `subscription_events` stream (event_type, payload, processed_at).
- Provider-specific code lives in `/lib/billing/paddle.ts` and
  `/lib/billing/razorpay.ts` behind a shared `BillingProvider` interface.

**Plan codes** (consistent across providers):
- `plus_monthly` ($9 / ₹749)
- `plus_annual` ($90 / ₹7,499)
- `pro_monthly` ($19 / ₹1,599)
- `pro_annual` ($149 / ₹12,499) [CODEX PATCH: was $190, aligned with D126]
- `pro_annual_founding` ($129 / ₹10,999, limited to first 250)

(INR prices are rough conversions; final pricing to be set during
Razorpay setup.)

### D118 — Cancellation: **Respectful flow with optional reason + pause-30-days offer**

Click "Cancel subscription" → modal:

```
We're sorry to see you go.

What's making you cancel? (Optional)
[ ] I'm not using it enough
[ ] Too expensive
[ ] Found another tool
[ ] Privacy concerns
[ ] Other

Would you like to pause instead?
[ Pause for 30 days ] — Keep your settings; resume anytime.

[ Cancel my subscription ]
```

No retention discount offered (preserves premium positioning).
Cancellation takes effect at end of current period (no proration
refund except where law requires).

**Implications:**
- Pause: sets `subscriptions.pause_until = now() + 30 days`,
  `subscriptions.status = paused`. Pro features lock during pause.
- Cancel: sets `subscriptions.cancel_at_period_end = true`,
  `subscriptions.status = active` until period end then `canceled`.
- Reason captured in `subscription_events.cancellation_reason` (anon
  for analytics).

### D119 — Plan comparison: **Current plan card + condensed 3-tier strip + link to /pricing**

**Billing screen layout:**

```
┌─ Current plan ──────────────────────────────────────┐
│  Pro · $19/mo · Next renewal Jun 1, 2026             │
│  [ Change plan ▾ ]                                   │
│                                                       │
│  🏛️ Founding member · price locked at $129/yr        │
│  (if applicable)                                      │
└──────────────────────────────────────────────────────┘

┌─ Compare plans ──────────────────────────────────────┐
│  [Free $0]  [Plus $9/mo]  [⭐ Pro $19/mo]            │
│   ─────      ─────         ─────                      │
│  See triage  Manual         Everything +              │
│  + Activity  cleanup        Autopilot                 │
│                                                       │
│  See full comparison → /pricing                       │
└──────────────────────────────────────────────────────┘

┌─ Payment method ─────────────────────────────────────┐
│  Visa ····4242 · Expires 12/27 · [ Update card ]    │
└──────────────────────────────────────────────────────┘

┌─ Invoices ────────────────────────────────────────────┐
│  May 1, 2026  $19.00  Paid  [ Download ]              │
│  Apr 1, 2026  $19.00  Paid  [ Download ]              │
│  ... (latest 5)                                       │
│  View all in Paddle portal → / Razorpay portal →     │
└──────────────────────────────────────────────────────┘

┌─ Danger zone ─────────────────────────────────────────┐
│  [ Cancel subscription ]                              │
└──────────────────────────────────────────────────────┘
```

### D120 — Plan-change flows

**Upgrade (Free → Plus or Pro):**
1. Click "Change plan ▾" → modal with 3 cards
2. Pick target plan + monthly/annual toggle
3. Modal shows impact summary: "$19/mo, starting today, next bill Jun 1"
4. [Continue to checkout →] → redirect to Paddle/Razorpay hosted page
5. After success → return to /billing with "Plan upgraded ✓" banner

**Downgrade (Pro → Plus or Plus → Free):**
- Takes effect at end of current period (not immediately)
- Modal shows: "Your Pro features will remain active until [end date].
  Then you'll switch to Plus."
- Activity records the downgrade decision
- No refund for unused time (state in copy)

**Pause:** sets `pause_until` and freezes billing for 30 days. Pro
features lock immediately.

---

### Topic 14 complete: **Billing decisions D117–D120 captured.**

4 decisions covering billing providers (Paddle + Razorpay split),
cancellation flow, plan comparison layout, plan-change flows.

---

# 🎯 PHASE 1 COMPLETE

**Topics 1–14 (Product behavior specs) all captured.**

**Decisions: D20–D120 (101 decisions in Phase 1 alone)**.

Combined with audit decisions D1–D19, the plan file now contains
**120 numbered decisions** covering:
- Visual identity, color, typography, screens, scope
- Recommendation engine architecture + rules + LLM role
- Every product screen's layout, interaction, mobile UX, gating
- Onboarding flow + copy
- Settings IA + privacy/data exits
- Billing providers + plan-change flows

---

## Stress Test & Phase 1 Corrections (post-Phase-1 review)

After Phase 1, we ran a 5-angle stress test against the $20k MRR target.
Five real contradictions surfaced. User confirmed sender-level wedge with
the GitHub-notifications first-person example (*"10k accumulated
notifications cleaned with one sender decision"*). All five contradictions
resolved below as D121–D125, with updates to earlier decisions noted.

### D121 — No trial mechanic; 30-day Money-Back Guarantee on Pro

**Replaces D113's accidental "14-day trial" mention.** V2 ships without
any trial mechanic. Users pay Plus or Pro from day 1. Pro tier carries
a **30-day Money-Back Guarantee** (full refund, no questions asked).

**Implications:**
- D113 corrected: trial reference removed. Selecting Balanced/Autopilot
  preset on Free tier shows upgrade modal (no implicit trial start).
- Marketing pricing page prominently shows "30-day money-back guarantee."
- Refund process: user emails support OR uses "Request refund" button
  in Settings → Plan & Billing within 30 days of payment. Backend
  triggers Paddle/Razorpay refund. Subscription cancels immediately.
- Refund analytics: tracked in `subscription_events.refund_reason` for
  cohort analysis.
- Conflict #1 dissolved: without a trial window, "Autopilot Observe
  takes 7 days" no longer competes with trial expiration. Pro users
  see Autopilot Observe→Active prompt within their first paid month.

### D122 — Triage S key renamed: **"Decide later" (keyboard L key)**

**Updates D29.** The fourth verb in Triage is now labeled "Decide later"
(keyboard shortcut **L**). User-facing copy throughout app uses "Later"
or "Decide later." Internal/schema term "Screen" / "Screener queue"
persists in code and database.

**Implications:**
- Triage row buttons: K (Keep) / A (Archive) / U (Unsubscribe) / **L (Later)**
- Onboarding Step 5 tour teaches K/A/U/L (instead of K/A/U/S).
- Tooltip on L button: *"Send to Decide-later queue. Review when you're
  ready."*
- Screener screen sidebar entry still labeled "Screener" (internal term)
  OR rename to "Decide later" / "Later" for consistency — recommend
  matching user vocabulary throughout, so sidebar reads "Later (3)".
- Soft-quarantine behavior (D72) makes more sense under "Decide later"
  framing — user understands no Gmail action happens until they decide.

### D123 — Tier-specific Triage empty-state copy

**Updates D33.** Three different empty-state versions by tier:

**Free user empty state:**
```
You cleared 5 senders today.

Estimated impact: ~520 future emails will skip your inbox.

[Pro could do this for you automatically. Learn more →]
[$19/mo — 30-day money-back guarantee]
```

**Plus user empty state:**
```
You cleared 8 senders today.

Estimated impact: ~840 future emails will skip your inbox.

[Upgrade to Pro for Autopilot, Brief, and Quiet Hours →]
[$19/mo — 30-day money-back guarantee]
```

**Pro/Power user empty state:**
```
You cleared 8 senders today.

Estimated impact: ~840 future emails will skip your inbox.

🔥 5-day streak — see you tomorrow.

(no upgrade nudge for Pro users)
```

### D124 — VIP elevation in Brief is hard-coded engine behavior; preset #5 replaced

**Updates D67 (confirms hard-coded) + D101 (replaces preset #5).**

VIPs are always elevated in Brief by the engine — not a user-toggleable
rule. Removed from Autopilot preset list. Preset #5 replaced with:

**5. Long-dormant unsubscribe** — Read rate < 5% AND last seen > 180
days → Unsubscribe (Observe mode 7 days). Catches old promo
subscriptions that have gone quiet but might resume.

So the 5 presets at V2 launch are:
1. Auto-archive low-engagement (verdict=Archive >85% conf)
2. Auto-unsubscribe noisy senders (verdict=Unsub >90% conf)
3. Auto-screen new senders
4. Newsletter graveyard (read <5% AND last seen >90d)
5. **Long-dormant unsubscribe** (read <5% AND last seen >180d) ← NEW

### D125 — Snoozed + Followups stay at V2 launch with usage-tracking exit clause

Honors bundle-loyal scope (D3). Ships D78-D91 as committed (~3 weeks
build time included). Tracking criteria for V2.1 cut decision:

**Snoozed cut criteria** (after 60 days of usage):
- < 25% of Pro users have used snooze at least once
- Average user snoozes < 1 sender per month

**Followups cut criteria** (after 60 days):
- < 15% of Pro users have a non-empty Followups list view
- Average user clicks "Mark resolved" or "Open in Gmail" < 2× per month

If either cut criterion hits, the feature is removed in V2.1 with
6-week deprecation notice to affected users.

**Schema retention plan if cut:**
- Snoozed: drop UI, keep sender_policies.snoozed_until column for
  legacy data (allow restore-via-API but no UI to add new).
- Followups: drop UI + worker, keep `followup_tracker` table for 1
  year then archive.

---

## Phase 1 stress-test outcomes — what we *didn't* change

Several decisions held up under the stress test and don't need revision:

- **D7 (snippet as "Gmail preview" framing)** — privacy framing is
  honest and CASA-defensible.
- **D20 (4 verdicts: Keep/Archive/Unsubscribe/Screen→Later)** — clean,
  sustainable, no ambiguity.
- **D22 (no category prediction)** — wedge-aligned, validated by user.
- **D42 (VIP + Protect as separate)** — both have clear use cases,
  user confirmed.
- **D116 (rich Privacy & Data section)** — load-bearing trust artifact.
- **D6 (strict sync gate)** — kept; instrumentation post-launch will
  catch activation cratering early.
- **D19 (Pro $19/mo, Plus $9/mo)** — validates against SaneBox $7-25
  range, sits cleanly below the $20 individual-purchase threshold.

## Stress-test tests scheduled (post-implementation)

These tests run during private/public beta — not gating Phase 2:

1. **Funnel analytics** (Day 1 of beta): visit → connect-OAuth → first
   action by user. Track Promise screen heatmap (D107).
2. **Van Westendorp Price Sensitivity Meter** survey during paid beta
   (~100 users) to validate $19 Pro price.
3. **30-day MBG refund rate** tracking (D121). Healthy < 5%.
4. **D125 cut criteria** at 60 days post-launch for Snoozed + Followups.
5. **Day-1 → Day-7 → Day-30 retention** by onboarding preset chosen
   (Minimal/Balanced/Autopilot per D108).
6. **Trial-equivalent conversion: Free → Plus and Plus → Pro** —
   percentage of Free users who upgrade within 30/60/90 days.
   Healthy targets: 8-15% Free→paid in 90 days.

---

## Angle 6 — Retention / Churn Risk (added after Phase 1)

### D126 — Retention investment package (5-part)

Cleanup-first SaaS structurally tends to higher churn (5-10% monthly).
For $20k MRR to be sustainable, Pro must retain. Five mitigations
locked into the plan:

**Part 1 — Instrument retention from Day 1 (P0, not deferred):**
- PostHog or Mixpanel cohort tracking installed in beta build before
  first user lands.
- Required cohort metrics:
  - Daily/Weekly/Monthly active rate per cohort
  - Triage queue length per user, week-over-week
  - Brief open rate (in-app + email)
  - Pro feature engagement (Brief opens, Quiet enables, Autopilot
    activates, Snoozes created)
  - Day-1 → Day-7 → Day-30 → Day-90 retention curves
- Alert thresholds set:
  - Daily-active < 50% by Day 30 → escalate
  - Triage queue averaging < 2 senders/day by Day 60 → escalate

**Part 2 — "Queue running empty" UX in V2.0 (not V2.1):**
- When Triage queue < 3 senders for 3 days running, automatically
  switch user's Triage to *weekly review mode*:
  - Queue refreshes Mondays only with 15-20 senders for the week
  - Different visual treatment ("This week's review" vs "Today's
    queue")
  - Settings has a manual override to switch back to daily
- Side effect: low-clutter users have a different daily ritual cadence,
  preserving habit (just at weekly cadence).

**Part 3 — Re-engagement email sequence (launch artifact):**
- **Day 3 if not opened since signup:** *"Your inbox is ready — saw
  X new senders waiting"*
- **Day 7 if not active in 5 days:** *"4 noisy senders are waiting in
  Triage — 30 seconds to clear them"*
- **Day 14 if not active:** *"What's happening with your inbox while
  you're away"* — Brief summary of last 7 days of email patterns
- **Day 30 if not active + Pro:** *"You're not using your Pro
  subscription — pause it for a month?"* (pause offer to preempt churn)
- All emails use the same calm/premium tone as in-app. Plain text only;
  no marketing chrome.
- Sequence sends from `notifications@declutrmail.com` or equivalent.

**Part 4 — Annual Pro pricing variant (updates D19):**

| Tier | Monthly | Annual |
|---|---|---|
| Free | $0 | — |
| Plus | $9/mo | $90/yr |
| **Pro** | **$19/mo** | **$149/yr** *(was $190 — sweetened for retention)* |
| Pro Founding | — | $129/yr (first 250) |
| Power | TBD | TBD |

- Pro annual $149 = $12.42/mo effective = 35% off monthly. Strong
  reason to commit annually.
- Annual users have ~50% lower churn than monthly (industry standard);
  this becomes the retention strategy: convert monthly users to annual
  via a *"Save $79/yr — switch to annual"* prompt at Day 60-90.
- D19's $190/yr Pro annual is replaced. Plus annual stays at $90/yr.

**Part 5 — No lifetime Pro at launch (defer as emergency lever):**
- Don't add lifetime Pro pricing in V2 launch.
- Reserved as last-resort retention play if monthly churn > 8% AND
  acquisition can't keep up.
- Reasoning: lifetime kills the recurring-revenue thesis; one-time
  payment from heavy users hurts long-term LTV.

**Implications:**
- Pricing page on marketing site: 2 annual prices for Pro (regular
  $149 + Founding $129 for first 250). Founding badge ribbon makes
  this clear.
- Paddle / Razorpay products created: `pro_annual_149`,
  `pro_annual_founding_129`, `pro_monthly_19`. Founding has limited
  redemption count (max 250 across providers).
  [CODEX PATCH 2026-05-18: "Stripe" removed — D117 locked Paddle + Razorpay only.]
- Annual-conversion prompt logic in app: surface "Save $79 — switch
  to annual" banner to monthly Pro users at Day 60.

---

# 📋 Phase 1 + Stress-Test FULLY COMPLETE

**126 numbered decisions** (D1–D126) in the plan file covering audit,
all 14 product topics, plus 6 stress-test angles with action items.

---

# Phase 2 — Marketing + brand

## Phase 2 / Topic 15 — Brand + Domain

### D127 — Brand name: **DeclutrMail** (locked from V1)

User owns both `DeclutrMail.com` and `DeclutrMail.ai`. Brand name
preserved from V1. No rename.

### D128 — Primary domain: **DeclutrMail.com**

Primary on `.com`. `.ai` redirects to `.com` (catches typos, preserves
SEO equity).

**Rationale:** `.com` signals "real, stable business" — aligned with
trust+audit positioning. `.ai` would signal "AI-first chat product"
which contradicts D24 (deterministic verdict, LLM for explanation only).

**Implications:**
- DNS: `.ai` → 301 permanent redirect to `.com` (preserves SEO)
- Email sender: `notifications@declutrmail.com` (Paddle / Razorpay
  webhooks too)
- Social handles: `@declutrmail` reserved on Twitter/X, LinkedIn,
  Reddit, Bluesky
- All marketing copy and screenshots use `.com` form.

### D129 — Hero tagline: *"Clean Gmail by controlling senders, not individual emails."*

PMV's recommended one-liner. Sharp, clear, sender-control wedge front
and center. Lives on:
- Landing page hero
- Email signature for support emails
- Social media bio (twitter/X, LinkedIn)
- Embedded in `<title>` and meta description for SEO

### D130 — Brand voice principles (locked, summarizing Phase 1)

Five anchor adjectives + concrete copy rules:

1. **Calm** — short sentences, no urgency-marketing tropes ("ACT NOW")
2. **Premium** — restraint over decoration, white space, mono labels
3. **Private** — explicit about what we do/don't see, *"bodies read: 0"*
4. **Trustworthy** — audit-first, never promise what we don't control
5. **Precise** — specific numbers when available, no marketing fluff

**Concrete copy rules:**
- No exclamation marks except in error states.
- No emoji in product UI (rare exception: ⭐ for VIP, 🔒 for Protect).
- Numbers always specific ("47 senders", not "many senders").
- Avoid: "amazing", "powerful", "revolutionary", "AI-powered".
- Embrace: "calm", "exact", "audited", "reversible", "your".
- Mono font for chrome (eyebrows, micro labels, timestamps).
- Editorial italic accents reserved for marketing display headers.

---

## Phase 2 / Topic 16 — Marketing site IA

### D131 — Top nav: **6-item flat**

`Logo · How it works · Methodology · Compare · Pricing · Blog · Sign in`
+ primary CTA `[Get started →]` (right-aligned).

Discoverable, functional, all major pages have nav presence.

### D132 — 28-page launch IA (scaled with Claude SEO agent maintenance)

**Tier 1 — Core product (10 pages):**
- `/` (landing)
- `/how-it-works`
- `/methodology`
- `/pricing`
- `/inbox-simulator` (or `/demo` — pick one URL)
- `/sign-in`
- `/post-oauth` (OAuth callback)
- `/privacy`
- `/terms`
- `/contact`

**Tier 2 — Comparison (5 pages):**
- `/vs/clean-email`
- `/vs/trimbox`
- `/vs/sanebox`
- `/vs/leave-me-alone`
- `/vs/gmail-filters`

**Tier 3 — How-to SEO (5 pages):**
- `/how-to/clean-gmail-by-sender`
- `/how-to/bulk-delete-emails-from-one-sender`
- `/how-to/auto-archive-future-emails-in-gmail`
- `/how-to/stop-promotional-emails-gmail`
- `/how-to/unsubscribe-from-emails-gmail`

**Tier 4 — AEO/GEO answers (5 pages):**
- `/answers/is-it-safe-to-connect-gmail-app`
- `/answers/what-is-metadata-only-email-analysis`
- `/answers/how-undo-works-for-gmail-cleanup`
- `/answers/best-way-to-clean-gmail-2026`
- `/answers/sender-level-vs-message-level-cleanup`

**Tier 5 — Infrastructure (3 pages):**
- `/blog` (index, posts added over time)
- `/changelog` (build-in-public)
- `/faq`

**Implementation strategy:**
- Tier 1 + Tier 2 hand-crafted by user + Claude Code at launch.
- Tier 3 + Tier 4 drafted by Claude SEO agent; user reviews and
  publishes in waves over first 8 weeks post-launch.
- Tier 5 ships as empty shells at launch; populated organically.
- Claude SEO agent maintains content quarterly (refresh dates, update
  comparisons, etc.).

### D133 — Inbox Simulator: **Claude Code React build with real engine**

V2 launch ships `/inbox-simulator` as a React page sharing component
code with the production Triage screen:

- React component reuses `<TriageRow>`, `<RecommendationBadge>`, action
  tray etc. from production code.
- Mock data file at `/lib/demo/mock-inbox.ts` — ~15-20 hand-picked
  recognizable senders (LinkedIn, Notion, Stripe, Old Navy, Letters of
  Note, etc.).
- The same `recommend()` function from D24's recommendation engine runs
  client-side on mock data. Demo verdicts are *real* engine output,
  just on fake data.
- localStorage stores user's demo decisions across page loads.
- PostHog analytics tracks: page view, first decision, decisions
  count, OAuth-clickthrough.
- No backend calls during demo (privacy-clean — *nothing* sent to
  server during demo use).
- Build estimate: ~3-4 days post-Triage component completion.

**Demo flow:**
1. User lands on `/inbox-simulator` (no signup).
2. Pre-populated mock Gmail shows 15-20 senders with engine
   recommendations.
3. User clicks K/A/U/L (keyboard works) on demo senders.
4. Each decision updates the activity panel ("Notion · Archived · 184
   emails projected impact").
5. After 5 decisions, projection: *"Estimated impact: ~4,200 future
   emails will skip your inbox. Done in 47 seconds."*
6. CTAs: primary *"See this on your real inbox → [Connect Gmail]"* /
   secondary *"How we calculate this → /methodology"*.

---

## Phase 2 / Topic 17 — Landing page hero + sections

### D134 — Landing page 10-section structure

In order:

1. **Hero** — animated preview card + tagline + primary/secondary CTA
2. **Trust strip** — `🔒 Bodies read: 0 forever · CASA Tier 2 verified · 30-day money back`
3. **Problem statement** — *"Your inbox has thousands of emails. The cleanup is N decisions, not N emails. We make it N senders."*
4. **How it works** — 3-step diagram (Connect → Triage → Done)
5. **Sender-vs-message wedge** — side-by-side comparison illustrating why sender-level wins (your GitHub-notifications example as a worked illustration)
6. **Feature preview** — 3 cards: Triage, Brief, Autopilot — each with mini visual + 1-paragraph blurb
7. **Comparison preview** — DeclutrMail vs Clean Email vs SaneBox vs Gmail filters mini-table + "See full comparison →" link
8. **Pricing preview** — 3-tier strip (Free / Plus $9 / **⭐ Pro $19**) + Founding banner + "30-day money back" + "See full pricing →"
9. **FAQ** — 8-10 questions (curated below)
10. **Final CTA + footer** — *"Try the demo →"* + *"Connect Gmail →"* + footer

### D135 — Hero animated preview card

Bundle's pattern in `marketing/index.html`. Sequence (loops every 8 sec):

1. **Frame 0** (1s): Sender card appears with name + cadence chip
   ("LinkedIn · 47/mo · 0 opened · ↓ Archive 0.92")
2. **Frame 1** (2-3s): Subtle K/A/U/L button row highlights, with A
   visually emphasized
3. **Frame 2** (4s): A button "is pressed" — row gets archive-style
   strikethrough and slides out
4. **Frame 3** (5-6s): Activity toast appears bottom-right:
   *"Archived · LinkedIn · 412 messages · Undo for 7 days"*
5. **Frame 4** (7-8s): Whole sequence resets

Animation built with Framer Motion. Respects `prefers-reduced-motion`
(static state shown instead).

Hero copy:
- **Headline:** *"Clean Gmail by controlling senders, not individual
  emails."* (D129)
- **Subhead:** *"Make one decision per sender. We do the rest — safely,
  auditably, with undo."*
- **Primary CTA:** *"Connect Gmail →"*
- **Secondary CTA:** *"Try the demo first →"* (links to /inbox-simulator)

### D136 — Social proof strategy: beta quotes post-launch (no testimonials at launch)

V2 launch ships *without* testimonials. Replaced by:
- Build-in-public artifacts (Twitter/X post embed if available)
- Founder bio (1 paragraph + photo) in About section of methodology
  page
- The animated demo + the trust strip carry credibility

**Beta-user testimonials added 30-45 days post-launch:**
- Collect 5-10 authentic quotes from private beta users (need explicit
  written permission)
- Insert as new section between #6 (Feature preview) and #7 (Comparison
  preview)
- Each quote includes: name, anonymizable photo (or just initials),
  short role descriptor, 1-2 sentence quote that's specific and
  unexaggerated

### D137 — FAQ content (10 questions)

Drafted from PMV §9 + landing-page strategy:

1. *"What does DeclutrMail actually see in my Gmail?"*
2. *"Does it read my emails?"*
3. *"Can it mess up my inbox?"*
4. *"What can I undo?"*
5. *"How is this different from Gmail's native filters or Gemini?"*
6. *"Why pay $19/mo when Gmail is free?"*
7. *"What happens if I disconnect or delete my account?"*
8. *"Will you ever sell my data?"*
9. *"Does it work for work / non-Gmail accounts?"*
10. *"Is there a refund policy?"*

Each answered in 2-4 sentences with link to relevant deeper page
(privacy / methodology / pricing).

### D138 — Trust strip content (just after hero)

```
🔒 Bodies read: 0 forever  ·  ✓ CASA Tier 2 verified
30-day money-back guarantee  ·  Read our methodology →
```

Mono-font row. Sets the trust tone immediately after hero.

---

### Topic 17 complete: **Landing decisions D134–D138 captured.**

5 decisions covering 10-section structure, animated hero card, social
proof strategy, FAQ content, trust strip. Ready for Topic 18
(Methodology page).

---

## Phase 2 / Topic 18 — Methodology page

### D139 — Methodology: **Layered (summary + expandable deep sections)**

Apple Privacy-style structure. Default view is a scannable ~800-word
summary; clicking "For the curious →" affordances expands sections to
full whitepaper depth (~3000+ words total content). All content loads
in HTML for SEO; JS only collapses sections by default.

**8 sections, each with a summary + expandable deep version:**

1. **Promise** — the calm one-paragraph version of what we do and
   what we don't.
2. **What we see** — sender + subject + 160-char preview + timestamps +
   label IDs. Diagram: data flow with "body / attachments / images"
   visually crossed at a boundary line.
3. **What we never store** — full bodies, attachments, images, full
   headers, OAuth tokens in browser. With "why" for each.
4. **How we recommend** — the engine cascade (D21). Conceptual
   diagram: respect rules → engagement → volume/behavior → verdict.
   Plain English description of each rule.
5. **How we act** — action lifecycle (D9, D34, D58). Conceptual
   diagram: click → confirmation sheet → operation accepted → worker
   → Activity → undo. No mention of outbox/Pub/Sub/workers internally.
6. **Privacy & Security** — KMS envelope encryption (D14), CASA Tier 2
   verification, annual re-cert, embedded CASA letter PDF, data
   retention policy.
7. **Open questions** — honest about what we *don't* yet know or
   handle. Builds trust through humility ("What we'd love feedback
   on:").
8. **Founder's note** — 1-paragraph from Chintan about why DeclutrMail
   exists. Photo + signature.

### D140 — Diagrams: **3 conceptual, no architecture**

1. **Data flow diagram** (under section 2):
   - Visual: Gmail → DeclutrMail (with allowed data labeled) →
     recommendations.
   - Bodies / attachments / images / full headers visually crossed at
     a red dashed boundary line.
2. **Action lifecycle diagram** (under section 5):
   - Visual: 6 steps left-to-right: Click → Sheet → Accepted →
     Execute → Activity → Undo.
   - Time labels: typical durations (≤500ms accepted, ≤30s executed,
     7 days undo window).
3. **Recommendation engine cascade** (under section 4):
   - Visual: layered ladder showing respect → engagement → scoring →
     verdict.
   - Annotated with the 5 verdicts: Keep / Archive / Unsubscribe /
     Decide later / (locked: VIP, Protect).

All diagrams in calm Geist-typed Vercel-style minimalism. SVG so they
scale on retina. Alt text for accessibility.

### D141 — CASA letter and certifications

PDF of the CASA Tier 2 verification letter (issued date, expiration,
auditor name) embedded as a download link at the top of section 6 and
in the trust strip on the landing page.

Plus an "Annual re-certification" schedule note: *"Our CASA verification
renews every July. Latest letter: July 2026."*

---

### Topic 18 complete: **Methodology decisions D139–D141 captured.**

3 decisions covering layered structure, 3 conceptual diagrams, CASA
letter embed. Ready for Topic 19 (Comparison pages).

---

## Phase 2 / Topic 19 — Comparison pages

### D142 — Comparison tone: **Balanced (acknowledge competitor strengths)**

Each /vs/ page:
- Honest about where competitor has real strengths
- Clear about DeclutrMail's wedge wins
- Includes a "Choose X if you want Y" decision aid at the top
- Reads as buyer's guide, not sales doc

### D143 — Comparison feature rows: **10-row table**

1. Sender-level vs message-level focus
2. Privacy posture (bodies read)
3. Activity audit log
4. Undo affordance
5. Autopilot (ongoing automation)
6. Brief (daily digest)
7. Multi-inbox support
8. Free tier
9. Pricing
10. Money-back guarantee

Each cell explains in plain English what each tool actually does — no
bare ✓/✗ marks without context.

### D144 — Honest "Choose competitor if..." callouts

Per /vs/ page, a callout box near the top:

- **`/vs/clean-email`:** *"Choose Clean Email if you need Outlook/Yahoo/iCloud support today. We're Gmail-only."*
- **`/vs/trimbox`:** *"Choose Trimbox if you want one-time cleanup with no subscription. We're recurring."*
- **`/vs/sanebox`:** *"Choose SaneBox if you need 10+ years of company maturity. We're new."*
- **`/vs/leave-me-alone`:** *"Choose Leave Me Alone if you only want unsubscribe-with-credits. We're a broader sender-control plane."*
- **`/vs/gmail-filters`:** *"Choose Gmail Filters if you're a power user who wants to write filter rules yourself and never wants to pay anything. We do that work for you."*

### D145 — `/compare` index page

A landing page at `/compare` that lists all 5 /vs/ pages in a card grid,
plus a "How we differ" overview. Provides hub navigation to the
individual comparisons.

---

### Topic 19 complete: **Comparison decisions D142–D145 captured.**

4 decisions covering tone (balanced), feature rows (10), honest
callouts per page, /compare index. Ready for Topic 20 (Privacy + Terms).

---

## Phase 2 / Topic 20 — Privacy + Terms drafts

### D146 — Privacy + Terms generation: **Claude-drafted from CASA/methodology + lawyer review at user-threshold**

V2 launch ships with Privacy Policy + Terms of Service generated by
Claude using:
- D116 (Privacy & Data section content)
- D139 (methodology page)
- D7 (snippet handling framing)
- D116 deletion actions (3-tier exit)
- CASA Tier 2 letter content
- D146 cookie banner spec
- D148 DPDP Act compliance clauses

**Lawyer review deferred until validation threshold:**
- Trigger 1: 500 paying customers (Plus + Pro combined), OR
- Trigger 2: $5k MRR, OR
- Trigger 3: First customer dispute / GDPR data-request received
- Lawyer engaged for ~$1.5-3k one-time review at that point.

**Maintenance approach post-launch:**
- Quarterly review by Claude SEO/legal agent (compare against current
  best-practices, flag changes needed).
- Yearly lawyer review once threshold hit.
- Any material change (new scope, new processor, new product behavior)
  triggers immediate re-review — never silently shipped.

**Implementation:** generate via Claude with a specific
`generate-privacy-policy` skill or via `engineering:documentation`
skill. Output stored in `/docs/legal/` with version control.

### D147 — Cookie consent banner: **Minimal (essential always-on + optional analytics)**

Single banner on first visit:

```
We use essential cookies for sign-in and billing.

Help us improve DeclutrMail? We use PostHog to understand which
features matter. We never see your inbox content.

[ Accept all ]  [ Essential only ]
```

User's choice stored in localStorage. Banner doesn't return.

**Implementation:**
- Built in-house (no Cookiebot/OneTrust — adds chrome).
- `users.preferences.cookie_consent` for logged-in users (synced).
- Auth + billing cookies always set (essential).
- PostHog only initialized after consent — opt-in by default.
- GDPR/CCPA/DPDP-compliant: essential cookies don't require consent;
  analytics requires explicit consent.

### D148 — Localization: **English only + DPDP Act compliance clause**

V2 launch ships English-only Privacy + Terms with a specific section
addressing India's Digital Personal Data Protection Act 2023 (DPDP Act):

- Data Fiduciary identity (DeclutrMail entity)
- Lawful purpose (provide email cleanup service)
- Notice & consent (explicit consent for data processing)
- Data Principal rights (access, correction, erasure)
- Grievance officer contact
- Breach notification procedure

Hindi translation deferred until Indian user base reaches threshold
(e.g., 200 Indian Pro subscribers or specific user request).

---

### Topic 20 complete: **Legal decisions D146–D148 captured.**

3 decisions covering Privacy/Terms generation strategy, cookie consent,
DPDP compliance.

---

# 🎯 PHASE 2 COMPLETE

**Topics 15–20 (Marketing + brand) all captured.**

**Decisions D127–D148 (22 decisions in Phase 2).**

Plan file now contains **148 numbered decisions** spanning:
- Phase 1: 14 product topics + 6 stress-test angles (D1-D126)
- Phase 2: 6 marketing/brand topics (D127-D148)

**Next:** Phase 3 — Backend specs (Topics 21–25).

---

## Angle 7 — Build-time + Founder Bandwidth Realism (post-Phase-2 stress test)

### D149 — Launch strategy: **Strategy A (full V2 as designed) at 25-35 hrs/week + heavy Phase 4 Claude OS investment**

**Revised timeline (factoring in Claude subagent + hooks + CI patterns):**

| Category | Pre-Claude estimate | With Claude OS |
|---|---|---|
| 28 marketing pages | ~6 weeks | **~1.5 weeks** |
| 13 product screens | ~16 weeks | **~5-6 weeks** |
| Backend CRUD + APIs | ~10 weeks | **~3-4 weeks** |
| Recommendation engine (D21) | ~3 weeks | **~2-3 weeks** |
| Sync workers + Pub/Sub | ~4 weeks | **~3 weeks** |
| Action lifecycle + outbox + KMS | ~4 weeks | **~2 weeks** |
| Pro feature workers (Brief LLM, Screener, Quiet, Snooze, Followup) | ~4 weeks | **~2 weeks** |
| Paddle + Razorpay integration | ~2 weeks | **~2 weeks** (provider quirks resist compression) |
| Polish + mobile + accessibility | ~3 weeks | **~2 weeks** |
| Testing + bug-fix cycles | ~3 weeks | **~2 weeks** (real-Gmail testing patience-bound) |
| **Total** | ~55 weeks | **~26-31 weeks compressed** |

**At 25-35 hrs/week (user's confirmed bandwidth):**
- ~6-7 calendar months for the full V2 build
- Target launch: **Nov-Dec 2026**

**Critical caveats:**
1. **Phase 4 Claude OS quality is the new constraint.** Skipping or
   rushing Phase 4 destroys the implementation compression. Plan to
   spend 2-3 weeks of dedicated time on CLAUDE.md, .claude/agents/,
   hooks, CI gates *before any feature PRs ship*.
2. **Real-Gmail testing is patience-bound.** Plan 3-4 weeks of "test
   against real Gmail account with mock data growing to 50k messages"
   inside the timeline. Not parallelizable.
3. **Customer support post-launch is human-bound.** First 100 users will
   surface 50+ support tickets. Claude drafts responses; human reviews
   each one for first 90 days.
4. **Marketing distribution is not parallelizable.** Implementation-
   fast ≠ growth-fast. Time to first 100 paying customers depends on
   real outreach work post-launch, not implementation speed.

**Strategic implications captured into Phase 4:**
- Phase 4 (Topics 26-35) deserves the most rigorous brainstorm
  of any phase. CLAUDE.md content, subagent definitions, hooks,
  CI gates all directly determine implementation compression.
- D125 (Snoozed + Followups usage tracking) remains the safety
  valve — if either feature isn't validating in private beta,
  cut decisively for V2.1 to redeploy effort elsewhere.

---

## Reality-check summary (Phase 1 + 2 + 7 stress angles)

- **Wedge validated:** sender-level control (user's GitHub example;
  D20-D22).
- **Scope realistic:** full V2 in 6-7 months at 25-35 hrs/week with
  Claude OS (D149).
- **Pricing locked:** Pro $19/mo or $149/yr; Founding $129/yr first
  250; 30-day MBG (D121, D126).
- **Activation safety nets:** D107 promise screen, D109 sync gate
  polish, D74 sidebar badge, D75 onboarding screener handoff.
- **Retention investment:** D126 5-part package (instrumentation,
  queue-empty UX, re-engagement emails, annual variant, no lifetime).
- **Open risk:** Gemini commodification 12-18 months out. Mitigation
  = trust+audit+undo wedge (already locked).
- **Open dependency:** CASA Tier 2 renewal annually (D4 follow-up).

---

# Phase 3 — Backend specs

## Phase 3 / Topic 21 — Database schema final

### D150 — Indexing strategy: **12 indexes at launch (9 composite + 1 trigram + 2 partial)**

Conservative + targeted at the <200ms SLO. Add more post-launch via
slow-query log.

**Initial 12 indexes:**
1. `idx_sender_profiles_account_noise` ON `(mailbox_account_id, noise_score DESC NULLS LAST)`
2. `idx_sender_profiles_account_lastseen` ON `(mailbox_account_id, last_seen_at DESC NULLS LAST)`
3. `idx_sender_recommendations_unique` ON `(mailbox_account_id, sender_key)` UNIQUE
4. `idx_sender_profiles_trigram` USING GIN ON `lower(display_name || ' ' || sender_domain)` (pg_trgm for D53 search)
5. `idx_mail_messages_account_sender_received` ON `(mailbox_account_id, sender_key, received_at DESC)`
6. `idx_mail_messages_account_received` ON `(mailbox_account_id, received_at DESC)`
7. `idx_activity_log_workspace_occurred` ON `(workspace_id, occurred_at DESC)`
8. `idx_activity_log_account_occurred` ON `(mailbox_account_id, occurred_at DESC)`
9. `idx_activity_log_account_sender_occurred` ON `(mailbox_account_id, sender_key, occurred_at DESC)`
10. `idx_action_operations_account_status` ON `(mailbox_account_id, status, created_at DESC)`
11. `idx_outbox_events_pending` ON `(created_at)` PARTIAL WHERE `status = 'pending'`
12. `idx_action_operation_items_operation` ON `(operation_id, status)`

### D151 — Partitioning: **Hybrid (hash mail_messages, range activity_log)**

**mail_messages:** hash partition by `mailbox_account_id`, 16 partitions.
- Each partition stays small (~3M rows max at 50M total).
- All queries `WHERE mailbox_account_id=?` route to one partition.
- Partition function: `partition_key = abs(hashtext(mailbox_account_id::text)) % 16`.

**activity_log:** range partition by month on `occurred_at`.
- Creates one partition per month (e.g., `activity_log_2026_06`).
- Old partitions stay queryable but cold-storage-friendly.
- Routine: drop activity log partitions older than 5 years (retention
  policy).

**Other tables stay unpartitioned at launch.** Revisit if individual
tables exceed 20M rows.

### D152 — Migration tooling: **Drizzle Kit + Atlas hybrid**

- **Drizzle Kit** (`drizzle-kit generate:pg`) generates migrations
  from schema-as-TypeScript changes. Forward-only by default.
- **Atlas** runs in CI on every PR that touches `/db/schema/` —
  flags dangerous migrations (table locks, NOT NULL on large tables,
  index creation that requires CONCURRENTLY, etc.).
- **Rollback notes** written manually in a `rollback.sql` companion
  file for each migration. Enforced via pre-commit hook.
- **Tests** added per Codex Doc 04 §18 for each migration:
  apply-rollback-apply round-trip test on a fresh schema.

**Production migration runbook:**
1. PR with migration file + rollback file + tests
2. Atlas CI check passes
3. Code reviewer approves
4. Merge → CI runs migration in staging
5. Smoke tests pass in staging
6. Manual approval to apply in production (via deployment tool)
7. Post-deploy verification: index-usage check, query-latency check

---

## Phase 3 / Topic 22 — API endpoint specs

### D153 — API style: **REST + Zod schemas + Swagger/OpenAPI auto-gen**

NestJS with:
- REST endpoints (resource-oriented)
- **Zod** schemas for request/response validation (shared with frontend
  for end-to-end type safety)
- `@anatine/zod-nestjs` or similar adapter so Zod schemas drive both
  validation and Swagger docs
- Swagger UI auto-generated at `/api/docs` (gated to admin in
  production)
- DTOs derived from Zod schemas (`z.infer<typeof X>`)

**Endpoint surface inherits from Codex Doc 03 §5:**
- `GET /api/v1/workspaces`
- `GET /api/v1/mailbox-accounts` + `/:id/readiness` + `/:id/resync` + `/:id/disconnect`
- `GET /api/v1/senders` (filtered, sorted, paginated)
- `GET /api/v1/senders/:senderKey`
- `GET /api/v1/senders/:senderKey/activity`
- `GET /api/v1/senders/:senderKey/timeseries` (charts data per D45)
- `POST /api/v1/actions/preview`
- `POST /api/v1/actions/execute` (idempotent)
- `POST /api/v1/actions/:operationId/undo`
- `GET /api/v1/activity` (filtered per D56)
- `GET /api/v1/autopilot/rules` + preset endpoints
- `POST /api/v1/provider/gmail/pubsub` (webhook, signature-verified)

### D154 — API versioning: **URL prefix (`/api/v1/`)**

`@nestjs/common` `@Version('1')` decorator handles routing. Breaking
changes bump to `/api/v2/` and the old version stays operational for
≥ 90 days.

### D155 — Auth: **HttpOnly cookies + CSRF + rotating refresh + active_sessions table**

- **Access JWT:** 15-min lifetime, in HttpOnly `Secure` `SameSite=Lax`
  cookie
- **Refresh JWT:** 30-day lifetime, rotating (each refresh issues new
  refresh + invalidates old), in HttpOnly `Secure` `SameSite=Strict`
  cookie
- **CSRF token:** rotated per session, in non-HttpOnly cookie + sent in
  `X-CSRF-Token` header for state-changing requests
- **active_sessions table:** allow-list for revocation. Every auth
  request validates JWT signature + checks `active_sessions.is_revoked
  IS FALSE`. ~1ms Redis-cached lookup.
- **Cookie domain:** `.declutrmail.com` (covers root + subdomains)

**Schema additions:**
- `active_sessions`: id, user_id, jti (JWT ID), refresh_token_hash,
  created_at, last_used_at, ip_address, user_agent, is_revoked,
  revoked_at
- Indexed on `(user_id, is_revoked)` for fast lookup

### D156 — Rate limiting: **`@nestjs/throttler` + Redis + per-route limits + global IP ceiling**

- Per-route limits (e.g., `POST /actions/execute = 60/min/user`)
- Global IP ceiling (e.g., 600 req/min/IP)
- Redis-backed for distributed deploys
- 429 response with `Retry-After` header

---

## Phase 3 / Topic 23 — Worker job specs

### D157 — Queue: **BullMQ on Redis (Upstash)**

NestJS `@nestjs/bull` adapter. Workers are a separate NestJS process
(see D158 hosting). Connection: ioredis client to Upstash.

**Worker modules (already from Codex Doc 03 §3):**
- `InitialSyncWorker`
- `HistorySyncWorker`
- `WatchRenewalWorker`
- `SenderRollupWorker`
- `StatsGenerationWorker`
- `RecommendationWorker`
- `RuleEvaluationWorker`
- `ActionExecutionWorker`
- `UndoExecutionWorker`
- `NotificationWorker`
- `DeadLetterWorker`

**Plus Phase 1+2 additions:**
- `MorningBriefWorker` (daily cron per user timezone — D66)
- `SnoozeRestoreWorker` (hourly cron — D79)
- `FollowupCheckWorker` (every 6h cron — D87)
- `QuietHoldWorker` (on new message via Pub/Sub — D93)
- `QuietReleaseWorker` (on quiet period end — D94)
- `WeeklyHeroWorker` (Sunday 11pm local per inbox — D48)
- `DailyTriageWorker` (per user local 6am — D27)

**Retry strategy:** exponential backoff with jitter, max 5 attempts,
then dead-letter queue. Dead-letter alerts to Sentry.

---

# Phase 4 / Topic 27 — Hosting (locked early from user's consolidation)

### D158 — Hosting stack

```
Frontend:        Next.js App Router on Vercel Pro ($20/mo)
Backend API:     NestJS on Cloud Run (us-central1, min_instances=0)
Worker service:  NestJS Worker on Cloud Run (us-central1, min_instances=1)

Queue:           BullMQ
Redis:           Upstash Redis (Memorystore as future migration option)
Database:        Cloud SQL Postgres (us-central1, regional HA)

KMS:             Google Cloud KMS (us-central1)
Observability:   Sentry (errors) + PostHog (analytics + session replay)
CI/CD:           GitHub Actions → Cloud Run deploy + Vercel auto-deploy
```

**Per-service deployment config:**

- **Vercel Pro** (frontend, $20/mo): preview deploys per PR, edge caching,
  Vercel Analytics included. Custom domain: `declutrmail.com` + `app.declutrmail.com`.
- **Cloud Run API** (`min_instances=0`): user-facing API; cold start <2s
  acceptable. Memory 512MB, CPU 1, max 10 instances during scale.
- **Cloud Run Worker** (`min_instances=1`): always-on; no cold-start
  miss on Pub/Sub notifications. Memory 1GB, CPU 1, max 5 instances.
- **Cloud SQL Postgres** (regional HA from day 1): tier `db-g1-small`
  initially; scale to `db-n1-standard-2` at ~100 paying users. Daily
  backups + 7-day PITR.
- **Upstash Redis** (Pay-as-you-go from day 1; free tier insufficient
  for production worker queue): ~$10-50/mo at launch scale.
- **GCP KMS** (us-central1): one CryptoKey for token encryption
  (envelope encryption per D14). ~$5-10/mo.

**Cost projection:**
- Bootstrap (0-100 users): ~$200/mo all-in
- Soft launch (100-500 users): ~$250-350/mo
- Target ($20k MRR, 1k users): ~$700-900/mo
- Gross margin at target: ~91%

---

# Phase 4 / Topic 28 — Observability

### D159 — Observability stack: **Sentry + PostHog**

**Sentry (error tracking + performance):**
- Backend: `@sentry/nestjs` integration
- Frontend: `@sentry/nextjs` integration
- Track: errors, performance traces, release health, Apdex
- Alerting: error rate > 1%, p95 latency > 200ms, new errors
- Cost: Sentry Team plan $26/mo at scale

**PostHog (product analytics + session replay + feature flags):**
- Frontend: `posthog-js` SDK
- Track: page views, funnel events, retention cohorts, session replay
- Cohorts: by tier, by onboarding preset, by inbox size, by first-week-actions
- Feature flags: gradual rollout of new features (e.g., Hard-quarantine,
  Custom rule builder)
- Cost: PostHog cloud free tier (1M events/month) initially; ~$30/mo
  at scale

**Required custom metrics (per Codex Doc 08 + D126):**
- D126: cohort retention curves, Triage queue depth over time, Brief
  open rate, Pro feature engagement
- Codex Doc 08: API p50/p95/p99, queue depth, dead-letter count, Gmail
  API errors, partial-batch failures, sync lag, watch renewal failures

**Logging:**
- Structured JSON logs to Cloud Logging
- Correlation ID propagation (`x-correlation-id` header) per
  Codex Doc 08 §4
- No PII in logs (no email contents, no tokens, no PII fields)

---

# Phase 4 / Topic 29 — CI/CD (partial lock)

### D160 — CI/CD: **GitHub Actions → Cloud Run + Vercel auto-deploy**

**Pipelines:**
- `main` branch push → Vercel auto-deploys frontend to production
- `main` branch push → GitHub Actions runs tests + builds Docker images
  + deploys to Cloud Run (API + Worker)
- PR opens → Vercel preview deploy + Atlas migration safety check + CI
  test suite
- Manual approval gate for production migrations (Drizzle Kit migrations
  via `gh workflow run migrate-prod.yml`)

**Required CI checks** (block merge if fail):
- TypeScript typecheck
- ESLint
- Unit + integration tests (Vitest)
- E2E tests (Playwright, subset)
- Atlas migration safety (per D152)
- Bundle size budget (frontend)
- Lighthouse score on marketing pages (≥90)

**Branch strategy:**
- `main` → production
- Short-lived feature branches → PRs → main
- No long-lived `develop` branch (small team)

---

### Topic 22 + Topic 23 + Topics 27/28/29 (early lock): **D153–D160 captured.**

8 decisions covering API style, versioning, auth, rate limiting,
queue + workers, hosting, observability, CI/CD.

### D161 — Dev-phase cost optimizations (config-only, no service change)

Production-grade infra stack from D158 stays. Two *configuration-only*
optimizations during dev phase:

**1. Cloud SQL: Zonal in dev → Regional HA pre-launch (1-week before public launch)**
- Dev config: single-zone `db-g1-small` (~$40-50/mo)
- Production config (1 week before launch): Regional HA `db-g1-small`
  (~$110-130/mo)
- Migration: Cloud SQL Console → Edit instance → Availability → Regional
- Migration downtime: ~10-15 min, scheduled in low-traffic window
- Runbook stored in `/docs/runbooks/migrations.md`

**2. Worker `min_instances=0` in dev → `1` at first paying customer signup**
- Dev config: no always-on instances; cold-start on each Pub/Sub
  notification (acceptable, ~5s)
- Production config (auto-flipped on first paying customer webhook from
  Paddle/Razorpay): `min_instances=1` via webhook handler calling
  `gcloud run services update`
- Manual fallback: founder can flip via `gcloud` CLI

**Savings during 6-month dev phase: ~$95/mo = ~$570 total.**
Side-income covers this anyway, but worth not burning $600 needlessly.

**Trigger for HA migration (D161-T):**
- Pre-launch checklist item: 1 week before scheduled public launch date
- Scheduled in a deliberate low-traffic maintenance window
- Documented in launch-readiness checklist (Phase 5 Topic 36)

**Cost trajectory:**
- Dev phase (months 1-6): ~$70-100/mo
- Pre-launch upgrade (~1 week): cost rises to ~$220-320/mo
- Soft launch (100-500 users): ~$250-350/mo
- Target ($20k MRR, 1k users): ~$700-900/mo

---

## Phase 3 / Topic 24 — Notification system

### D162 — Email provider: **Resend ($20/mo, 100k emails, React-Email templates)**

Modern API, React-Email for template authoring (templates as React
components — shareable styles with marketing emails), Claude-agent
friendly DX. Covers transactional + re-engagement sequences.

### D163 — Browser push: **Web Push standard via `web-push` library + VAPID keys**

Service worker manages subscription. `browser_push_subscriptions` table
stores per-device subscription. Push events: sync complete, VIP arrival
(Pro), critical-trust events.

### D164 — Mobile push: **Deferred to V2.1+**

Web push covers mobile-browser cases at launch. Native mobile push
requires React Native / native app shell — out of V2 scope.

### D165 — Notification preferences: **Per-category toggles in Settings**

Independent toggles for Brief email, browser push, re-engagement
emails, system emails (system emails non-opt-out per CAN-SPAM/GDPR).

---

## Phase 3 / Topic 25 — Error / empty / loading states

### D166 — Loading patterns: **Skeleton-first with inline action progress**

- Page-level load → skeleton cards/rows matching final layout
- Action click → inline progress on button or row
- Long-running job → "Job card" with live progress
- Modal/sheet confirm → small button-level spinner only

Forbidden: full-page blocking spinners, cute illustrations, generic
"Loading…" text.

### D167 — 404 / 500 pages: **Custom calm branded + auto-Sentry log**

500 page contains the load-bearing trust copy: **"No email actions were
lost. Reference ID: DM-7F2A91"** + [Retry] + [Open Activity Log].
displayId format: `DM-` + first 8 chars of correlationId, uppercase.
Status page deferred.

### D168 — API error envelope: **Standardized structured format**

```json
{
  "error": {
    "code": "ACTION_PARTIAL_FAILURE",
    "message": "Human-readable",
    "correlationId": "uuid",
    "traceId": "w3c-trace-context",
    "displayId": "DM-7F2A91",
    "retryable": true,
    "severityTier": "inline_recoverable"
  }
}
```

### D169 — Three severity tiers

- **Silent transient:** BullMQ retry with backoff; user never sees
- **Inline recoverable:** Activity "needs attention" + retry button (Doc 06 §14)
- **Critical trust:** banner + Activity + email if applicable (D170)

### D170 — Three named critical-trust scenarios

1. **Gmail OAuth revoked mid-action** — persistent banner until
   reconnected; pending actions in `status='paused'`
2. **Sync corruption** — admin-investigated; banner "data safe; no
   actions lost" + admin tooling escalation
3. **Action uncertainty** (Gmail 502 mid-batch) — yellow Activity row
   "verifying X of Y status uncertain" + Worker re-checks via
   `messages.get`

### D171 — Offline / poor-network UX

Online-only with offline banner + queued action retry:
- `navigator.onLine` + API heartbeat detect offline state
- Banner: *"You're offline. Decisions will queue until you reconnect."*
- Actions queue in localStorage with idempotency keys
- On reconnect: replay via standard `/api/v1/actions/execute`
- PWA offline-tolerant cached views deferred to V2.1+

---

# 🎯 PHASE 3 COMPLETE

**Topics 21–25 (Backend specs) captured.**

Phase 3 produced D150–D171 (22 decisions covering schema, indexing,
partitioning, migration tooling, API style, auth, queue/workers,
hosting, observability, CI/CD, notifications, error/empty/loading
states).

Combined with earlier Phases: **171 numbered decisions** in plan file.

**Next:** Phase 4 — Infra + governance (Topics 26, 30, 31, 32, 33, 34, 35).

---

# Phase 4 — Infra + Governance

## Phase 4 / Topic 26 — Repo structure

### D172 — Monorepo with pnpm + Turborepo; 3 apps + 3 packages

```
declutrmail/
├── apps/
│   ├── web/             # Next.js App Router (Vercel)
│   ├── api/             # NestJS HTTP API (Cloud Run)
│   └── worker/          # NestJS Worker (Cloud Run, min_instances=1)
│
├── packages/
│   ├── shared/          # Zod schemas, types, LLM prompts, constants, utils, hooks
│   ├── db/              # Drizzle schema + migrations + queries
│   └── email-templates/ # React-Email components
│
├── docs/                # Codex Doc 09 §4 structure
│   ├── product/
│   ├── architecture/
│   ├── backend/
│   ├── frontend/
│   ├── operations/
│   └── execution/
│
├── .claude/             # Claude OS (Topics 32-35)
│   ├── settings.json
│   ├── agents/
│   ├── skills/
│   └── hooks/
│
├── .github/             # GitHub Actions workflows
│   └── workflows/
│
├── .worktreeinclude     # Files copied into Claude worktrees
├── CLAUDE.md
├── AGENTS.md
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
└── README.md
```

**Tooling:**
- **pnpm** for package management
- **Turborepo** for task orchestration + cache (turbo.json defines task pipelines)
- **TypeScript strict mode** across all packages
- **Path aliases**: `@/*` for app-internal, `@declutrmail/*` for cross-package
- **ESLint + Prettier** shared config in `packages/shared/configs/`

### D173 — Mobile architecture stance: **Refactor-when-ready (Option A + C discipline)**

Ship V2 web-first with simplified 3-package structure. *Discipline imposed
now* to make future mobile add cheap:
- Business logic in `packages/shared/hooks/` (e.g., `useTriageQueue()`,
  `useSenderDetail()`)
- UI components in `apps/web/src/components/` are "dumb" (pure
  presentation + event callbacks)
- When mobile is added (~V2.1+ at earliest): create `apps/mobile/` +
  `packages/mobile-ui/`, write new RN components that consume the
  same hooks from `packages/shared`
- Estimated mobile-add refactoring effort: ~3-5 dev days

**Not adopted:**
- Tamagui / NativeWind cross-platform UI library — too constraining for
  premium design + adds ~3-5 days at launch
- `packages/ui` — only one consumer (apps/web) at launch, doesn't earn
  package status

### D174 — `.worktreeinclude` content (Claude subagent worktree setup)

```
.env.local
.env.development
packages/db/schema.ts
CLAUDE.md
.claude/
docs/
```

Files needed by Claude subagent worktrees that may be gitignored or
otherwise excluded by default.

---

## Phase 4 / Topic 30 — Security hardening

### D175 — Content Security Policy (CSP): **Strict from day 1, nonce-based**

Next.js middleware injects a per-request nonce. CSP header:
- `default-src 'self'`
- `script-src 'self' 'nonce-{nonce}' https://*.paddle.com https://checkout.razorpay.com https://*.posthog.com https://*.sentry.io`
- `style-src 'self' 'nonce-{nonce}'`
- `img-src 'self' data: https://*.googleusercontent.com` (Gmail avatars)
- `connect-src 'self' https://api.declutrmail.com https://*.sentry.io https://*.posthog.com`
- `frame-src https://*.paddle.com https://checkout.razorpay.com` (billing iframes)
- `frame-ancestors 'none'` (no iframe embedding)
- `base-uri 'self'`
- `form-action 'self'`

No `'unsafe-inline'` or `'unsafe-eval'`. Modern XSS defense.

### D176 — Bot protection: **Cloudflare Turnstile on signup/OAuth init**

Invisible-when-legitimate CAPTCHA. Free. Privacy-respecting. Token
validated server-side before allowing OAuth flow start.

Applied to: signup form, OAuth init endpoint, contact form.

### D177 — Secret management: **GCP Secret Manager + env var refs**

Single source of truth for all secrets:
- OAuth client secrets (Gmail)
- DB connection strings
- Paddle/Razorpay webhook secrets
- Resend API key
- Sentry DSN
- VAPID keys for web push
- JWT signing key (rotated quarterly via Secret Manager versioning)

Vercel and Cloud Run both reference Secret Manager via secret refs in
their env config. No raw secret values in code or in version control.

### D178 — Dependency scanning: **Dependabot + Snyk free tier**

- **Dependabot:** auto-PRs for security updates of npm packages
- **Snyk:** richer vulnerability scanning + license compliance (free tier)
- Both run on every PR + scheduled weekly scans

### D179 — CORS configuration (derived)

API service CORS:
- **Origins allowed:** `https://declutrmail.com`, `https://app.declutrmail.com`, `http://localhost:3000` (dev only)
- **Credentials:** `true` (cookies required for HttpOnly JWT auth)
- **Methods:** GET, POST, PATCH, DELETE
- **Allowed headers:** Content-Type, X-CSRF-Token, X-Correlation-ID
- **Max age:** 86400 (24h preflight cache)

### D180 — Webhook signature verification (derived)

- **Paddle webhooks:** verify HMAC-SHA256 signature with shared secret
- **Razorpay webhooks:** verify HMAC-SHA256 signature with shared secret
- **Gmail Pub/Sub:** verify Google-signed JWT in `Authorization` header
  (`x-goog-authenticated-user-email` claim + signature against Google's JWKS)
- All failed signature verifications logged as security events
  (D181 security_events table)

### D181 — Security events log (distinct from Activity log)

New table `security_events` for security-relevant events that *shouldn't*
appear in user-facing Activity log:
- Login attempts (success + failure)
- Role/permission changes
- Webhook signature verification failures
- Suspicious rate-limit breaches
- CSP violation reports (via `Report-To`)
- KMS access errors
- Failed OAuth refresh attempts

Schema:
```
security_events (
  id uuid pk,
  workspace_id uuid nullable,
  user_id uuid nullable,
  event_type text,
  severity text (info/warning/critical),
  source_ip inet,
  user_agent text,
  payload jsonb,
  occurred_at timestamptz,
  reviewed_at timestamptz nullable,
  reviewed_by_user_id uuid nullable
)
```

Indexed (occurred_at DESC), (severity, occurred_at DESC).

---

## Phase 4 / Topic 31 — Test strategy

### D182 — Test framework stack: **Vitest + testcontainers + Playwright**

- **Unit tests:** Vitest (faster, ESM-native, TypeScript-first; eclipses Jest)
- **Integration tests:** Vitest + testcontainers (real Postgres in Docker)
- **E2E tests:** Playwright (modern winner over Cypress)

### D183 — Gmail mock strategy: **MockGmailProvider + recorded fixtures + staging real Gmail**

Three-layer approach:
1. **Unit tests:** hand-written `MockGmailProvider` implementing `MailProviderAdapter`
2. **Integration tests:** recorded fixtures from real Gmail (sanitized) via `nock-record` or `polly.js` — replayed deterministically
3. **Staging E2E:** real Gmail test account, manual + scheduled smoke tests

### D184 — Coverage strategy: **Risk-weighted with 70% floor on `packages/shared` + `packages/db`**

No uniform percentage targets. *Risk-weighted*: every load-bearing module
has tests for happy path + 3 critical edge cases.

Load-bearing modules (require thorough testing):
- Action lifecycle (D9, D20, D34, D58)
- Recommendation engine (D21)
- Sync workers (D8, D157)
- Auth + sessions (D155)
- Billing (D117)

CI gate: `packages/shared` + `packages/db` must maintain ≥70% line coverage.
UI components covered by E2E. Marketing pages: smoke tests only.

### D185 — Visual regression: **Skip at launch**

Reason: most teams that try Playwright screenshot diffing abandon within 6
months due to false positives (font rendering, timing variance). Replace with
E2E tests that assert key visual elements exist and are readable.

Re-evaluate at user-feedback-driven cadence: if real visual regressions
escape to production, invest in Chromatic ($149/mo) or Percy at that point.

---

## Phase 4 / Topic 32 — CLAUDE.md content

### D186 — CLAUDE.md content: **DEFERRED pending community references**

User to provide sample CLAUDE.md files from the community that have
worked for similar projects. Draft below is the working baseline;
will be revised after community references reviewed.

**Working draft baseline:**

```markdown
# DeclutrMail V2 — Claude Rules

DeclutrMail is a premium sender-level control plane for Gmail.
Users make one decision per sender (Keep / Archive / Unsubscribe /
Decide-later); we enforce it safely with Activity audit + Undo +
privacy posture.

**Plan reference:** `/Users/chintant/.claude/plans/i-want-you-to-smooth-kahn.md`
(185+ numbered decisions; cite as `(D24)` in PR descriptions.)

**Longer docs:** `/docs/{product,architecture,backend,frontend,operations,execution}/`

## Non-negotiable product rules
[... list of rules with D-decision citations]

## Non-negotiable architecture rules
[... list of rules with D-decision citations]

## Non-negotiable privacy/security rules
[... list of rules with D-decision citations]

## Stack reference
[... stack with D-decision citations]

## Workflow rules
[... rules]

## Verification commands
[... bash commands]

## Critical files to read first
[... list of files]
```

**Action items captured:**
- Community CLAUDE.md references to gather (user-supplied)
- Specific working examples to inspect: Linear, Vercel, internal Anthropic
  patterns, agent-friendly OSS projects
- Re-brainstorm CLAUDE.md content once references in hand
- Lock final version before any feature PRs ship

---

# Phase 4 / Codex Grill Response — Patches + Additions

**Context (2026-05-18):** External grill from Codex on the in-flight plan
surfaced (a) concrete spec contradictions that would cause Claude agents
to implement wrong things, (b) safety symmetry gaps where rules in one
decision weren't applied to comparable ones, and (c) one structural
meta-gap (no explicit scope-freeze / anti-redesign rule). Spec-drift items
are patched **inline** at their original D-decisions (search the file for
`[CODEX PATCH]` to audit each). Structural changes get **new D-numbers**
following the existing convention (the D121-replaces-D113 pattern).

**Inline patches applied** (5):
- D19 — Stripe product list marked superseded by D117 + D126
- D61 — Brief email provider narrowed to Resend (was "SendGrid/Resend")
- D117 — Pro annual price $190 → $149 (aligns with D126); `trialing`
  removed from `subscriptions.status` enum (aligns with D121)
- D126 — "Stripe" reference removed from Part 4 implementation note

**New decisions (9):** D187 (anti-redesign), D188 (launch flags), D189
(weekly value receipt), D190 (Quiet Preview Mode), D191 (sync gate kill
metric), D192 (custom builder deferred), D193 (API min_instances=1),
D194 (Screener marketing rule), D195 (worker scaling decoupled from
billing webhook).

---

### D187 — Anti-redesign / scope-freeze rule (addresses Codex meta-gap)

After **PR 3** lands, the following are **frozen** until private beta
opens:

- Typography stack (Geist Sans + Geist Mono, D1)
- Color palette (D2)
- Button system + form-control sizing
- Spacing scale + grid
- Screen IA (which screens exist, top-level navigation order)

**Escape hatches** (any one is sufficient to justify a change):

1. A documented beta-user blocker (linked PostHog event or support ticket).
2. A 1-paragraph waiver in the PR description citing the specific
   D-decision being adjusted and why (e.g., *"D2's deep teal `#006B5F`
   fails WCAG AA on button hover — adjusting to `#00564D` per
   accessibility audit"*).
3. An ADR documenting a deliberate decision reversal.

**What this protects against:** the "let me just adjust the spacing"
spiral that turns a 6-month build into a 12-month build. Codex called
this out directly: *"you like polishing… without this rule, Claude will
help you endlessly perfect the product and never launch."*

**What this does NOT freeze:**
- Copy iteration (microcopy, headlines, error messages)
- Bug fixes that incidentally touch styling
- Adding new screens approved in subsequent D-decisions
- Accessibility fixes (always allowed)

**Enforcement:**
- PR template (per Codex Doc 09 §13) gets a checkbox: *"☐ This PR does
  not touch frozen design tokens (D187), OR I have included a 1-paragraph
  waiver below."*
- Hook `require-pr-template.sh` (Topic 34 — deferred) verifies the
  checkbox exists.
- Subagent "Design System Agent" (Topic 33 — deferred) refuses to merge
  PRs touching `packages/shared/tokens/` without a waiver after PR 3.

**Sunset:** Rule lifts automatically when private beta opens. Public
launch reinstates a softer version (changes need ADR but no PR-level
waiver).

---

### D188 — Launch feature flags for advanced surfaces

**Brief**, **Snoozed**, **Followups**, and **Quiet Mode** ship at V2
launch (D3 stands) but behind **workspace-level launch flags** — distinct
from Pro/Free tier gating (D19/D77/D83/D89/D98 still apply).

**Flag keys at launch:**

| Flag key | Default | Disable means |
|---|---|---|
| `brief_enabled` | true | Sidebar entry removed; `/brief` 404s |
| `snoozed_enabled` | true | Sidebar entry removed; Snooze action hidden from overflow menus |
| `followups_enabled` | true | Sidebar entry removed; `/followups` 404s |
| `quiet_mode_enabled` | true | Sidebar entry removed; Quiet schedule UI hidden in Settings |

**Schema:**
```
feature_flags (
  id uuid pk,
  flag_key text unique,
  default_state bool,
  workspace_overrides jsonb default '{}',  -- { "<workspace_id>": bool }
  rollout_percentage int default 100,       -- 0-100 for gradual rollout
  updated_at timestamptz,
  updated_by_user_id uuid
)
```

**Resolution order per request:**

1. If `workspace_overrides` has the workspace, use that value.
2. Else if `rollout_percentage < 100`, hash `workspace_id` and compare.
3. Else use `default_state`.

Redis-cached, 60s TTL. Cache-buster on flag updates.

**Behavior when disabled:**

- API: routes return `feature_disabled` response code (not 402 Pro upsell,
  not 404). Frontend treats as "feature doesn't exist."
- UI: sidebar entries removed, Settings tabs hidden, related routes 404.
- **This is not a Pro upsell state** — disabled means "not available,"
  not "upgrade to unlock." Pro gating is a separate layer.

**Use cases:**

1. **Disable per cohort during private beta** if a feature shows poor
   activation (<25% of Pro users engaging in 30 days).
2. **Gradual rollout** if a feature ships with known issues — start at
   `rollout_percentage = 10`, ramp to 100 over a week.
3. **Emergency kill switch** if a feature causes an incident.

**Operational:**

- Admin-only UI at `/admin/feature-flags` to toggle.
- Every flag change logged to `security_events` (D181) for audit.
- Subagent "Observability Agent" (Topic 33 — deferred) gets read access
  to flag state for incident postmortems.

**Relationship to D125 cut criteria:**

This is the **interim lever**. D125's 60-day cut decision is the
**permanent lever**. A flag-disabled feature can be re-enabled after
iteration; a D125-cut feature has 6-week deprecation notice and code
removal.

**Note on Custom Autopilot rule builder:** Initially planned to ship with
launch per D99. Per **D192** below, the custom builder is deferred to
V2.1 entirely and does not need a launch flag — the *presets-only*
surface ships at launch.

---

### D189 — Weekly Value Receipt (retention Part 6, adds to D126)

Pro-only weekly artifact delivered **Sundays at 6pm user-local time**
(one hour before Monday's Triage queue refresh per D27). Two surfaces:

- **In-app card** pinned to top of Triage screen for 24h after
  generation (dismissible).
- **Optional email digest** (Settings → Notifications → "Send weekly
  value receipt by email"; default **off**).

**Receipt content (plain-text, calm tone):**

```
This week DeclutrMail:
- 184 low-value emails kept out of your inbox
- 6 important senders surfaced in your Brief
- 12 messages held during Quiet Hours
- ~38 minutes saved on triage
- 0 irreversible changes without confirmation
```

**Computation** (from past 7 days, scoped to the user's mailbox accounts):

- **"kept out"**: `count(action_operation_items WHERE source IN
  ('autopilot', 'preset_rule', 'screener_auto') AND occurred_at >=
  now() - interval '7 days')` plus `count(quiet_held_messages WHERE
  held_during_week)`.
- **"important surfaced"**: `count(brief_runs.brief_payload.reply +
  brief_runs.brief_payload.fyi WHERE week)` scoped to VIPs + reply-
  needed senders.
- **"Quiet held"**: `sum(quiet_release_events.message_count WHERE week)`.
- **"minutes saved"**: `(triage_decisions × 30s) + (autopilot_actions ×
  5s)` rounded to nearest minute.
- **"irreversible without confirmation"**: hard-coded `0`. **Load-bearing
  trust line.** If this ever flips to nonzero, ship a hotfix the same day
  and email affected users.

**Schema:**
```
weekly_value_receipts (
  id uuid pk,
  user_id uuid fk,
  week_starting date,
  payload jsonb,
  in_app_viewed_at timestamptz nullable,
  email_sent_at timestamptz nullable,
  generated_at timestamptz,
  unique (user_id, week_starting)
)
```

**Worker:** `WeeklyValueReceiptWorker` runs Sundays 6pm user-local
timezone — same cron pattern as `MorningBriefWorker` (D40 family).

**Empty state:** If all 5 numbers are zero (new user, dormant account),
**suppress the receipt entirely** — don't generate, don't send. Sending
"you did nothing this week" is worse than silence.

**Why this matters (Codex):** D126's retention strategy is "come back and
clean more" — necessary but not sufficient. Subscriptions justify
themselves when users see **what they got** without being asked. The
receipt is the subscription justification — *"DeclutrMail protected you
this week"* — not *"come back and use DeclutrMail."*

**Free/Plus tier:** No weekly receipt. (D19 placed Brief behind Pro; this
follows the same pattern. Free users have nothing to brag about anyway —
the engine isn't acting on their behalf.)

---

### D190 — Quiet Mode Preview Mode (updates D92, D93)

**Updates D92 + D93.** First time a user enables Quiet Mode (manually or
via schedule), Quiet runs in **Preview Mode** for 7 days before holding
any messages.

**Preview Mode behavior:**

- Quiet schedule activates (recorded in `quiet_state`).
- Messages arrive in INBOX normally — **nothing is held**.
- A counter logs which messages **would have been held** with reason
  (sender_key, subject_hash, received_at, would_hold_reason: e.g.,
  "non-VIP and no recent reply").
- Quiet screen shows banner during the window: *"Preview mode · 23
  messages would have been held this week · 6 days remaining"*.
- After 7 days (or earlier if user clicks "Review now"), in-app prompt:
  *"Quiet would have held 23 messages over the past week. Here are 8
  examples. Activate Quiet?"* with sample senders + subjects.
- User **confirms** → Quiet activates fully going forward.
- User **cancels** → Quiet disables; can re-enable later (re-triggers
  Preview).

**Schema additions:**

- `mailbox_accounts.quiet_state` jsonb extended:
  `{ enabled, started_at, until_at, source, preview_mode_until }`.
  `preview_mode_until = null` after user confirmation.
- New table `quiet_preview_log`:
  ```
  id uuid pk,
  mailbox_account_id uuid fk,
  sender_key text,
  message_count int,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  would_hold_reason text,
  example_subjects text[] -- max 3, truncated to 80 chars each
  ```

**Worker behavior change:** `QuietHoldWorker` (D93) checks
`preview_mode_until` — if active, logs to `quiet_preview_log` instead of
moving the message to Held label. After confirmation, normal Held
behavior resumes immediately.

**Re-enable behavior:** If user disables Quiet and re-enables later, they
get Preview Mode again. Cheap insurance; user can skip Preview if they're
confidently returning after a known break (e.g., laptop reset) via a
"Skip preview, I'm sure" button on the enable-Quiet flow.

**Why this matters (Codex):** Quiet Mode can accidentally hold critical
messages from schools, clinics, recruiters, banks, delivery issues,
immigration offices, urgent family logistics. The "active correspondent
in last 30 days" rule (D93) is **not enough protection** by itself. This
applies the D10 Autopilot Observe pattern to Quiet Mode for the same
trust reason: **high-impact automation needs a verifiable preview before
action.**

**Brief interaction (D97):** During Preview Mode, Brief still surfaces
the "would-have-held" senders normally — Preview doesn't suppress them
from Brief, since nothing is actually being held.

---

### D191 — Sync gate kill metric (updates D6)

**Updates D6.** Makes D6's "strict gate everywhere" decision falsifiable.

**Tracked metric (PostHog funnel):**

```
oauth_completed → sync_completed → first_action_taken
```

Where `first_action_taken` = first non-onboarding action in `activity_log`
within 24h of `sync_completed`.

**Kill threshold:** Rolling 30-day window during private beta and first
60 days post-launch:

> If `count(first_action_taken within 24h of sync_completed) /
> count(oauth_completed) < 65%`, switch from strict gate to **tiered
> gate**.

**Tiered gate behavior** (the D6 alternative originally rejected):

- Top 50 senders by `noise_score DESC` unlock at 5,000 messages indexed
  (~2-5 minutes for most mailboxes).
- Rest of senders + Activity + Settings unlock at full sync completion.
- Onboarding Step 3 (D109) copy adjusts to: *"Your top senders are ready.
  We're still working on the rest — you can start triaging now."*

**Decision-maker:** Founder reviews metric in PostHog weekly during
private beta. If threshold breached, opens a feature-flag toggle
(`tiered_sync_gate_enabled`, per D188 pattern) that switches Onboarding
Step 3 + sync worker behavior to tiered mode.

**Plan-B if tiered mode also underperforms:** If tiered gate enables and
`first-50-sender activation rate < 70%`, escalate to founder review for
further iteration (e.g., unlock everything at 1k messages indexed, or
allow users to click-through the gate with a "show partial inbox" link).

**Why this matters (Codex):** D6 was a faith-based "trust > activation"
decision. Without a kill metric, the gate would never get unrolled even
if it's demonstrably cratering activation. With this, the gate is
**falsifiable** — and the alternative is already pre-specced so the
switch is mechanical, not architectural.

---

### D192 — Custom Autopilot rule builder deferred to V2.1 (updates D99, D103)

**⚠️ REVERSED BY D196 (2026-05-18).** This decision is superseded — the
custom rule builder is now built at launch but hidden behind launch flag
`custom_autopilot_builder_enabled` (default `false`). Content below
retained for audit / rationale reference. See "Post-Grill Reversals"
section at end of file for the current decision.

**Updates D99 + D103.** At V2 launch, Autopilot ships with:

- **5 preset rules** (per D101 + D124 — auto-archive low-engagement,
  auto-unsubscribe noisy, auto-screen new, newsletter graveyard,
  long-dormant unsubscribe)
- **Threshold sliders** on confidence-based presets
- **Observe mode** (D10)
- **Dry-run preview** on presets ("If active now, this would have
  affected X senders, Y messages over the last 30 days")
- **Per-inbox scope toggle** (D102)
- **Master pause** (D105)

**Deferred to V2.1:**

- Condition-chip builder UI (D103's "Linear/Notion-quality chips")
- Custom rule creation (the full builder form)
- AND/OR multi-condition logic
- Trigger selector (on-new-message / nightly / one-time)
- 12-field condition vocabulary surface (D100 — schema stays, UI
  deferred)

**Rationale (Codex):** D103 is "a whole product inside the product."
Build cost was 2-3 weeks of dedicated PR work for the custom builder
alone. Power users will surface demand; defer until proven needed.

**V2.1 unlock criteria** (either is sufficient):

- ≥20 distinct beta or paid users request custom rules via support
  ticket or feedback widget within a 30-day rolling window, OR
- A specific use case keeps appearing in user research (e.g., "I want
  rules per Gmail label") in ≥3 user interviews.

**Schema retention:** `automation_rules.is_preset bool default true` —
schema is forward-compatible with custom rules. The 12 condition fields
from D100 are stored in `automation_rules.conditions jsonb`. Presets
write static conditions to this column; custom rules will eventually
write dynamic conditions. **No schema work required for V2.1 unlock —
only UI.**

**Marketing copy implication:**

- ❌ Don't claim: *"Build any rule you want."*
- ✅ Do claim: *"5 thoughtful presets that cover the common cases."*
- ✅ Do claim: *"Custom rules are coming — we're starting with the
  patterns we know work."*

**Affects:** PR 16-A (presets) ships at launch. PR 16-B (custom builder)
is removed from the launch roadmap entirely and re-scoped for V2.1.

---

### D193 — API service min_instances=1 from launch (updates D158, D161)

**Updates D158 + D161.** API Cloud Run service ships with `min_instances=1`
**from day 1** — not zero, not "flipped after first paying customer."

**Rationale:** D150's <200ms p95 SLO and D158's `min_instances=0` with
"cold start <2s acceptable" **contradict each other**. For a premium-
positioned product where trust UX depends on actions feeling instant,
paying ~$25-40/mo for warm API instances is the right call from launch.

**What stays:**

- Worker service `min_instances=1` (D158 — correct, unchanged).
- All other D158 hosting decisions (Vercel Pro, Cloud SQL regional HA
  pre-launch, Upstash Redis, GCP KMS).

**What changes:**

- API service config: `min_instances=1` from launch (was `0` per D158).
- D161's worker `min_instances` flip-via-webhook mechanism is
  **superseded by D195** (decoupling from billing webhook).

**Cost impact:**

| Phase | D158 estimate | D193-revised estimate |
|---|---|---|
| Dev phase (months 1-6) | ~$70-100/mo | ~$110-140/mo |
| Pre-launch upgrade | ~$220-320/mo | ~$240-340/mo |
| Soft launch (100-500 users) | ~$250-350/mo | ~$270-370/mo |
| Target ($20k MRR, 1k users) | ~$700-900/mo | ~$720-920/mo |

Gross margin at target stays ~91%.

**Why not stay at min_instances=0 for dev:** The 200ms SLO is the
**premium positioning promise**. Compromising it for $30/mo during dev
means the team (founder + Claude agents) internalizes "cold starts are
acceptable" — a habit hard to undo at launch. Better to feel the
production-real perf characteristics throughout dev.

**Implementation note:** Update Cloud Run terraform / `service.yaml`
manifest now; no webhook coupling, no conditional logic. One config
constant.

---

### D194 — Screener marketing-copy hard rule (lifts D72 rationale into enforceable rule)

**Lifts D72 rationale into a hard rule** for all marketing copy
(landing page, methodology, comparison pages, AEO answers, blog posts,
social media).

**Rule:** Never claim Screener "keeps unknown senders out of your inbox."
This is technically false — Screener uses soft quarantine (D72): Gmail
inbox is untouched until user decides.

**Approved framings:**

- ✅ *"New senders are collected for review — nothing moves until you decide."*
- ✅ *"We catch new senders so you can decide in a batch."*
- ✅ *"Unknown senders are flagged for your review. They still arrive in
  your inbox until you handle them."*
- ✅ *"A queue of new senders, ready when you are."*

**Forbidden framings:**

- ❌ *"Unknown senders won't surprise you."*
- ❌ *"Screener blocks new senders from reaching you."*
- ❌ *"Mystery senders go to quarantine, not your inbox."*
- ❌ *"DeclutrMail intercepts new senders before they bother you."*
- ❌ *"Auto-filter unknown senders out of sight."*

**Enforcement:**

- CLAUDE.md (Topic 32, deferred D186) gets this rule in the
  "Non-negotiable marketing rules" section.
- Verification command added to CLAUDE.md verification list:
  ```bash
  ./scripts/check-screener-copy.sh
  # greps apps/web/src/app/(marketing)/**/*.{tsx,md,mdx} for forbidden
  # phrasings (case-insensitive) and exits non-zero if any match.
  ```
- Subagent "Docs Agent" / "SEO Agent" (Topic 33, deferred) refuses to
  publish marketing pages without running the check.

**Why this matters (Codex):** A marketing claim that contradicts product
behavior is a **broken promise** the first time a user experiences it.
Trust collapses faster than it builds. The plan already had this honesty
discipline in D72's rationale — D194 just makes it enforceable.

---

### D195 — Worker scaling decoupled from billing webhook (updates D161)

**Updates D161.** Remove the auto-flip mechanism where Paddle/Razorpay
billing webhooks call `gcloud run services update` to change worker
`min_instances`.

**Replaced with:**

- **Pre-launch checklist item** (Phase 5, Topic 36 — deferred): one week
  before public launch, founder runs:
  ```bash
  gcloud run services update declutrmail-worker \
    --min-instances=1 \
    --region=us-central1
  ```
- **Stored as:** Terraform variable (`worker_min_instances`) in the
  infra repo, OR documented runbook in `/docs/runbooks/scaling.md`.
- **Validation:** Verified during launch readiness checklist by checking
  Cloud Run console + sending a synthetic Pub/Sub test message and
  measuring end-to-end latency.

**Rationale (Codex):** Billing webhooks should update **billing state**,
not **infrastructure config**. The coupling in D161 was clever but
fragile:

- Hard to test (you'd need a real Paddle/Razorpay webhook firing in CI).
- Weird error paths (what if `gcloud` call fails after billing state
  update succeeds?).
- Mixes concerns across two operational domains.
- One more thing to debug at 3am during an incident.

The ~$95/mo savings during 6-month dev phase ($570 total) is not worth
the architectural coupling cost.

**Emergency lever:** If first-paying-customer arrives earlier than
expected (pre-launch checklist hasn't run yet), founder can manually
flip in <2 minutes via `gcloud` CLI. The exact command above is
copy-paste ready and documented in `/docs/runbooks/scaling.md`.

**Schema impact:** None. Removes the webhook handler code path that
called `gcloud` from `BillingWebhookController`. Webhook now does only:

1. Verify HMAC signature (D180).
2. Idempotency check via `billing_webhook_events` dedupe table.
3. Update `subscriptions` row + `feature_flags` if needed.
4. Emit analytics event to PostHog.
5. Acknowledge to provider.

**Cost trajectory updated** (combined with D193):

| Phase | Cost |
|---|---|
| Dev phase (months 1-6) | ~$110-140/mo (worker `min_instances=1` from day 1 too) |
| Pre-launch upgrade (Cloud SQL regional HA flip) | ~$240-340/mo |
| Soft launch | ~$270-370/mo |
| Target | ~$720-920/mo |

The dev-phase increase is ~$40/mo over D161's projection — paid for by
the user's side income with negligible impact.

---

# 📋 Codex Grill Response COMPLETE

**5 inline patches** (D19, D61, D117 prices, D117 trial enum, D126
Stripe) + **9 new decisions** (D187–D195) addressing:

- **Meta-gap:** Anti-scope-creep / design freeze rule (D187)
- **Lever:** Launch-flag rollback levers for advanced surfaces (D188)
- **Retention:** Proactive value receipt surface (D189)
- **Safety:** Quiet Mode preview symmetry with Autopilot Observe (D190)
- **Falsifiability:** Sync gate kill metric (D191)
- **Scope:** Custom rule builder deferred to V2.1 (D192)
- **Latency:** API warm instances from launch (D193)
- **Honesty:** Screener marketing-copy hard rule (D194)
- **Architecture:** Billing/infra decoupling (D195)

**Plan file decision count:** **195 numbered decisions** + 5 inline
patches across 4 phases.

**What Codex's grill did NOT resolve:**

- Topic 32 — CLAUDE.md content (D186 still deferred pending community
  references)
- Topic 33 — 12 subagent definitions (NOT STARTED)
- Topic 34 — 8 hook scripts (NOT STARTED — D187's `require-pr-template.sh`
  and D194's `check-screener-copy.sh` are now load-bearing hooks)
- Topic 35 — 7 skill definitions (NOT STARTED)
- Phase 5 — GTM (Topics 36, 37, 38, NOT STARTED)

**Decisions worth re-grilling later:**

- D193's $25-40/mo extra cost vs. cold-start tolerance (revisit if dev
  velocity suffers)
- D188 default-state choices (4 of 5 flags are `true`; only
  `custom_autopilot_builder_enabled` is `false` per D197 — revisit if
  private beta wants tighter control across the rest)
- D197 V2.1 unlock criteria for custom rule builder UI (≥20 user
  requests OR ≥3 user research mentions — may need adjustment based on
  actual demand signal patterns)
- D197 architectural readiness verification (whether the "Architecture
  Guardian subagent + golden test" enforcement is sufficient to prevent
  preset-specific drift, or whether deeper test coverage is needed)

---

# Post-Grill Reversals

Decisions in this section modify earlier decisions based on **founder
reflection after** the Codex grill response — distinct from the grill
response itself. D187–D195 were responses to Codex's critique; D196+ are
subsequent reasoning that adjusts those responses.

---

### D196 — Custom Autopilot rule builder: build at launch, ship flag-disabled (reverses D192)

**⚠️ REVERSED BY D197 (2026-05-18).** This decision is superseded — the
custom builder UI is no longer built at launch. Instead, the UI is
deferred to V2.1 but the schema/API/engine/design-system are made fully
ready at launch so V2.1 is a UI-only build, not a refactor. Content
below retained for audit. See D197 for the current decision.

**Reverses D192.** The full custom rule builder UX per D103 (Linear/
Notion-style condition chips, trigger selector, AND/OR logic, dry-run
preview, mode selector, scope toggle) **ships at V2 launch** — but
hidden behind launch flag `custom_autopilot_builder_enabled` with
default state **`false`**.

**Pattern: "Build it, hide it."** Trades calendar time (~2-3 weeks of
build cost reinstated) for **optionality** — the moment beta demand
surfaces, the flag flips and the feature is live without a code-deploy
delay or a 2-3 week build lag.

**Updated D188 flag table:**

| Flag key | Default | Disable means |
|---|---|---|
| `brief_enabled` | true | (per D188) |
| `snoozed_enabled` | true | (per D188) |
| `followups_enabled` | true | (per D188) |
| `quiet_mode_enabled` | true | (per D188) |
| **`custom_autopilot_builder_enabled`** | **false** | "+ New custom rule" button hidden in Autopilot screen; `/autopilot/custom/*` routes 404; only 5 presets visible |

This is the **first launch flag with `default_state = false`** in D188's
system. The `feature_flags` schema already supports `false` defaults; no
schema change needed.

**Behavior when disabled (default at launch — all users):**

- Autopilot screen shows the 5 presets (D101 + D124) + master pause +
  Observe-mode UI for preset rules only.
- "+ New custom rule" CTA hidden entirely (not greyed, not "Pro" — gone).
- `/autopilot/custom/new` and `/autopilot/rules/:id/edit` (for custom
  rules) return 404.
- API endpoints for custom rule create/update return `feature_disabled`
  per D188's pattern.
- Settings → Autopilot section reflects presets-only mode.

**Behavior when enabled (founder-only or per-cohort during private beta):**

- Full D103 condition-chip builder surfaces.
- 12-field condition vocabulary (D100) accessible via chips.
- Trigger selector (on-new-message / nightly / one-time) functional.
- AND/OR multi-condition logic functional.
- Dry-run preview ("If active now, would have affected X senders, Y
  messages over last 30 days") functional.
- Per-inbox scope toggle works identically to presets.
- Custom rules participate in D10 Observe mode (7-day Observe window
  before active execution).

**Schema:** No change beyond what D192 already preserved.
`automation_rules.conditions jsonb` was already forward-compatible.
`automation_rules.is_preset bool default true` distinguishes preset rows
from custom rows. Custom rules write `is_preset = false` with full
condition payload.

**Enable criteria — when to flip the flag for individual users:**

- **Cohort-level enable during private beta:** Enable for any user who
  requests custom rules via support OR who clicks a "Get notified when
  custom rules are available" CTA on the presets-only Autopilot screen
  (small unobtrusive link, not a banner).
- **Founder/internal enable from day 1:** `@declutrmail.com` emails always
  see the builder (gated via devPreference per D111).

**Enable criteria — when to flip `default_state` from `false` to `true`
(global enable):**

- ≥20 enabled users have each created ≥1 custom rule, AND
- None of those rules produce ≥5% false-positive action rate (measured
  against undo events within 24h of rule firing), AND
- ≥30 calendar days of clean operational data after the 20th enabled user

These criteria adapt D192's original V2.1 unlock thresholds, recast as a
flag-flip rather than a code-ship event.

**Timeline impact:**

- D192's deferral saved ~2-3 weeks of build time.
- D196 reinstates that build time. Custom builder is now scoped into
  PR 16-B (per D192's original split) shipping at launch behind the flag.
- D149's launch target shifts from Nov-Dec 2026 to **~mid-Dec 2026 to
  mid-Jan 2027** — a deliberate trade of calendar time for optionality.
- Build sequencing: PR 16-A (presets) ships first; PR 16-B (custom
  builder behind flag) ships before private beta opens.

**Risk acknowledged — sunk-cost trap:**

Once built, psychological pressure to flip the flag even without demand
is real. Mitigations:

1. **Founder commits in writing here:** The flag stays at `false` by
   default until the enable criteria above are met. No "let me just
   enable it for everyone to see how it does" allowed.
2. **Observability check:** Subagent "Observability Agent" (Topic 33 —
   deferred) reports weekly during private beta: *"Custom rule builder
   still disabled. N users on waitlist. M founder-enabled users have
   created K rules with X% false-positive rate."* — surfaces the
   discipline question passively without nagging.
3. **Anti-creep clause:** If at Day 60 of private beta the waitlist has
   ≥5 users but criteria aren't met, run a user-research session with
   those users before considering flip — don't flip for vanity demand.

**Marketing copy implications (updates D192's note):**

- ❌ Still don't claim: *"Build any rule you want."* (matches D192)
- ✅ Do claim: *"5 thoughtful presets that cover the common cases."*
- ✅ Do claim (new): *"Custom rules available on request during beta."*
  This signals optionality without overpromising — power users
  understand "available on request" means "we'll flip it for you."

**Affects:**

- PR 16-A (presets) ships at launch — unchanged from D192.
- **PR 16-B (custom builder) reinstated to launch roadmap, ships behind
  flag at launch** — was deferred entirely under D192.
- `/pricing` and Autopilot landing-section marketing copy notes
  presets-only by default with custom-rules-on-request CTA.
- D187 design freeze applies: once PR 16-B lands, the builder's UI is
  frozen unless a beta-user blocker surfaces or a 1-paragraph waiver is
  documented.

**Why reverse D192:**

D192's discipline (defer until demand proves it) preserved 2-3 weeks of
calendar time at the cost of being unable to respond to demand the
instant it surfaces. With Claude OS investment producing ~50% velocity
gains (D149), 2-3 weeks of additional build is absorbable. Optionality
to enable custom rules mid-beta — for a specific power user, for a
cohort, or globally — is worth more than 2-3 weeks of calendar shifted.

The discipline that mattered (don't ship to general users until proven)
is preserved by the `false` default and the enable criteria. What
changes is **where the discipline lives** — in the flag state, not in
the absence of code.

---

### D197 — Custom rule builder UI deferred to V2.1, with full architectural readiness at launch (reverses D196, refines D192)

**Reverses D196** (which built the UI at launch behind a flag).
**Refines D192** (which deferred entirely) by adding **explicit
architectural readiness requirements** that were implicit at best.

**Decision:** The custom rule builder **UI is deferred to V2.1** — but
the schema, API, rule engine, design-system primitives, and UI route
layout **must be fully ready to accept custom rules at V2 launch**, so
that shipping V2.1 is purely a UI build, not a refactor.

**The principle:** *"Defer the feature, not the architecture."* Build
the system for the general case (preset rules + custom rules), even
when only the special case (preset rules) ships externally.

**Why this is better than either prior position:**

| Approach | Build cost | V2.1 unlock cost | Forward-compat guarantee |
|---|---|---|---|
| D192 (defer entirely) | +0 weeks | ~2-3 weeks UI + potential refactor risk | Implicit, not enforced |
| D196 (build behind flag) | +2-3 weeks | ~0 weeks (flag flip) | Fully built, paid for upfront |
| **D197 (defer UI, build architecture)** | **+0.5-1 week** | **~2-3 weeks UI, zero refactor** | **Explicit, enforced** |

D197 pays a small architecture tax now to lock in the V2.1 unlock as a
UI-only project — no schema migration, no API refactor, no engine
rewrite. The optionality D196 was buying with 2-3 weeks of UI work is
mostly captured by 0.5-1 week of architectural discipline.

---

**Architectural readiness requirements — must be satisfied at V2 launch:**

**1. Database schema (covered by D192's note, made explicit here):**

```sql
automation_rules (
  id uuid pk,
  workspace_id uuid fk,
  mailbox_account_id uuid fk nullable,    -- null = scope=all_accounts
  name text,
  scope text,                              -- account / all_accounts / workspace
  mode text default 'observe',             -- observe / active / paused (D10)
  trigger_type text,                       -- on_new_message / nightly / one_time
  conditions jsonb,                        -- full 12-field vocabulary (D100)
  action jsonb,                            -- {type, parameters}
  is_preset bool default true,             -- D196 added; D197 keeps
  preset_key text nullable,                -- e.g., 'auto_archive_low_engagement' for presets; NULL for custom
  enabled bool default true,
  activated_at timestamptz,
  last_run_at timestamptz,
  created_at, updated_at
)
```

`conditions jsonb` shape supports the full 12-field vocabulary from
D100 (sender email/domain, Gmail category, read rate, monthly volume,
spike ratio, last seen, sender age, has unsubscribe header, has reply
history, engine verdict, engine confidence + 1 reserved). Validated
against a Zod schema in `packages/shared/schemas/automation-rules.ts`.

**Migration test:** A custom rule row inserted via direct SQL with
fully-populated `conditions` jsonb must round-trip through the API's
serialization layer cleanly. Test lives in
`packages/db/__tests__/automation-rules-schema.test.ts`.

**2. API endpoints (must be implemented and tested at launch):**

| Endpoint | Behavior at launch |
|---|---|
| `GET /api/v1/autopilot/rules` | Lists all rules for workspace. Returns both preset + custom (custom returns empty array initially). |
| `GET /api/v1/autopilot/rules/:id` | Single rule by id. |
| `POST /api/v1/autopilot/rules` | Creates rule. Validates against Zod schema. Returns 403 (`feature_disabled`) if `custom_autopilot_builder_enabled = false` AND user is not founder/devPreference. Founder can create custom rules from day 1 via Postman/devPreference. |
| `PATCH /api/v1/autopilot/rules/:id` | Updates. Same flag gating as POST. |
| `DELETE /api/v1/autopilot/rules/:id` | Deletes. Same flag gating. |
| `POST /api/v1/autopilot/rules/preview` | Dry-run preview (used by presets at launch + by custom builder later). Accepts a rule shape, returns matched senders/messages count. **Always available at launch** because presets need it. |

All endpoints accept and validate the **full Zod schema** for both
preset and custom rule shapes — there is no "preset-only" validation
schema.

**3. Rule engine (must be implemented at launch):**

- `RuleEvaluationWorker` reads `automation_rules.conditions` jsonb and
  applies generically, **regardless of `is_preset` value.**
- Preset rules are seeded into the database at workspace creation time
  via a migration/seed script that writes hardcoded conditions to the
  same `conditions` column. **No special-case "preset evaluator" code
  path.**
- The 5 launch presets (D101 + D124) are stored as rows in
  `automation_rules` with `is_preset = true, preset_key = '...'`.
- Adding a custom rule = inserting a row with `is_preset = false` and
  user-supplied `conditions`. Engine behavior is identical.
- D10 Observe mode infrastructure works uniformly: `mode = 'observe'`
  routes matches to `pending_autopilot_suggestion` regardless of
  preset-ness.

**Forbidden pattern (Architecture Guardian rejects):**

```typescript
// ❌ NOT ALLOWED — preset-specific branching
if (rule.preset_key === 'auto_archive_low_engagement') {
  // hardcoded logic
} else if (rule.preset_key === 'newsletter_graveyard') {
  // ...
}
```

**Required pattern:**

```typescript
// ✅ ALLOWED — uniform evaluation
const matches = evaluateConditions(rule.conditions, senderContext);
if (matches) emitAction(rule.action, senderContext);
```

**4. Design system primitives (must be built at launch):**

These primitives are built once and consumed by **multiple features at
launch**, plus the future custom builder:

| Primitive | Lives in | Used at launch by |
|---|---|---|
| `<ConditionChip />` | `packages/shared/components/condition-chip.tsx` | Senders D51 advanced filters drawer, Activity D56 filter drawer |
| `<FieldOperatorValue />` triple-select | `packages/shared/components/field-op-value.tsx` | Senders D51, Activity D56 |
| `<DragReorderList />` | `packages/shared/components/drag-reorder.tsx` | Notification settings reordering, Pinned-senders list (Settings) |
| `<TriggerSelector />` dropdown | `packages/shared/components/trigger-selector.tsx` | Brief schedule (D64), Quiet schedule (D92) |

**Anti-pattern (rejected at PR review):** Building any of these as
ad-hoc one-off components inside `apps/web/src/features/`. They must be
in `packages/shared` from launch.

**Re-use benefit:** D51 (Senders advanced filters) and D56 (Activity
filters) already need `<ConditionChip />` and `<FieldOperatorValue />`.
Building them as shared primitives is **not extra work** — it's
right-sizing existing work.

**5. UI layout + routes (must be scaffolded at launch):**

- **Autopilot screen layout:** Reserves vertical space below the
  presets list for a future "+ New custom rule" CTA. At launch, this
  space contains a discreet placeholder: *"Custom rules coming in V2.1
  — [Request early access →]"* (links to support).
- **Routes scaffolded:**
  - `/autopilot/custom/new` → renders the "Coming in V2.1" placeholder
    page with the same Request-access CTA.
  - `/autopilot/rules/:id/edit` (when rule is custom) → renders the
    placeholder.
  - When `custom_autopilot_builder_enabled = true` (V2.1+), these
    routes render the actual builder.
- **No 404 at launch** — placeholder is intentional, gives users a
  signal that custom rules are *known to be coming*, not absent.

**6. Subagent + CLAUDE.md rules (enforce forward-compatibility):**

**CLAUDE.md addition (when Topic 32 lands):**

```markdown
## Autopilot architecture rule (D197)

Autopilot must accept custom rules without refactor.

- Preset rules = rows with `is_preset = true` and hardcoded conditions
- Custom rules = rows with `is_preset = false` and user-supplied conditions
- Engine evaluator: uniform — no `if (rule.is_preset)` branching
- API: full schema accepted for both shapes
- Design system primitives in `packages/shared/components/` —
  `ConditionChip`, `FieldOperatorValue`, `DragReorderList`,
  `TriggerSelector`. Never duplicate inside `apps/web/src/features/`.
- UI routes `/autopilot/custom/*` scaffolded; flag controls whether
  they render placeholder or builder.
```

**Architecture Guardian subagent (Topic 33, deferred):**

- Rejects PRs that introduce preset-specific branching in
  `apps/api/src/autopilot/` evaluator code.
- Rejects PRs that duplicate condition-chip / field-op-value /
  drag-reorder / trigger-selector primitives outside `packages/shared`.
- Required PR template checkbox: *"☐ This Autopilot PR preserves
  custom-rule forward-compatibility (D197), OR I have included a
  waiver."*

**7. Golden test (must pass at launch, runs in CI on every PR
touching Autopilot):**

```typescript
// packages/db/__tests__/autopilot-custom-rule-forward-compat.test.ts

test('custom rule inserted via direct DB write evaluates correctly', async () => {
  // 1. Seed presets via standard migration
  await runMigrations();

  // 2. Insert a synthetic custom rule via direct SQL (bypasses any UI)
  await db.insert(automation_rules).values({
    workspace_id, mailbox_account_id,
    name: 'Test custom rule',
    is_preset: false,
    preset_key: null,
    conditions: { field: 'monthly_volume', operator: '>', value: 100 },
    action: { type: 'archive', parameters: {} },
    mode: 'active',
  });

  // 3. Trigger RuleEvaluationWorker against a sender that matches
  const result = await runRuleEvaluation(senderContext);

  // 4. Assert custom rule fired the same way a preset would
  expect(result.actions).toContainEqual(expect.objectContaining({
    rule_is_preset: false,
    action_type: 'archive',
  }));
});
```

This test is the **architectural truth** — it must pass at V2 launch
even though no UI creates custom rules. If it fails, forward-
compatibility is broken and V2.1 will require refactor.

---

**Updated D188 flag table (replaces D196's table):**

| Flag key | Default | Disable means |
|---|---|---|
| `brief_enabled` | true | (per D188) |
| `snoozed_enabled` | true | (per D188) |
| `followups_enabled` | true | (per D188) |
| `quiet_mode_enabled` | true | (per D188) |
| `custom_autopilot_builder_enabled` | **false** | API rejects custom rule create/update from non-founder accounts; `/autopilot/custom/*` routes render "Coming in V2.1" placeholder. **Founder/devPreference always has API access** for testing the architecture. |

**V2.1 unlock criteria (when to build the UI):**

Same as D192's original criteria:

- ≥20 distinct beta or paid users request custom rules via support OR
  click the "Request early access" CTA within a 30-day rolling window, OR
- A specific use case appears in ≥3 user research interviews (e.g.,
  *"I want a rule that fires on Gmail label change"*)

When unlocked: build PR 16-B (UI only, ~2-3 weeks per D192's estimate).
Ship behind `custom_autopilot_builder_enabled = false` default. Apply
D196's enable criteria (≥20 enabled users with ≥1 rule, no false-
positive cluster, 30 days clean data) before flipping to global
`true`.

**Timeline impact:**

- D196's +2-3 week UI build is removed.
- D197 adds ~0.5-1 week of architectural discipline: design system
  primitives, route scaffolding, golden test, Zod schema completion.
- Net vs D196: **save ~1.5-2 weeks of launch calendar time.**
- Net vs D192 original: **+0.5-1 week** for explicit architectural
  readiness (worth it — guarantees V2.1 is UI-only).
- D149 launch target: back to **Nov-Dec 2026** (no longer pushed to
  Dec-Jan).

**Marketing copy implications:**

- ❌ Still don't claim: *"Build any rule you want."*
- ✅ Do claim: *"5 thoughtful presets that cover the common cases."*
- ✅ Do claim: *"Custom rules coming in V2.1 — [Request early access]."*
  Signals the optionality without overpromising, and the request
  mechanism feeds V2.1 unlock criteria directly.

**Affects:**

- PR 16-A (presets) ships at launch — unchanged.
- PR 16-B (custom builder UI) **removed from launch roadmap** —
  rescheduled for V2.1.
- New PR added to launch roadmap: **"PR 16-A.5 — Autopilot
  architectural readiness"** covers:
  - Full Zod schema for conditions vocabulary
  - API endpoints (POST/PATCH/DELETE with flag gating)
  - Design system primitives in `packages/shared/components/`
  - Route scaffolding with placeholder pages
  - Golden forward-compat test in CI
  - CLAUDE.md "Autopilot architecture rule" entry
  - Subagent guardrail config (Architecture Guardian rejects
    preset-specific branching)

---

**Why this is the right call:**

The user's intent was sharp: *"if we can make sure the architecture
accommodates it, then deferring is fine."* That's the V2-architecture-
must-survive-V3 discipline — pay a small tax now, gain large optionality
later. D197 makes the tax explicit, the optionality verifiable (golden
test), and the V2.1 unlock a pure UI build.

The risk D192 had (architectural drift during launch) is eliminated by
the Architecture Guardian subagent + golden test. The risk D196 had
(2-3 weeks of UI work for hidden code) is eliminated by deferring the
UI. D197 captures the best of both.

---

# Architecture Grill — Design Principles, Anti-Duplication, Component Reuse (2026-05-18)

**Context:** Distinct grilling session triggered by user's request to
verify "correct design principles, best architecture framework, no
duplication, component reuse." Earlier sections (Codex Grill Response,
Post-Grill Reversals) handled spec-drift and feature-scope decisions.
This section locks **architectural patterns and reuse discipline**.

---

### D198 — Headless hooks for behavior, feature-owned components for rendering (resolves D36/D50/D57 implicit duplication)

**Resolves implicit duplication across D36 (Triage row), D50 (Sender
card), and D57 (Activity row)** — three collapse/expand patterns
originally specced as separate components with the same behavior.
Brief items (D63 family), Screener rows (D73), Followups (D90),
Snoozed (D80), and Settings list rows (D114) inherit the same pattern.

**Decision:** Across the entire codebase, **behavior is shared via
headless hooks; rendering is feature-owned.** `packages/shared/` is the
**contract layer** — types, Zod schemas, hooks, leaf primitives —
consumed by both `apps/web/` today and `apps/mobile/` later (per D173).

**The rule (becomes load-bearing CLAUDE.md entry when Topic 32 lands):**

> *"Headless hooks for behavior. Feature-owned components for
> rendering. `packages/shared/` is the contract layer — types, Zod
> schemas, hooks, leaf primitives both apps consume. Feature components
> live in `apps/{app}/src/features/{feature}/`."*

---

**Pattern definitions:**

- **Headless hook** = pure behavior. State, keyboard nav, ARIA props,
  animation timing, validation. No JSX, no styling, no business
  vocabulary. Returns `{state, handlers, ariaProps, animationVariants}`.
- **Feature component** = consumes the hook, renders its specific
  layout with its specific data and verbs. Lives in
  `apps/web/src/features/{feature}/components/`.
- **Leaf primitive** = `<Button>`, `<Input>`, `<Chip>`, `<Drawer>`,
  `<Modal>` etc. Pure visual building blocks. Live in
  `packages/shared/components/`. Promotion criterion captured in
  separate grill (see D199 candidate, queued).

---

**Why this over Option A (one parameterized primitive):**

- Avoids the god-object trap where every new feature adds props to a
  shared component (`<ExpandableRow variant="triage|sender|activity"
  showVerbButtons={...} showStatusPill={...} showCheckbox={...}>` →
  unmaintainable within 6 months).
- Each feature evolves rendering independently. Triage's K/A/U/L verb
  buttons can change without touching Activity's status pill.
- Hook contract is the *only* shared surface. Easier to version, test,
  and maintain.

**Why this over Option C (no shared abstraction):**

- Behavior drift is silent and cumulative. Without a shared hook,
  Triage uses Enter, Activity ends up using Space; animation timings
  diverge; single-row-accordion enforcement gets re-implemented
  inconsistently; ARIA props accumulate inconsistencies. Each is a
  small loss; together they cost the premium-feel positioning (D130).

---

**First hook to build: `useExpandableRow`**

Lives in `packages/shared/hooks/use-expandable-row.ts`.

```typescript
export function useExpandableRow(options: {
  rowId: string;
  expandedRowId: string | null;
  onExpand: (rowId: string | null) => void;
  expandKey?: 'Enter' | 'Space' | 'Both';   // default 'Enter'
  collapseKey?: 'Escape';                     // default 'Escape'
  animationDuration?: { expand: number; collapse: number };  // default {220, 180}
}): {
  isExpanded: boolean;
  toggle: () => void;
  handleKeyDown: (e: KeyboardEvent) => void;
  ariaProps: { 'aria-expanded': boolean; 'aria-controls': string };
  animationVariants: { initial: ..., animate: ..., exit: ... };
  rowProps: { onClick, onKeyDown, tabIndex, role, ...ariaProps };
};
```

**Single-row-accordion enforcement:** Each consumer (Triage, Senders,
Activity, etc.) owns its own `expandedRowId` state (Zustand store or
local feature state). The hook receives `expandedRowId` and
`onExpand` as inputs — behavior is uniform but **state ownership stays
with the feature**. No global state coupling between features.

---

**Consumers at launch (locked by this decision):**

| Component | Location | Decision references |
|---|---|---|
| `<TriageRow>` | `apps/web/src/features/triage/components/` | D36 |
| `<SenderCard>` | `apps/web/src/features/senders/components/` | D50 |
| `<SenderTableRow>` | `apps/web/src/features/senders/components/` | D49 (table view) |
| `<ActivityRow>` | `apps/web/src/features/activity/components/` | D57 |
| `<BriefItem>` | `apps/web/src/features/brief/components/` | D63-D70 family |
| `<ScreenerRow>` | `apps/web/src/features/screener/components/` | D73 |

**Consumers added when features ship:**

| Component | Decision references |
|---|---|
| `<FollowupRow>` | D90 |
| `<SnoozedRow>` | D80 |
| `<SettingsListRow>` | D114 (VIP/Protected/Inboxes lists) |
| `<PendingAutopilotSuggestionRow>` | D10/D104 (Observe Mode tray) |

Each consumes `useExpandableRow` from day 1. No exceptions without an
ADR.

---

**Patches applied to earlier decisions** (search `[GRILL PATCH]` to audit):

- D36 — Triage row uses `useExpandableRow` hook
- D50 — Sender card uses `useExpandableRow` hook
- D57 — Activity row uses `useExpandableRow` hook

Brief items, Screener rows, Followups, Snoozed, Settings rows inherit
the rule by default (the rule is system-wide, not per-feature).

---

**Cascading implications:**

1. **`packages/shared/hooks/`** becomes a first-class directory. Each
   hook gets its own file plus a README entry listing: contract,
   consumers, when to use, when not to use.

2. **`packages/shared/components/`** is for **leaf primitives only** —
   `<Button>`, `<Chip>`, `<Drawer>`, `<Modal>`, `<ConditionChip>`
   (D197), `<FieldOperatorValue>` (D197), `<DragReorderList>` (D197),
   `<TriggerSelector>` (D197). **Feature components never live here.**

3. **`apps/web/src/features/{triage,senders,activity,brief,screener,
   autopilot,settings,billing,onboarding,quiet,followups,snoozed}/`**
   becomes the canonical feature-component home. Each feature owns its
   own routes, hooks (feature-specific), components, and queries.

4. **Mobile (D173)** consumes the same `packages/shared/hooks/` from
   `apps/mobile/src/features/{feature}/` with React Native components.
   Hooks are platform-agnostic by construction — no `document`,
   `window`, or DOM-specific APIs.

5. **Cross-feature imports forbidden.** A feature in
   `apps/web/src/features/triage/` may NOT import from
   `apps/web/src/features/senders/`. If shared, the thing belongs in
   `packages/shared/`.

---

**Enforcement (Architecture Guardian subagent, Topic 33 — deferred):**

- Rejects PRs creating feature components inside `packages/shared/`.
- Rejects PRs duplicating behavior already covered by a headless hook.
- Rejects PRs importing across `apps/web/src/features/` boundaries.
- Rejects PRs putting business vocabulary in `packages/shared/hooks/`
  (e.g., a hook with `senderKey` in its types belongs in
  `apps/web/src/features/senders/hooks/`).

**Golden test (must pass at launch, CI gate):**

```typescript
// packages/shared/__tests__/expandable-row-uniformity.test.ts

describe('useExpandableRow consumers share uniform behavior', () => {
  test.each(['triage', 'senders', 'activity', 'brief', 'screener'])(
    '%s row consumes the hook and enforces single-row accordion',
    (feature) => {
      // Render the feature's row list
      // Expand row A → assert ariaExpanded='true' on A
      // Click row B → assert A is collapsed and B is expanded
      // Press Esc on B → assert B collapses
      // Animation duration matches the hook's default
    }
  );
});
```

If any consumer drifts from the hook, this test fails.

---

**Timeline impact:**

- **+2-3 days upfront:** Design `useExpandableRow` contract, build hook,
  write golden test before any consumer.
- **-2-3 days downstream per consumer:** Each row component ships
  faster because behavior is solved.
- **Net launch impact:** likely neutral to ~1 week faster overall (6
  consumers × ~0.5 day saved each, offset by ~3 days upfront work).
- Behavior-drift bugs eliminated = compounding maintenance savings.

---

**Marketing copy implication:** None direct. Internally, this is what
makes 13 screens *feel uniformly premium* (D130) despite being built
by different agents over different weeks. Without the hook, "premium
feel" is aspirational; with it, it's mechanical.

---

**What this decision does NOT cover (queued for subsequent grills):**

- **Promotion criterion** for code moving into `packages/shared/`
  (Grill 2 — coming next).
- **API response envelope + pagination format** (queued).
- **Worker base class / shared observability** (queued).
- **Frontend state management** (Zustand vs Jotai vs React Query —
  queued; D173 mentions hooks but no library named).
- **DB query layer organization** (queued — Drizzle co-located vs
  centralized).
- **Marketing components — separate or shared with product** (queued).

These will be locked one at a time through the grill series.

---

### D199 — Lazy promotion + spec override (component/utility placement rule)

**Decision:** Components and utilities live in `apps/{web,api,worker}/`
**until ≥2 actual usages exist in code**. The 2nd usage's PR promotes
the shared primitive into `packages/shared/`. D-decisions can
pre-promote when ≥2 consumers are explicitly named in the spec.

**Scope:** Components, utilities, types, schemas. Hooks always live in
`packages/shared/hooks/` per D198 (this rule does NOT apply to hooks).

**Default flow (lazy promotion):**

1. Agent building Feature A creates `<Foo>` inside
   `apps/web/src/features/{A}/components/`. No promotion required.
2. Agent building Feature B later needs the same thing. **Their PR
   does all of:**
   - Move `<Foo>` from feature A to `packages/shared/components/`
   - Add D-citation comment + Consumers line at top of file
   - Update Feature A's import
   - Add Feature B's import
   - Update `packages/shared/components/index.ts` barrel export
3. Both features now consume one source of truth. The shape is locked
   at this moment (no further parameter accretion without an ADR).

**Spec override (pre-promotion when consumers are spec-named):**

If a D-decision explicitly names ≥2 consumers (e.g., D197 names
`<ConditionChip>` consumed by Senders D51 + Activity D56 + future
Autopilot custom builder), the primitive ships in
`packages/shared/components/` from day 1. **Spec citation lives in the
file header** so the rationale is in the code, not buried in the plan:

```typescript
// packages/shared/components/condition-chip.tsx
//
// Promoted to packages/shared/ per D197 (Architectural readiness).
// Consumers:
//   - Senders D51 advanced filters drawer
//   - Activity D56 filter drawer
//   - Autopilot custom rule builder (V2.1 unlock, per D197)
//
// Shape locked at creation. New consumers require existing API to fit.
// Breaking changes require ADR + multi-feature PR.
```

---

**Architecture Guardian role (Topic 33 — deferred, now load-bearing):**

When a PR creates or modifies a component/utility, Guardian:

1. **Runs AST-similar grep** across `apps/*/src/**/*.{ts,tsx}` for
   components with similar prop shapes, utilities with similar
   signatures, or types with overlapping fields.
2. **If similar code found in 1+ other feature:** Guardian posts a PR
   comment describing the match — file paths, similarity score, suggested
   shared shape.
3. **Surfaces, does not reject.** Founder reviews and decides:
   - **Unify** (recommended): PR is updated to promote in same commit.
   - **Document divergence**: PR description explains why two variants
     are needed (e.g., "Triage row needs verb-button slot; Settings row
     does not; promoting would parametrize the row to a god-object").

**Guardian's hard rejection rules (separate from duplication surfacing):**

- Reject PRs that import across `apps/web/src/features/{A}/` → `{B}/`
  boundaries. Shared things go through `packages/shared/`.
- Reject PRs that put feature business vocabulary inside
  `packages/shared/` (e.g., a type with `senderKey` field is feature-
  specific; promote without scrubbing vocabulary = reject).
- Reject PRs to `packages/shared/components/` that don't include a
  `// Consumers:` header comment.

---

**Worked examples for current plan:**

| Primitive | Promotion path | Reason |
|---|---|---|
| `<Button>`, `<Input>`, `<Chip>`, `<Modal>`, `<Drawer>` | Pre-promoted | Universal primitives; no shared-shape spec needed; design system foundation |
| `<ConditionChip>` | Pre-promoted per D197 | 3 named consumers (Senders D51, Activity D56, future Autopilot) |
| `<FieldOperatorValue>` | Pre-promoted per D197 | Same |
| `<DragReorderList>` | Pre-promoted per D197 | Notification reordering, Pinned senders, Quiet schedule |
| `<TriggerSelector>` | Pre-promoted per D197 | Brief schedule (D64), Quiet schedule (D92) |
| `<RecommendationBadge>` | Pre-promoted | Spec-named in D36 (Triage), D39 (Sender Detail), D50 (Senders) — ≥2 consumers |
| `<RowAvatar>` | Lazy-promoted | First feature to ship a row creates it locally; 2nd promotes in the same PR |
| `<UndoLink>` | Lazy-promoted | Activity D58 + Sender Detail history D46 + Triage action tray D35 — first to ship creates, second promotes |
| `<EmptyState>` | Lazy-promoted | Triage D33, Followups D91, Snoozed (D80 family), Screener D76 all have empty states with similar shape — first to ship creates, second promotes |
| `<StatsStrip>` | Lazy-promoted | Sender Detail D44 + Activity D59 have similar 1-row stats display |
| `<ActionSheet>` | Lazy-promoted | Triage D34 + Sender Detail D40 + Senders bulk D52 all open action sheets |

**Promotion ceremony checklist** (Guardian verifies before merge):

- [ ] File moved to `packages/shared/components/`
- [ ] D-citation comment present at file head
- [ ] `// Consumers:` line lists all current + spec-known consumers
- [ ] Both features' imports updated
- [ ] `packages/shared/components/index.ts` exports the primitive
- [ ] No feature business vocabulary in types (no `senderKey`,
      `triageVerb`, `briefSection`, etc. in shared types)
- [ ] Shape interface clearly delimits required vs optional props
- [ ] Golden test: no `import from '../features/...'` inside
      `packages/shared/`

---

**Failure modes this prevents:**

- **Forced premature abstraction:** Agent A doesn't design a "future-
  proof" component on day 1. Just build what's needed for Feature A.
- **Silent multi-agent duplication:** Guardian's grep catches duplicates
  across worktrees that humans wouldn't see. Once surfaced, founder
  decides.
- **God-object accretion:** Promoting in the same PR as the 2nd
  consumer **locks the API immediately**. No time for it to drift
  through 4-5 features collecting parameters.

**Failure modes acknowledged (residual risk):**

- **Refactor moment cost:** Each 2nd consumer pays a small refactor
  tax (~30-60 min). Acceptable — this is the moment when you actually
  know what the shared shape should be.
- **Guardian false positives:** AST-similar grep may flag things that
  *should* stay separate. Founder dismisses with one click + brief
  reason in PR description (logged for pattern analysis later).
- **Late promotion:** If 3rd consumer arrives before 2nd, the
  promotion still happens then. That's fine.

---

**CLAUDE.md addition (when Topic 32 lands):**

```markdown
## Component placement rule (D199)

- Components live in `apps/{web,api,worker}/src/features/{feature}/`
  until ≥2 usages exist.
- 2nd-usage PR promotes to `packages/shared/components/`.
- D-decision-named multi-consumer primitives pre-promote (see file
  header comments for spec citations).
- Hooks always in `packages/shared/hooks/` (D198).
- Architecture Guardian surfaces duplication candidates; founder
  decides unify vs diverge.
```

---

**Timeline impact:** Zero direct overhead. Refactor moments cost
~30-60 min per 2nd-consumer PR; offset by ~2-3 hours saved per feature
that doesn't have to design speculatively for unknown future consumers.

---

### D200 — Frontend state management: TanStack Query (server state) + Zustand (client state)

**Decision:** Two libraries, strictly separated by what kind of state
they own. No overlap.

| Library | Owns | Examples |
|---|---|---|
| **TanStack Query** (`@tanstack/react-query`) | Server state | Sender list, Activity log, Sender Detail, sync status polling, Triage queue, Brief payload |
| **Zustand** | Ephemeral client state | Modal/sheet open state, expanded row id, draft form values, sidebar collapsed, filter chip selections (before applied) |

**Rule:** Anything fetched from the API → TanStack Query. Anything that
exists only in the user's current browser session and never travels to
the server → Zustand. No third pattern.

---

**TanStack Query conventions (locked):**

1. **Query key shape — always tuple-based, namespaced by feature:**
   ```typescript
   ['senders', { workspaceId, mailboxAccountId, filters }]
   ['senders', senderKey, 'detail']
   ['senders', senderKey, 'history', { limit, offset }]
   ['activity', { workspaceId, window, filters }]
   ['triage', 'queue', { mailboxAccountId, date }]
   ['brief', { mailboxAccountId, date }]
   ['autopilot', 'rules', { workspaceId }]
   ['sync-status', mailboxAccountId]
   ```

2. **Query hook naming:** `useXxx` or `useXxxList` / `useXxxDetail`:
   - `useSenders(filters)` — paginated list
   - `useSenderDetail(senderKey)` — single sender
   - `useActivity(filters)` — paginated activity
   - `useTriageQueue(date)` — today's queue
   - `useSyncStatus(mailboxAccountId)` — polling

3. **Mutation hook naming:** `useXxxMutation`:
   - `useApplyVerdictMutation()` — Triage Keep/Archive/Unsubscribe/Later
   - `useMarkVipMutation()` / `useUnmarkVipMutation()`
   - `useToggleProtectMutation()`
   - `useUndoActionMutation()`
   - `useCreateRuleMutation()` / `useUpdateRuleMutation()`

4. **Optimistic updates for action mutations** (D35 action tray, D58 undo):
   - On mutate: optimistically update the cache (mark row as
     archived in `useSenders` cache; add row to `useActivity` cache).
   - On error: roll back (`onError` restores previous cache state).
   - On success: invalidate adjacent queries (sender stats, activity
     log) to refetch fresh truth.

5. **Polling** (used by D6 sync status + D74 Screener badge):
   - `useSyncStatus` polls every 3s while `readiness_status='syncing'`,
     stops polling on `ready`.
   - `useScreenerCount` polls every 60s with `refetchOnWindowFocus: true`.

6. **Hydration:** Next.js App Router with `HydrationBoundary` — server
   prefetches critical queries (Triage queue, Senders top page) and
   ships dehydrated state in RSC payload. Client hydrates without
   refetch.

7. **Error handling integrates with D168/D169:**
   - Mutation errors map to severity tiers (D169):
     - `silent_transient` — TanStack Query retry handles
     - `inline_recoverable` — Activity row "needs attention" + retry
     - `critical_trust` — banner via global error store (Zustand)
   - `displayId` from D168 error envelope shown in UI error states.

---

**Zustand conventions (locked):**

1. **Per-feature stores, not one global store:**
   ```
   apps/web/src/features/triage/store.ts    → useTriageStore
   apps/web/src/features/senders/store.ts   → useSendersStore
   apps/web/src/features/activity/store.ts  → useActivityStore
   apps/web/src/features/autopilot/store.ts → useAutopilotStore
   ```
   Plus 1-2 truly cross-feature stores:
   ```
   apps/web/src/stores/ui-store.ts          → useUIStore (sidebar, theme, global modals)
   apps/web/src/stores/error-store.ts       → useErrorStore (critical banners per D169)
   ```

2. **Slice pattern:** Each store has typed `state` + `actions`:
   ```typescript
   interface TriageState {
     expandedRowId: string | null;
     verbPreference: { skipActionSheet: boolean };
   }
   interface TriageActions {
     setExpandedRow: (id: string | null) => void;
     toggleSkipActionSheet: () => void;
   }
   export const useTriageStore = create<TriageState & TriageActions>((set) => ({
     expandedRowId: null,
     verbPreference: { skipActionSheet: false },
     setExpandedRow: (id) => set({ expandedRowId: id }),
     toggleSkipActionSheet: () => set((s) => ({
       verbPreference: { ...s.verbPreference, skipActionSheet: !s.verbPreference.skipActionSheet }
     })),
   }));
   ```

3. **Immer middleware** for deeply-nested state (`zustand/middleware/immer`).
4. **Persist middleware** only where session-survival matters:
   - `useUIStore` (sidebar collapsed, theme) — yes
   - Filter selections in Senders/Activity — yes (improves return UX)
   - Triage `expandedRowId` — no (ephemeral, resets on refresh)
5. **Devtools middleware** in dev only (`zustand/middleware/devtools`).

---

**Integration with earlier decisions:**

- **D198 `useExpandableRow`:** receives `expandedRowId` + `onExpand`
  from the feature's Zustand store. State ownership stays with the
  feature (no global expandedRowId pollution).
- **D199 lazy promotion:** TanStack Query *query hooks* follow the
  same lazy-promotion rule. `useSenders` lives in
  `apps/web/src/features/senders/hooks/use-senders.ts`. If a 2nd
  feature needs it (e.g., Sender Detail page needs adjacent senders),
  it promotes to `packages/shared/hooks/` — but in practice query
  hooks rarely need promotion since each feature owns its endpoints.
- **D188 feature flags:** `useFeatureFlag(flagKey)` is a `packages/shared`
  hook from day 1 (≥3 spec-named consumers: Brief, Snoozed, Followups,
  Quiet — pre-promoted per D199).
- **D158/D193 polling vs websockets:** All real-time-ish updates use
  TanStack Query polling. No websockets at launch (deferred). Polling
  rates documented per-query.

---

**Anti-patterns (Architecture Guardian rejects):**

- ❌ `useState` for server-fetched data (e.g.,
  `const [senders, setSenders] = useState([]); useEffect(() => fetch(...))`)
  → must use TanStack Query
- ❌ Zustand storing server-shaped data (e.g., a `useSendersStore` that
  caches API responses) → must use TanStack Query
- ❌ Mixing client + server state in one store → split into two
- ❌ Global Zustand store with all features dumped in → split per feature
- ❌ Raw `fetch()` calls outside TanStack Query → use query/mutation hooks
- ❌ Optimistic update via direct DOM mutation → use TanStack Query
  `setQueryData` cache update
- ❌ Storing JWT or auth tokens in Zustand → tokens live in HttpOnly
  cookies per D155, never in JS-accessible state

---

**Package additions (locked by this decision):**

- `@tanstack/react-query` (latest)
- `@tanstack/react-query-devtools` (dev only)
- `zustand` (latest)
- `immer` (for Zustand immer middleware)
- `@tanstack/eslint-plugin-query` (lints common mistakes — exhaustive deps,
  missing query keys, etc.)

---

**Testing:**

- TanStack Query queries: mocked via `msw` (Mock Service Worker) in
  Vitest; full lifecycle (loading → success → error → retry) covered
  for each load-bearing hook.
- Zustand stores: pure-function-tested (initialize, call actions,
  assert state). No React renderer needed.
- Optimistic update flows: tested explicitly — mutation triggered,
  cache asserted updated, then error injected, cache asserted rolled
  back.

---

**Why this over Server Actions:**

Next.js Server Actions are excellent for traditional forms (login,
settings save) but weaker for:
- Optimistic UI with rollback (D35/D58 patterns) — Server Actions
  expect server round-trip before UI updates
- Polling sync status — Server Actions don't model long-running
  fetches well
- Mutation status (pending/error/success) signaling to multiple
  components — TanStack Query's `useMutation` state is more
  ergonomic

We may still use Server Actions for low-stakes forms (Settings
preferences, billing portal redirects). But the primary data flow is
TanStack Query.

---

**CLAUDE.md addition (when Topic 32 lands):**

```markdown
## State management rule (D200)

- Server state → TanStack Query. Per-feature query/mutation hooks.
  Query keys are tuples namespaced by feature.
- Client state → Zustand. Per-feature stores. No global state-dump.
- Never use useState for server-fetched data.
- Optimistic updates: setQueryData on mutate + rollback in onError.
- Polling: documented rate per query hook.
- Forbidden: raw fetch(), useState for server data, global Zustand
  with all features inside.
```

---

**Timeline impact:** None — these are the libraries Claude agents
would reach for anyway. Locking the pattern eliminates per-agent
variance, which saves debug time later.

---

### D201 — API + Worker architecture: Standard NestJS modules + Adapter pattern at external boundaries

**Decision:** Standard NestJS module-per-feature organization inside
`apps/api/` and `apps/worker/`. External integrations sit behind
**Adapter interfaces** declared in `packages/shared/contracts/`. NestJS
modules import the adapter interface — never the concrete SDK.

**Why this combination:**

- **Standard NestJS** = most training data, most predictable patterns
  across agents. Adapter boundaries protect what matters; the rest
  follows the framework's grain.
- **Adapter pattern at boundaries** = preserves the Outlook-later swap
  promise (D11/D157), makes testing trivial (mock adapter), keeps
  external SDK quirks contained, makes integration swaps mechanical.
- **Avoids full hexagonal ceremony** for simple CRUD; reserves the
  discipline for places it actually pays.

---

**Module structure per feature (`apps/api/src/features/{feature}/`):**

```
senders/
├── senders.module.ts          # NestJS module wiring
├── senders.controller.ts      # HTTP routes (Decorators), thin
├── senders.service.ts         # Business logic
├── senders.queries.ts         # Drizzle queries (DB access)
├── dto/                       # Zod schemas + inferred types
│   ├── list-senders.dto.ts
│   └── ...
├── guards/                    # Feature-specific NestJS guards
└── __tests__/
```

**Worker equivalent (`apps/worker/src/features/{feature}/`):**

```
recommendation/
├── recommendation.module.ts
├── recommendation.processor.ts   # BullMQ processor (replaces controller)
├── recommendation.service.ts
├── recommendation.queries.ts
└── __tests__/
```

---

**NestJS conventions (locked):**

1. **One module per feature.** Services are module-private by default;
   exported only when another module needs them.
2. **Controllers are thin.** Apply Zod validation via
   `@anatine/zod-nestjs` (or equivalent), apply Guards (auth, CSRF,
   rate limit), call exactly one service method, return result. No
   business logic.
3. **Services own business logic.** Take typed DTO inputs, compose
   queries + adapter calls, return typed outputs, throw typed errors
   (mapped to HTTP via NestJS Exception Filters).
4. **Queries own DB access** via Drizzle. Take typed inputs, return
   typed rows. No conditional business logic in queries.
5. **DTOs** are Zod schemas + inferred types co-located in feature
   `dto/`. Cross-feature DTOs lazy-promote to
   `packages/shared/schemas/` per D199.

---

**Adapter pattern at external boundaries (the discipline that matters):**

Every external integration = **contract** (interface in
`packages/shared/contracts/`) + **implementation** (class in
`apps/{api,worker}/src/adapters/{provider}/`).

**Adapters at launch:**

| External system | Contract | Implementation | Consumers |
|---|---|---|---|
| Gmail API | `MailProviderAdapter` | `apps/worker/src/adapters/gmail/` | Sync workers, action workers |
| Paddle | `BillingProvider` | `apps/api/src/adapters/paddle/` | Billing module |
| Razorpay | `BillingProvider` (same iface) | `apps/api/src/adapters/razorpay/` | Billing module (region-selected) |
| GCP KMS | `KmsProvider` | `apps/api/src/adapters/gcp-kms/` | Auth module (D14 envelope encryption) |
| GCP Pub/Sub | `PubsubProvider` | `apps/worker/src/adapters/gcp-pubsub/` | Sync workers |
| Resend | `EmailProvider` | `apps/api/src/adapters/resend/` | Notifications module |
| PostHog | `AnalyticsProvider` | `apps/api/src/adapters/posthog/` + web instrumentation | All features |
| Sentry | `ErrorReporter` | `apps/api/src/adapters/sentry/` + global filter | All features |
| Anthropic Claude (Haiku) | `LlmProvider` | `apps/worker/src/adapters/anthropic/` | RecommendationWorker (D24), BriefWorker (D62) |

**Contract pattern:**

```typescript
// packages/shared/contracts/mail-provider.ts
export interface MailProviderAdapter {
  fetchHistory(input: FetchHistoryInput): Promise<HistoryPage>;
  batchModify(input: BatchModifyInput): Promise<BatchModifyResult>;
  watch(input: WatchInput): Promise<WatchHandle>;
  // ... full surface per Doc 07
}

// apps/worker/src/adapters/gmail/gmail-provider.adapter.ts
@Injectable()
export class GmailProviderAdapter implements MailProviderAdapter {
  constructor(private readonly gmailClient: GmailClient) {}
  async fetchHistory(input: FetchHistoryInput): Promise<HistoryPage> {
    // Gmail SDK call mapped to our domain shape
  }
  // ...
}

// apps/worker/src/features/sync/sync.module.ts
@Module({
  providers: [
    SyncService,
    { provide: 'MailProviderAdapter', useClass: GmailProviderAdapter },
  ],
})
export class SyncModule {}

// apps/worker/src/features/sync/sync.service.ts
@Injectable()
export class SyncService {
  constructor(
    @Inject('MailProviderAdapter')
    private readonly mailProvider: MailProviderAdapter,  // depends on interface, not SDK
  ) {}
}
```

---

**Hard rules (Architecture Guardian rejects):**

- ❌ Controller or Service imports an external SDK directly. Every SDK
  call goes through an adapter.
- ❌ Adapter implementation outside `apps/{api,worker}/src/adapters/`.
- ❌ Contract outside `packages/shared/contracts/`.
- ❌ Cross-feature service injection (`SendersModule` injecting
  `AutopilotService`). Communication goes through events
  (outbox/Pub-Sub-style) or via a shared module.
- ❌ Queries outside the feature folder. No centralized
  `apps/api/src/db/queries.ts`.
- ❌ Multiple implementations of the same adapter in one module
  (except billing — Paddle + Razorpay coexist by design, region-
  selected at request time).

---

**Testing pattern (locked):**

- **Unit tests** (Vitest, per D182): Service tested with mocked
  adapters + mocked queries. No NestJS bootstrap.
- **Integration tests:** Module tested with real Drizzle + testcontainers
  Postgres (per D182) + mocked adapters at boundaries.
- **E2E tests:** Real Gmail test account (per D183), real DB, real
  adapters. Scheduled smoke, not blocking.

Standard adapter-mock pattern via NestJS `Test.createTestingModule()`
with `{ provide: 'XxxAdapter', useValue: mockXxx }`.

---

**Worker-specific notes:**

- BullMQ processors replace HTTP controllers. Same thinness rule —
  processor receives job, validates payload (Zod), calls one service
  method.
- Workers and API share `packages/shared/`, `packages/db/`, and the
  adapter contracts. Workers may have their own adapter implementations
  for adapters API doesn't need (Pub/Sub consumer side, e.g.).
- Worker base class + shared retry/observability pattern: queued for
  separate grill.

---

**Marketing site (`apps/web` marketing pages) intentionally excluded
from D201:** Marketing pages are Next.js Server Components + Server
Actions, not NestJS. The pattern is different. Marketing component
sharing rules are a separate grill (queued).

---

**CLAUDE.md addition (when Topic 32 lands):**

```markdown
## Backend architecture rule (D201)

- One NestJS module per feature in apps/{api,worker}/src/features/{feature}/.
- Controllers thin (validation + guards + one service call). Services
  own business logic. Queries own DB access.
- External integrations (Gmail, Paddle, Razorpay, KMS, Pub/Sub,
  Resend, PostHog, Sentry, Anthropic) sit behind Adapter interfaces in
  packages/shared/contracts/.
- Services depend on the interface (@Inject('XxxAdapter')), never on
  the concrete SDK class.
- Forbidden: SDK imports in controllers/services, cross-feature
  service injection, centralized db/queries.ts.
```

---

**Timeline impact:** Adapter scaffolding adds ~1-2 days per integration
upfront. Compound savings later: every feature using Gmail/Paddle/etc.
gets a clean boundary; testing is trivial; integration swaps
(Outlook later, Stripe-if-ever) become mechanical instead of
architectural.

**Affects (concrete cross-references):**

- D11 Drizzle: queries co-located in feature folders, not centralized.
- D14 KMS envelope: `KmsProvider` contract declared in shared.
- D24 LLM role: Anthropic SDK behind `LlmProvider` interface.
- D117 Paddle + Razorpay: both implement `BillingProvider` — D201
  makes this mechanical, not aspirational.
- D157 workers: each worker is a feature module; processor pattern
  replaces controller.
- D162 Resend: behind `EmailProvider` interface.
- D195 worker scaling decoupled from billing webhook: webhook handler
  is a thin controller calling exactly one billing service method.

---

### D202 — API response envelope + cursor pagination

**Decision:** Single envelope shape for **all** endpoints. Cursor
pagination for **all** product-facing list endpoints. Admin-only static
datasets may use offset pagination via an ADR-documented exception.

---

**Success envelope (locked):**

```typescript
// packages/shared/contracts/api-envelope.ts

export type ApiSuccess<T> = {
  data: T;
  meta?: {
    requestId?: string;       // correlation ID — aligns with D168 displayId/correlationId
    pagination?: {
      nextCursor: string | null;  // null when hasMore=false
      hasMore: boolean;
      limit: number;          // page size used by server (may differ from requested)
    };
  };
};
```

**Examples:**

List endpoint (`GET /api/v1/senders?limit=50`):
```json
{
  "data": [...],
  "meta": {
    "requestId": "req_abc123",
    "pagination": { "nextCursor": "eyJyIjoxN...", "hasMore": true, "limit": 50 }
  }
}
```

Single resource (`GET /api/v1/senders/:senderKey`):
```json
{
  "data": { "id": "sender_123", "email": "..." },
  "meta": { "requestId": "req_xyz789" }
}
```

Empty list:
```json
{
  "data": [],
  "meta": {
    "requestId": "req_...",
    "pagination": { "nextCursor": null, "hasMore": false, "limit": 50 }
  }
}
```

---

**The rule (Architecture Guardian enforces):**

> Every endpoint returns `{ data, meta }`. Every list endpoint uses
> cursor pagination via `meta.pagination` with opaque `nextCursor`,
> `hasMore`, `limit`. Offset pagination is not allowed for product-
> facing list APIs unless explicitly approved in an ADR for static
> admin-only datasets.

---

**Cursor format and security:**

- **Encoding:** opaque base64url-encoded signed JSON.
  **Client treats as a black box** — never parses, decodes, constructs.
- **Server-internal payload:**
  ```typescript
  {
    sort_key_value: string | number,  // value of sort column at last row
    last_id: string,                   // ULID/UUID of last row (tiebreaker)
    sort_dir: 'asc' | 'desc',
    filters_hash: string,              // SHA1 of applied filters
    expires_at: number,                // unix ms; 24h from creation
  }
  ```
- **HMAC-SHA256 signed** with a server-only secret stored in GCP Secret
  Manager (per D177). Prevents cursor forgery.
- **Expiry:** 24h. Stale cursor → server returns 410 Gone with
  `error.code = 'CURSOR_EXPIRED'`. Clients re-fetch from start.
- **Filter mismatch:** if `filters_hash` doesn't match current filters,
  server returns 400 with `error.code = 'CURSOR_FILTERS_MISMATCH'`.
  Client re-fetches from start with new filters.

**Cursor helper (lives in `packages/shared/contracts/cursor.ts`):**

```typescript
export function encodeCursor(payload: CursorPayload, secret: string): string;
export function decodeCursor(cursor: string, secret: string): CursorPayload;
// decodeCursor throws CursorExpiredError, CursorInvalidError, or returns payload
```

**No other code anywhere may encode/decode cursors.** Guardian enforces.

---

**Pagination query parameters (locked):**

```
GET /api/v1/senders?limit=50&cursor=eyJyI...&sort=noise_score&dir=desc&filter[gmail_category]=Promotions
```

| Param | Required | Behavior |
|---|---|---|
| `limit` | No | Page size. Server clamps to per-endpoint max (default 50, max 100 for most lists; Activity capped 200; Brief no pagination). |
| `cursor` | No | Cursor from prev page's `meta.pagination.nextCursor`. Absent/empty = first page. |
| `sort` | No | Sort key from per-endpoint allowlist. Default sort defined per endpoint. |
| `dir` | No | `asc` or `desc`. Default per endpoint. |
| `filter[...]` | No | Feature-specific filters; participate in `filters_hash`. |

---

**TanStack Query integration (D200 alignment):**

```typescript
// apps/web/src/features/senders/hooks/use-senders.ts
export function useSenders(filters: SenderFilters) {
  return useInfiniteQuery({
    queryKey: ['senders', filters],
    queryFn: ({ pageParam }) => api.get('/api/v1/senders', {
      params: { ...filters, cursor: pageParam, limit: 50 },
    }),
    initialPageParam: undefined,
    getNextPageParam: (lastPage) =>
      lastPage.meta?.pagination?.nextCursor ?? undefined,
  });
}
```

Every infinite-list hook follows this exact shape. The hook never
inspects cursor contents.

---

**Admin/static dataset carve-out:**

For admin-only datasets that are small and static (e.g.,
`/api/v1/admin/feature-flags`, `/api/v1/admin/audit-events`,
`/api/v1/admin/users`), offset pagination via `?page=N&pageSize=20`
is allowed when:

- Documented in an ADR in `/docs/adr/`
- Controller marked with `@AdminOnly()` decorator
- Not consumed by any product-facing TanStack Query hook
- Result set size guaranteed bounded (< 10k rows total)

This preserves "jump to page 47" admin UX without polluting the
product API surface. Architecture Guardian verifies the carve-out
conditions.

---

**Backend implementation (NestJS pattern per D201):**

Shared pagination utility in `packages/shared/utils/cursor-pagination.ts`:

```typescript
export function buildCursorQuery<TRow>(opts: {
  baseQuery: PgSelect,
  sortKey: string,
  sortDir: 'asc' | 'desc',
  cursor?: string,
  limit: number,
  maxLimit: number,
  filtersHash: string,
}): { rows: TRow[], nextCursor: string | null, hasMore: boolean };
```

Each feature's `queries.ts` file uses this util. No per-feature
reinvention of WHERE clauses for cursor continuation.

---

**Hard rules (Architecture Guardian rejects):**

- ❌ Endpoint returns raw data array without envelope.
- ❌ List endpoint uses offset/limit without ADR + `@AdminOnly()` tag.
- ❌ Cursor encoding/decoding done outside
  `packages/shared/contracts/cursor.ts`.
- ❌ Client code (TanStack Query hook) parses or constructs cursor.
- ❌ Cursor passed in HTTP header instead of query param.
- ❌ Cursor payload not HMAC-signed.

---

**CLAUDE.md addition (when Topic 32 lands):**

```markdown
## API envelope + pagination rule (D202)

- Every endpoint returns `{ data, meta }`.
- Every list endpoint uses cursor pagination via meta.pagination.
- Cursors are opaque, HMAC-signed, 24h-expiring base64 payloads.
- Encode/decode only via packages/shared/contracts/cursor.ts.
- Offset pagination forbidden for product-facing APIs (ADR exception
  required for admin-only static datasets).
- TanStack Query consumers use useInfiniteQuery + getNextPageParam.
```

---

**Endpoints affected (concrete list):**

Cursor-paginated (`GET` list endpoints):
- `/api/v1/senders`
- `/api/v1/senders/:senderKey/activity`
- `/api/v1/activity` (heaviest — Activity log)
- `/api/v1/followups`
- `/api/v1/snoozed`
- `/api/v1/screener`
- `/api/v1/autopilot/rules/:id/runs` (rule execution history)

Envelope-only (no pagination — single resource or bounded small list):
- `/api/v1/senders/:senderKey` (single)
- `/api/v1/senders/:senderKey/timeseries` (12 months, bounded)
- `/api/v1/autopilot/rules` (bounded by tier — Free/Plus/Pro caps)
- `/api/v1/triage/queue` (max 12 per D30)
- `/api/v1/brief/:date` (snapshot, bounded)
- All `POST` / `PATCH` / `DELETE` (no pagination, envelope with requestId)

---

**Affects (cross-references):**

- D153 (REST + Zod): envelope schema declared in
  `packages/shared/contracts/api-envelope.ts`; Zod validates outbound
  responses in tests.
- D168 (error envelope): success `meta.requestId` ↔ error
  `correlationId` ↔ `displayId` — single correlation chain.
- D200 (TanStack Query): `useInfiniteQuery` hooks use cursor pagination
  uniformly across all features.
- D156 (rate limiting): rate-limit response headers (`Retry-After`)
  coexist with envelope; not duplicated in body.
- D58 (Activity undo): Activity endpoint cursor-paginated; per-row
  `undo_expires_at` checked client-side from `data[].undo_expires_at`.

---

**Timeline impact:** ~1 day for cursor utility + HMAC signing setup.
Saves ~30 min compound time per list endpoint × ~7 list endpoints ≈
3-4 hours plus avoids the agent-drift cost of each endpoint inventing
its own pagination.

---

### D203 — BaseDeclutrWorker: lifecycle-focused abstraction for all workers

**Decision:** All workers extend `BaseDeclutrWorker`. Base class owns
**lifecycle, observability, idempotency, error classification, dead-
letter behavior, and metrics**. Workers implement only
`processJob(payload, ctx)` and select a named `WorkerPolicy`.

**Core principle:** *"Standardize behavior. Do not centralize domain
knowledge."*

The base class never knows about Gmail labels, sender rules, brief
generation, billing, or any other feature concept. It runs the
lifecycle; subclasses do the work.

---

**Architecture:**

```typescript
// packages/shared/workers/base-declutr-worker.ts

export abstract class BaseDeclutrWorker<TPayload, TResult> extends WorkerHost {
  // Subclasses implement these:
  abstract processJob(payload: TPayload, ctx: WorkerContext): Promise<TResult>;
  abstract get policy(): WorkerPolicy;
  
  // Optional override for side-effect-sensitive workers:
  protected getIdempotencyKey?(payload: TPayload): string;
  
  // Optional override for long-running jobs (Gmail sync, stats regen):
  protected supportsCheckpointing?: boolean;
  protected loadCheckpoint?(jobId: string): Promise<Checkpoint | null>;
  protected saveCheckpoint?(jobId: string, checkpoint: Checkpoint): Promise<void>;
  
  // Sealed lifecycle (subclasses cannot override):
  async process(job: Job): Promise<TResult> {
    // 1. Build WorkerContext from job + AsyncLocalStorage
    // 2. Idempotency check (if getIdempotencyKey defined)
    // 3. Load checkpoint (if supportsCheckpointing)
    // 4. Emit worker.started event
    // 5. Try processJob(payload, ctx) inside timeout (from policy)
    // 6. On success: emit worker.succeeded, return result
    // 7. On error: classify error, decide retry/dead-letter, emit events
    // 8. On retry exhaustion: dead-letter record with full payload, error, replayable flag
    // 9. Sanitize all logs (apply forbidden-fields filter)
    // 10. Capture to Sentry with worker name + correlation ID tags
  }
}
```

**WorkerContext type (uniform across all workers):**

```typescript
// packages/shared/workers/worker-context.ts

export type WorkerContext = {
  jobId: string;
  workerName: string;
  correlationId: string;       // propagated from API → outbox → worker
  userId?: string;             // when known (most workers run per-mailbox)
  workspaceId?: string;
  mailboxAccountId?: string;
  connectionId?: string;       // for OAuth-sensitive workers
  attempt: number;
  maxAttempts: number;
  startedAt: Date;
  policy: WorkerPolicy;
};
```

Correlation ID propagation uses `AsyncLocalStorage` so any logger or
adapter call inside the worker automatically carries context.

---

**Error classification (separate from retry policy):**

```typescript
// packages/shared/workers/worker-errors.ts

export class TransientError extends Error {}              // retry
export class RateLimitError extends Error {                // retry with Retry-After
  constructor(message: string, public retryAfterMs?: number) { super(message); }
}
export class AuthExpiredError extends Error {}             // try token refresh, then retry
export class InvalidGrantError extends Error {}            // do not retry; mark connection needs_reconnect
export class ValidationError extends Error {}              // do not retry
export class PoisonJobError extends Error {}               // dead-letter immediately
export class ProviderPermissionError extends Error {}      // pause connection + notify user
```

Base class catches these specific types and applies the right action.
Any other error → treated as `TransientError` with the current retry
policy (safe default).

---

**Named WorkerPolicies (start small, expand only with ADR):**

```typescript
// packages/shared/workers/worker-policies.ts

export const WORKER_POLICIES = {
  standard: {
    maxAttempts: 5,
    backoff: { type: 'exponential', minMs: 1000, maxMs: 30_000, jitter: true },
    timeoutMs: 60_000,
    deadLetterOnExhaustion: true,
  },
  gmailApi: {
    maxAttempts: 5,
    backoff: { type: 'exponential', minMs: 2000, maxMs: 120_000, jitter: true },
    timeoutMs: 120_000,           // per user guidance
    respectRetryAfterHeader: true,
    deadLetterOnExhaustion: true,
  },
  criticalAudit: {
    maxAttempts: 8,                // Activity log writes — must succeed
    backoff: { type: 'exponential', minMs: 1000, maxMs: 60_000, jitter: true },
    timeoutMs: 30_000,
    deadLetterOnExhaustion: false, // re-queue indefinitely; alert on stuck jobs
  },
  lowPriority: {
    maxAttempts: 3,
    backoff: { type: 'exponential', minMs: 5000, maxMs: 60_000, jitter: true },
    timeoutMs: 60_000,
    deadLetterOnExhaustion: true,
  },
  nonRetryable: {
    maxAttempts: 1,                // immediate dead-letter on first failure
    backoff: null,
    timeoutMs: 30_000,
    deadLetterOnExhaustion: true,
  },
} as const;

export type WorkerPolicy = keyof typeof WORKER_POLICIES;
```

**Adding new policies requires ADR.** Architecture Guardian rejects PRs
that define inline retry/backoff logic inside individual workers.

---

**Concurrency limits (BullMQ queue config, locked):**

```typescript
// packages/shared/workers/worker-concurrency.ts

export const QUEUE_CONCURRENCY = {
  global: 20,             // total concurrent jobs across all workers
  perUser: 2,             // max 2 jobs per user concurrently
  perMailbox: 1,          // max 1 job per mailbox concurrently
};
```

Per-mailbox=1 is critical: Gmail API has per-mailbox rate limits, and
concurrent `batchModify` calls on the same mailbox interfere. Especially
load-bearing for sync workers and action workers.

Implementation: BullMQ rate-limiter groups by `mailboxAccountId` from
`job.data.mailboxAccountId`. Workers must include this field in job
data (Architecture Guardian enforces via schema check).

---

**Idempotency integration (reuses D8 infrastructure):**

For workers that override `getIdempotencyKey()`, the base class:

1. Computes the key from payload (e.g.,
   `${operationId}:${gmailMessageId}` for action workers,
   `${mailboxAccountId}:${historyId}` for sync workers).
2. Checks idempotency store before invoking `processJob`.
3. Stores keyed on **D8's existing tables**:
   - Sync workers reuse `processed_history_id` per-mailbox cursor.
   - Sync workers reuse `pubsub_processed_messages` dedupe table.
   - Action workers use `action_operations.id` as the dedupe key
     (already exists per Doc 03 §9 — D157 references this).
   - LLM/Brief workers use a new `worker_idempotency_keys` table
     (id, key, worker_name, claimed_at, expires_at, result_hash;
     24h TTL with cleanup cron).

No parallel idempotency infrastructure. **D203 hooks into D8's
mechanism** rather than building a separate one.

---

**Dead-letter records (replayable when safe):**

```typescript
// packages/db/schema/dead-letter-jobs.ts

dead_letter_jobs (
  id uuid pk,
  worker_name text,
  job_id text,
  payload jsonb,              // full original job payload
  error_type text,            // TransientError | AuthExpiredError | etc.
  error_message text,         // sanitized
  attempts int,
  correlation_id text,
  failed_at timestamptz,
  replayable bool,            // false for ValidationError, PoisonJobError, InvalidGrantError
  replayed_at timestamptz,
  replayed_by_user_id uuid,   // admin who initiated replay
  resolved_at timestamptz
)
```

Admin UI (`/admin/dead-letter`) shows the queue with replay/dismiss
actions. Replayable jobs re-enqueue with original payload + reset
attempts. Non-replayable jobs require manual intervention (e.g.,
`InvalidGrantError` → user reconnects OAuth before any replay is safe).

---

**Standardized worker events (uniform shape):**

Every worker emits these to PostHog + structured logs:

```typescript
type WorkerEvent =
  | 'worker.started'
  | 'worker.succeeded'
  | 'worker.failed'
  | 'worker.skipped'           // idempotency hit
  | 'worker.dead_lettered'
  | 'worker.retried'
  | 'worker.checkpointed';     // for long-running jobs

type WorkerEventPayload = {
  workerName: string;
  jobId: string;
  userId?: string;
  workspaceId?: string;
  mailboxAccountId?: string;
  correlationId: string;
  durationMs: number;
  attempt: number;
  errorType?: string;           // on failed/dead_lettered
  policyName: WorkerPolicy;
};
```

Sentry, Cloud Logging, PostHog dashboards all consume the same event
shape. Support debugging is one query against `worker.*` events.

---

**Checkpointing (opt-in for long-running workers):**

```typescript
type Checkpoint = {
  jobId: string;
  phase: string;                // worker-defined enum (e.g., 'fetching_history', 'computing_stats')
  cursor?: string;
  processedCount: number;
  lastMessageInternalDate?: string;
  updatedAt: Date;
};
```

Workers that opt in (`supportsCheckpointing = true`) implement
`loadCheckpoint` and `saveCheckpoint`. Base class loads checkpoint at
start, passes phase/cursor to `processJob`. Workers call
`this.saveCheckpoint()` after each batch.

**Workers that benefit from checkpointing at launch:**
- `InitialSyncWorker` (Gmail mailboxes 50k-250k messages)
- `HistorySyncWorker` (large incremental syncs)
- `StatsGenerationWorker` (full mailbox stat rebuild)

Other workers are short-lived; no checkpoint overhead.

---

**Timeout protection:**

Every worker has `policy.timeoutMs`. Base class wraps `processJob` in
`Promise.race()` with a timeout. On timeout:

- Emit `worker.failed` with `errorType: 'TimeoutError'`
- If `supportsCheckpointing`, save checkpoint of current progress
- Re-queue with attempt+1 (retry from checkpoint if applicable)
- After `maxAttempts`, dead-letter with `replayable: true` (timeouts
  are usually transient infrastructure issues)

---

**Sanitized logging (explicit forbidden + allowed lists):**

**Forbidden in any log line:**
- OAuth tokens (raw, encrypted, or partial)
- User email addresses (use `userId` ULID instead)
- Full sender email addresses (use `sender_key` hash; `sender_domain`
  is OK)
- Message snippets, subjects, body text, headers
- Attachment data, MIME content
- Cookie values, JWT contents
- Stripe/Paddle/Razorpay raw webhook payloads (use event IDs)

**Allowed:**
- ULIDs/UUIDs (`userId`, `workspaceId`, `mailboxAccountId`,
  `sender_key`, `operation_id`, `correlation_id`)
- Counts (`processedCount: 1247`)
- Durations (`durationMs: 3421`)
- Sender domain (`sender_domain: notion.so`)
- Worker name, policy name, event type
- Error type (sanitized error message — no payload data)

**Implementation:** base class wraps the logger with a sanitizer that
recursively strips forbidden field names from any logged object.
Sanitizer rules in `packages/shared/workers/log-sanitizer.ts`.

---

**Mandatory tests for the base class** (CI gate, never skip):

- Success path
- Retryable error → retry → success
- Non-retryable error → no retry → dead-letter (with `replayable=false`)
- `RateLimitError` → respects `retryAfterMs`
- `AuthExpiredError` → token refresh attempted before retry
- `InvalidGrantError` → connection marked `needs_reconnect`, no retry
- Idempotency hit → `worker.skipped` emitted, no `processJob` call
- Dead-letter on attempt exhaustion → record created with full payload
- `criticalAudit` policy → does NOT dead-letter, re-queues indefinitely
- Sentry called exactly once per failure (no double-capture)
- Correlation ID propagated through AsyncLocalStorage to inner
  adapter calls
- Sanitized logs contain only allowed fields
- Custom policy override raises Architecture Guardian rejection
- Timeout fires, checkpoint saved (for checkpointing workers)
- WorkerContext fields populated correctly

---

**Worker concurrency vs D5 throttling:**

D5 specified BullMQ rate-limiter with `concurrency=1` per mailbox
account + `global=50` for initial sync. **D203's QUEUE_CONCURRENCY
supersedes the numerical values** (perMailbox=1, global=20 — lower
than D5's 50 because D5 was sync-specific; now applies across all
workers). D5's logical intent preserved; numbers tightened for
multi-worker reality.

---

**Affects (concrete cross-references):**

- D157 (worker list): all 18+ workers now extend BaseDeclutrWorker.
  Schedule retroactive PR after base class lands.
- D5 (Gmail throttling): D203's `gmailApi` policy + `perMailbox=1`
  concurrency replace D5's inline rate-limiter spec.
- D8 (Pub/Sub idempotency): base class's idempotency check reuses D8's
  tables, not parallel ones.
- D157 (dead-letter): D203 defines the `dead_letter_jobs` table and
  replay UX.
- D159 (Sentry + PostHog): all worker events emit to both via base
  class, never per-worker.
- D169 (severity tiers): worker errors map to severity tiers via the
  error-class taxonomy (TransientError = silent_transient,
  InvalidGrantError = critical_trust, etc.).

---

**Forbidden patterns (Architecture Guardian rejects):**

- ❌ Worker that doesn't extend `BaseDeclutrWorker`
- ❌ Inline retry/backoff logic inside `processJob`
- ❌ Per-worker Sentry capture call (base class owns this)
- ❌ Direct logger import (use injected sanitized logger)
- ❌ Custom policy defined inline (must use named policies from
  WORKER_POLICIES, or ADR-add a new one)
- ❌ Domain knowledge inside base class (Gmail labels, sender keys,
  billing rules — must live in subclass)
- ❌ Skipping idempotency check for action/sync workers
- ❌ Logging forbidden fields (sanitizer is a safety net; agents must
  not rely on it as a primary defense)

---

**CLAUDE.md addition (when Topic 32 lands):**

```markdown
## Worker rule (D203)

- All workers extend BaseDeclutrWorker.
- Workers implement processJob(payload, ctx) + select a named
  WorkerPolicy (standard, gmailApi, criticalAudit, lowPriority,
  nonRetryable).
- No inline retry/backoff logic; no per-worker Sentry; no custom
  policies (ADR required).
- Idempotency via getIdempotencyKey() — reuses D8 tables.
- Long-running workers opt into checkpointing.
- Forbidden in logs: tokens, user emails, sender emails, message
  content, headers. Allowed: ULIDs, counts, durations, sender_domain.
- Domain knowledge belongs in the subclass, never in the base.
```

---

**Timeline impact:** ~1-2 weeks of dedicated PR work for the base
class + tests + dead-letter table + replay UI. **Pays back within the
first 3 workers built** — each subsequent worker ships in ~half the
time of building from scratch. Net positive by Worker #4.

This is foundation infrastructure; treated like production infra, not
convenience code (per user's spec).

---

### D204 — Read-only services per feature + events for cross-feature writes (refines D201)

**Decision:** Each feature module exports a public `{Feature}ReadModule`
containing a read-only `{Feature}ReadService`. Other features inject
the read service via NestJS DI for **reads only**. Writes stay private
to the owning feature; cross-feature writes flow via events (outbox
per D13).

**Refines D201's** "cross-feature service injection forbidden" rule by
carving out reads explicitly. Reads are safe (no side effects); writes
are not.

---

**Per-feature module structure (locked):**

```
apps/api/src/features/senders/
├── senders.module.ts            # INTERNAL: full service + queries + controllers
├── senders.service.ts           # PRIVATE: business logic, writes
├── senders.queries.ts           # PRIVATE: full Drizzle queries (reads + writes)
├── senders.controller.ts        # PRIVATE: HTTP routes
│
├── senders.read.module.ts       # PUBLIC: exposes only SendersReadService
├── senders.read.service.ts      # PUBLIC: read-only methods
└── senders.read.queries.ts      # PUBLIC: read-only Drizzle queries
```

The **read module is the public API** of the feature. Other features
only import the read module. Internal services and write queries stay
in the main module, not exported.

**SendersReadService example:**

```typescript
@Injectable()
export class SendersReadService {
  constructor(private readonly queries: SendersReadQueries) {}
  
  async getSenderDetail(senderKey: string, ctx: AuthContext): Promise<SenderDetail | null>;
  async listTopSenders(mailboxAccountId: string, limit: number): Promise<Sender[]>;
  async getSenderStats(senderKey: string): Promise<SenderStats | null>;
  
  // NO write methods. No markVip, no updatePolicy, no insertProfile.
}
```

**Cross-feature consumer example:**

```typescript
// apps/api/src/features/triage/triage.module.ts
@Module({
  imports: [SendersReadModule, ActivityReadModule],   // public read modules of other features
  providers: [TriageService, TriageQueries],
  controllers: [TriageController],
})
export class TriageModule {}

// apps/api/src/features/triage/triage.service.ts
@Injectable()
export class TriageService {
  constructor(
    private readonly queries: TriageQueries,                  // own private queries
    private readonly sendersRead: SendersReadService,         // cross-feature read
    private readonly activityRead: ActivityReadService,       // cross-feature read
    @Inject('OutboxEmitter') private readonly outbox: OutboxEmitter,
  ) {}
  
  async applyVerdict(input: ApplyVerdictInput): Promise<ActionOperation> {
    const sender = await this.sendersRead.getSenderDetail(input.senderKey);
    if (!sender) throw new ValidationError('sender_not_found');
    
    // Triage owns the operation row
    const op = await this.queries.insertActionOperation(input);
    
    // Cross-feature WRITE goes through outbox event, not direct service call
    await this.outbox.emit('verdict_applied', {
      operationId: op.id,
      mailboxAccountId: input.mailboxAccountId,
      senderKey: input.senderKey,
      verdict: input.verdict,
      ...
    });
    
    return op;
  }
}
```

Downstream features consume the event via their own workers:

```typescript
class SenderPolicyUpdaterWorker extends BaseDeclutrWorker<VerdictAppliedEvent, void> {
  policy = WORKER_POLICIES.standard;
  async processJob(payload, ctx) {
    await this.queries.updateSenderPolicy(payload);
  }
}

class ActivityRecorderWorker extends BaseDeclutrWorker<VerdictAppliedEvent, void> {
  policy = WORKER_POLICIES.criticalAudit;
  async processJob(payload, ctx) {
    await this.queries.insertActivityRow(payload);
  }
}
```

---

**Pattern summary table:**

| Operation type | Mechanism | Module visibility |
|---|---|---|
| Same-feature read | Direct service call | Private (`{Feature}Module`) |
| Same-feature write | Direct service call | Private (`{Feature}Module`) |
| Cross-feature read | `{Feature}ReadService` via DI | **Public (`{Feature}ReadModule`)** |
| Cross-feature write | Event via outbox (D13) | Public (event contract in `packages/shared/contracts/events/`) |

---

**Event contracts (in `packages/shared/contracts/events/`):**

```typescript
// packages/shared/contracts/events/verdict-applied.ts
export type VerdictAppliedEvent = {
  operationId: string;
  mailboxAccountId: string;
  senderKey: string;
  verdict: 'keep' | 'archive' | 'unsubscribe' | 'later';
  appliedAt: string;
  userId: string;
  correlationId: string;
};
```

All cross-feature events as typed Zod schemas. Outbox topic names
follow `{feature}.{noun}_{past_participle}` convention (e.g.,
`triage.verdict_applied`, `autopilot.rule_fired`,
`sync.history_processed`).

---

**Hard rules (Architecture Guardian rejects):**

- ❌ Importing `{Feature}Module` from another feature (only
  `{Feature}ReadModule` is importable across features)
- ❌ Read service with ANY write method (no `markVip()`, no
  `updatePolicy()`, no `insertX()`)
- ❌ Read service injecting another feature's write service (must
  inject ReadService instead)
- ❌ Read service that mutates DB (verified by SQL audit in CI —
  ReadService queries must be `SELECT`-only)
- ❌ Direct Drizzle query against a table owned by another feature
  (e.g., TriageQueries running `select from sender_profiles` →
  reject; must go through SendersReadService)
- ❌ Cross-feature write via direct service call (must be event)
- ❌ Event contract defined outside `packages/shared/contracts/events/`
- ❌ Cross-feature service injection in workers — same rule applies
  (workers use ReadServices for reads, events for writes)

---

**Why this over alternatives:**

- **vs centralized read-models layer:** Avoids the god-folder where
  one directory knows every feature's schema. Each feature owns its
  reads; consumers see a clean contract.
- **vs allowing all cross-feature injection:** Preserves D201's
  anti-coupling intent — writes are gated; only reads are shared.
- **vs pure event-driven:** Avoids latency overhead and debugging
  complexity for reads, which don't need the eventual-consistency
  semantics events provide.

---

**Read services that probably ship at launch:**

| Read service | Consumers |
|---|---|
| `SendersReadService` | Triage, Activity, Brief, Autopilot, Screener, Followups, Snoozed |
| `ActivityReadService` | Senders (decision history per D46), Triage (undo per D35) |
| `AutopilotReadService` | Activity (rule context per D57), Triage (preset indicators) |
| `BillingReadService` | Settings (current plan card), AdminUI (cohort analytics) |
| `WorkspaceReadService` | Almost every feature (tier check for D188 flags) |
| `UserReadService` | Settings, Notifications, Sessions |

---

**CLAUDE.md addition (when Topic 32 lands):**

```markdown
## Cross-feature data sharing rule (D204)

- Each feature exports a {Feature}ReadModule with a read-only
  {Feature}ReadService.
- Cross-feature READs: inject {Feature}ReadService via NestJS DI.
- Cross-feature WRITEs: emit event via outbox (D13); the other
  feature's worker handles it.
- Forbidden: importing {Feature}Module from another feature, direct
  cross-feature service injection for writes, direct Drizzle queries
  against another feature's tables, read services with write methods.
- Event contracts in packages/shared/contracts/events/.
```

---

**Updates D201:** the "shared module or via events" phrasing in D201
is now specified — the ReadModule pattern IS the "shared module."
Events handle writes.

**Affects:**

- D13 (outbox): cross-feature writes flow through outbox; topic
  naming convention defined here.
- D157 (workers): many workers become event consumers (e.g.,
  `SenderPolicyUpdaterWorker` consumes `triage.verdict_applied`).
- D203 (BaseDeclutrWorker): event-consuming workers are still
  workers; same base class, same patterns.

---

**Timeline impact:** ~1 day per feature to set up ReadModule
boilerplate. Pays back as soon as the 2nd feature needs cross-feature
data (every product feature will).

---

### D205 — 4-module auth structure + AuthSignupOrchestrator exception (refines D155, D204)

**Decision:** Four NestJS modules for identity-shaped concerns. AuthModule
has **one documented exception** to D204: it may coordinate cross-module
writes during first-time signup orchestration. All other cross-module
writes follow D204 (events via outbox).

| Module | Owns |
|---|---|
| **AuthModule** | Sessions (D155), guards (JwtGuard, CsrfGuard, RoleGuard), OAuth callbacks, **first-time signup orchestration (the exception)** |
| **UsersModule** | User entity, preferences, devPreferences (D111), notification settings, export-my-data (D116) |
| **WorkspacesModule** | Workspace entity, membership (workspace_users), tier context, billing-region setting (consumed by Billing for Paddle vs Razorpay routing) |
| **MailboxAccountsModule** | Gmail/Outlook connections, encrypted OAuth token storage (via `KmsProvider` adapter from D14), sync state, account-kind tags (personal/work/founder per D115), Pub/Sub watch lifecycle, disconnect/delete operations (D116) |

---

**The signup exception (what AuthModule is allowed to do that no other module can):**

```typescript
// apps/api/src/features/auth/auth-signup-orchestrator.service.ts

@Injectable()
export class AuthSignupOrchestrator {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    @Inject('GoogleOAuthAdapter') private readonly googleOAuth: GoogleOAuthAdapter,
    // ⚠️ Exception: direct service injection across features for orchestration
    private readonly usersService: UsersService,
    private readonly workspacesService: WorkspacesService,
    private readonly mailboxAccountsService: MailboxAccountsService,
    private readonly sessionsService: SessionsService,
  ) {}

  async signInWithGoogleCallback(code: string, ctx: RequestContext): Promise<Session> {
    return this.unitOfWork.transaction(async (tx) => {
      const googleIdentity = await this.googleOAuth.exchangeCode(code);

      // Each service is idempotent via unique constraints (see below)
      const user = await this.usersService.findOrCreateFromGoogle(googleIdentity, tx);
      const workspace = await this.workspacesService.findOrCreateDefaultWorkspace(user.id, tx);
      const mailbox = await this.mailboxAccountsService.findOrCreateGoogleMailbox({
        userId: user.id,
        workspaceId: workspace.id,
        googleIdentity,  // includes OAuth tokens; MailboxAccountsService encrypts via KmsProvider before persist
      }, tx);

      return this.sessionsService.createSession({ user, workspace, mailbox }, tx);
    });
  }
}
```

**Auth coordinates; domain ownership stays with each feature.** AuthModule never writes directly to `users`, `workspaces`, `workspace_users`, or `mailbox_accounts` tables. It calls the owning service.

---

**UnitOfWork pattern (new primitive, also used by other multi-feature flows):**

```typescript
// packages/shared/db/unit-of-work.ts

export interface UnitOfWork {
  transaction<T>(fn: (tx: DbTransaction) => Promise<T>): Promise<T>;
}

// apps/api/src/infrastructure/db/unit-of-work.drizzle.ts
@Injectable()
export class DrizzleUnitOfWork implements UnitOfWork {
  constructor(@Inject('DB') private readonly db: DrizzleDb) {}
  async transaction<T>(fn: (tx: DbTransaction) => Promise<T>): Promise<T> {
    return this.db.transaction(fn);  // Drizzle's native transaction wrapper
  }
}
```

**Service methods accept an optional `tx` parameter:**

```typescript
@Injectable()
export class UsersService {
  async findOrCreateFromGoogle(identity: GoogleIdentity, tx?: DbTransaction): Promise<User> {
    const db = tx ?? this.defaultDb;
    // upsert against users.email unique constraint
  }
}
```

When called without `tx`, the service uses the default DB connection. When called inside a UnitOfWork, all writes participate in the same transaction.

**Other places `UnitOfWork` is the right tool** (not events):

- **Billing webhook (D195):** subscription change + workspace tier flip + feature_flags update must be atomic and visible immediately (Pro features unlock the instant the user returns from checkout).
- **Account deletion (D116):** wipe all rows across `users`, `workspaces`, `workspace_users`, `mailbox_accounts`, `mail_messages`, `sender_profiles`, `activity_log` in one go.
- **Multi-account connect (D115):** add new MailboxAccount + initial SyncState + grant default workspace permissions atomically.

**Criterion (locked in this decision):**

> **Use `UnitOfWork` when**: the cross-feature write must be visible to the user immediately after the originating request returns, AND must be all-or-nothing.
>
> **Use events (D204) when**: eventual consistency is acceptable (≤ seconds delay), AND failure of downstream write doesn't block the user-facing flow.

---

**Idempotency via unique constraints (locked):**

Every signup-flow entity has a unique constraint that makes the find-or-create idempotent under retry:

| Table | Unique constraint | Purpose |
|---|---|---|
| `users` | `(email)` | Same Google account → same user |
| `mailbox_accounts` | `(provider, provider_account_id)` | Same Google mailbox → same account; prevents duplicate connection |
| `workspace_users` | `(workspace_id, user_id)` | Same membership row only once |
| `provider_connections` | `(mailbox_account_id)` | One OAuth connection per mailbox |

Retried OAuth callbacks (Google sends duplicates; users double-click) hit upsert paths that no-op cleanly.

---

**Atomicity guarantee:**

The full signup transaction succeeds or rolls back entirely. Forbidden intermediate states:

- ❌ User created without default workspace
- ❌ Workspace created without owner membership
- ❌ MailboxAccount created without encrypted OAuth tokens stored
- ❌ Session issued before all entities exist

If any step fails, the transaction rolls back and the user lands on a clean retry page ("Sign-in failed. Try again." with the error tied to a Sentry trace).

---

**KMS encryption boundary (preserves D14):**

OAuth tokens (refresh + access) MUST be encrypted via `KmsProvider` (D14 envelope encryption) **inside `MailboxAccountsService`** before any DB write. Forbidden:

- ❌ AuthModule storing raw OAuth tokens anywhere
- ❌ MailboxAccountsService persisting unencrypted tokens
- ❌ Encryption happening in a controller or in transit through Auth

`MailboxAccountsService.findOrCreateGoogleMailbox()` is the **only** code path that touches raw OAuth tokens; it immediately encrypts via the injected `KmsProvider` and stores the ciphertext + wrapped DEK.

---

**Golden tests (must pass at launch, CI gate):**

1. **New Google user signup happy path** — verifies user + workspace + workspace_users + mailbox_account + encrypted OAuth tokens + session all created, response returns valid session cookies.
2. **Retry idempotency** — same OAuth callback fires twice; assert no duplicate user, no duplicate workspace, no duplicate workspace_users, no duplicate mailbox_account, no duplicate session (same session returned).
3. **Partial-failure rollback** — inject failure at `mailboxAccountsService.findOrCreateGoogleMailbox()`; assert user + workspace creation rolled back; no orphan rows.
4. **Multi-account connect** — existing user with workspace adds a second Gmail; assert new MailboxAccount created, existing user/workspace untouched, new SyncState initialized.
5. **KMS failure** — inject KMS encrypt failure; assert full transaction rolls back; no plaintext token ever persisted.

---

**Forbidden patterns (Architecture Guardian rejects):**

- ❌ Cross-module write injection outside AuthSignupOrchestrator (the one carve-out)
- ❌ AuthModule importing any non-Auth service for non-signup flows
- ❌ Direct DB writes from AuthModule to `users`, `workspaces`, `workspace_users`, or `mailbox_accounts`
- ❌ Storing raw OAuth tokens (anywhere — must go through KmsProvider in MailboxAccountsService)
- ❌ Service write methods that don't accept optional `tx` parameter (breaks UnitOfWork composability)
- ❌ `UnitOfWork.transaction()` calls outside the documented orchestrators (signup, billing webhook, account deletion, etc. — must be ADR-listed)
- ❌ Folding MailboxAccounts into Workspaces (the rejected option)

---

**Read services exposed by these modules (per D204):**

| Module | ReadService methods |
|---|---|
| `UsersReadService` | `getUser(userId)`, `getPreferences(userId)`, `getDevPreferences(userId)` |
| `WorkspacesReadService` | `getWorkspace(workspaceId)`, `getUserWorkspaces(userId)`, `getTier(workspaceId)`, `getBillingRegion(workspaceId)` |
| `MailboxAccountsReadService` | `getMailboxAccount(id)`, `listForWorkspace(workspaceId)`, `getSyncStatus(id)`, `getConnectionHealth(id)` |
| `AuthReadService` (limited) | `getActiveSessions(userId)`, `getSessionByToken(token)` (for guards) |

---

**Updates D155:** Auth mechanism is unchanged. What's added: module boundaries + signup orchestration pattern + UnitOfWork primitive.

**Updates D204:** AuthSignupOrchestrator is the one documented carve-out from "no cross-feature write injection." Listed here for audit.

**Affects:**

- D14 (KMS envelope): encryption boundary now explicit in MailboxAccountsService.
- D106-D113 (Onboarding): Step 2 (Connect) hits `AuthSignupOrchestrator.signInWithGoogleCallback()`.
- D115 (Inboxes management): multi-account connect uses `MailboxAccountsService` directly (not via Auth), since the user already exists.
- D116 (Privacy & Data): "Delete account" uses UnitOfWork pattern to wipe across all four modules atomically.
- D117/D195 (Billing): billing webhook uses UnitOfWork to flip tier + feature_flags + subscriptions atomically.
- D157 (workers): `WatchRenewalWorker` and `InitialSyncWorker` operate on MailboxAccount entities owned by MailboxAccountsModule.

---

**CLAUDE.md addition (when Topic 32 lands):**

```markdown
## Auth + identity rule (D205)

- 4 modules: AuthModule, UsersModule, WorkspacesModule, MailboxAccountsModule.
- AuthModule has ONE carve-out from D204: AuthSignupOrchestrator may
  coordinate cross-module writes during first-time signup.
- All other cross-module writes follow D204 (events via outbox).
- UnitOfWork pattern (packages/shared/db/unit-of-work.ts) for atomic
  multi-feature transactions: signup, billing webhook, account
  deletion, multi-account connect.
- Service write methods accept optional tx parameter.
- OAuth tokens encrypted via KmsProvider inside MailboxAccountsService
  only — never in AuthModule.
- Idempotency via unique constraints (users.email, mailbox_accounts.
  provider+provider_account_id, workspace_users.workspace_id+user_id).
- Golden tests: new signup happy path, retry idempotency,
  partial-failure rollback, multi-account connect, KMS failure.
```

---

**Timeline impact:** ~3-4 days for the 4 modules + AuthSignupOrchestrator + UnitOfWork primitive + golden tests. Pays back the moment a second multi-feature transaction flow lands (billing webhook within Week 1 of billing PRs).

---

### D206 — Per-layer test templates + shared harnesses (refines D182, D183, D184)

**Decision:** Ship a complete testing infrastructure in
`packages/shared/testing/` consisting of (a) copyable per-layer test
templates and (b) shared harnesses for load-bearing test concerns.
Each template paired with a real-example test file so agents learn
from both.

**Refines D182** (framework: Vitest + testcontainers + Playwright)
**+ D183** (MockGmailProvider + recorded fixtures)
**+ D184** (risk-weighted 70% floor on shared/db).

---

**Directory structure (locked):**

```
packages/shared/testing/
├── templates/
│   ├── controller.test.template.ts
│   ├── service.test.template.ts
│   ├── queries.test.template.ts          # repository/query layer
│   ├── worker.test.template.ts
│   ├── react-hook.test.template.tsx
│   ├── zustand-store.test.template.ts
│   ├── component.test.template.tsx
│   └── e2e.spec.template.ts
│
├── harnesses/
│   ├── create-test-app.ts                 # NestJS Test.createTestingModule bootstrap
│   ├── create-test-db.ts                  # testcontainers Postgres + Drizzle migration
│   ├── create-mock-gmail-client.ts        # implements MailProviderAdapter (D183)
│   ├── create-mock-billing-providers.ts   # Paddle + Razorpay mocks
│   ├── create-mock-kms.ts                 # KmsProvider mock
│   ├── create-mock-queue.ts               # BullMQ test queue
│   ├── create-worker-harness.ts           # BaseDeclutrWorker lifecycle harness
│   ├── create-test-query-client.ts        # TanStack Query test client (no retries, no cache TTL)
│   ├── render-with-providers.tsx          # React render wrapped with Query + Zustand + Router
│   ├── msw-server.ts                      # MSW server with standard envelope responses
│   ├── msw-handlers/                      # per-feature handler factories
│   │   ├── senders.handlers.ts
│   │   ├── activity.handlers.ts
│   │   └── ...
│   └── unit-of-work-harness.ts            # in-memory or rolled-back transaction wrapper
│
├── factories/                             # typed test data factories (Faker-backed)
│   ├── user.factory.ts
│   ├── workspace.factory.ts
│   ├── mailbox-account.factory.ts
│   ├── sender-profile.factory.ts
│   ├── sender-recommendation.factory.ts
│   ├── activity-log.factory.ts
│   ├── action-operation.factory.ts
│   └── automation-rule.factory.ts
│
└── examples/                              # real-example tests paired with each template
    ├── senders-controller.example.test.ts
    ├── senders-service.example.test.ts
    ├── senders-queries.example.test.ts
    ├── recommendation-worker.example.test.ts
    ├── use-senders-hook.example.test.tsx
    ├── triage-store.example.test.ts
    ├── triage-row.example.test.tsx
    └── triage-e2e.example.spec.ts
```

---

**Critical harnesses (must exist before any feature PR ships):**

### 1. BaseDeclutrWorker lifecycle harness

Tests the D203 base class lifecycle **once**:
- Success path
- Retryable failure → retry → success
- Non-retryable failure → dead-letter (`replayable: false`)
- `RateLimitError` → respects `retryAfterMs`
- `AuthExpiredError` → token refresh attempted before retry
- `InvalidGrantError` → connection marked `needs_reconnect`
- Idempotency hit → `worker.skipped` emitted
- Sentry capture exactly once per failure
- Correlation ID propagated through AsyncLocalStorage
- Sanitized logs contain only allowed fields (D203 list)

**Per-worker tests inherit from this harness; they only test
`processJob()` business logic.** This inverts the typical
under-test-base-over-test-leaf pattern.

### 2. TanStack Query mutation harness (optimistic update + rollback)

Tests for every mutation hook that does optimistic updates (action
tray D35, undo D58, bulk operations D52):
- Initial cache state
- Mutation success path (cache updates as expected)
- Optimistic UI update applied immediately
- Mutation failure → cache rolled back to initial
- Query invalidation triggered after success
- Toast/banner behavior per D169 severity tier

**These bugs are silent in production until a mutation errors
mid-undo-window.** Untested = inevitable production incident.

### 3. MSW handler factory using standard envelope

All frontend hook tests use MSW with handlers returning the D202
envelope:

```typescript
import { sendersHandlers } from '@declutrmail/testing/harnesses/msw-handlers/senders';

server.use(
  sendersHandlers.list({
    data: [/* sender objects */],
    meta: { pagination: { nextCursor: 'abc', hasMore: true, limit: 50 } }
  })
);
```

Handler factories enforce envelope shape — agents can't accidentally
return raw data from a mock. Keeps frontend tests aligned with D202.

### 4. Test DB with rolled-back transactions (performance optimization)

Naive testcontainers-per-test takes ~10s per test (container spin-up).
**Single testcontainer per Vitest worker, transaction-rolled-back per
test.** Each test runs inside a transaction that rolls back on
teardown:

```typescript
// packages/shared/testing/harnesses/create-test-db.ts

beforeEach(async () => {
  await db.execute('BEGIN');
});
afterEach(async () => {
  await db.execute('ROLLBACK');
});
```

100x faster than per-test container. Still covers unique constraints,
cursor pagination behavior, idempotency keys, workspace scoping, audit
inserts.

### 5. Typed test data factories (Faker-backed)

Each entity has a factory producing realistic, override-able test
data:

```typescript
import { senderProfileFactory } from '@declutrmail/testing/factories/sender-profile';

const sender = senderProfileFactory.create({
  monthly_volume: 47,
  read_rate: 0.02,
  // other fields filled with realistic defaults
});

// Batch creation
const senders = senderProfileFactory.createMany(5, { is_vip: true });

// DB-inserting variant
await senderProfileFactory.createInDb({ mailbox_account_id });
```

No more hand-crafted fixtures scattered across test files. Schema
changes update one factory, not 50 tests.

---

**Per-layer template summary:**

| Layer | Template focus | Harnesses used |
|---|---|---|
| Controller | Request/response envelope (D202), auth guards, validation, pagination params | `createTestApp`, `createMock*`, factories |
| Service | Business rules, transactions, idempotency, error classification | `createTestDb`, `createMock*Adapter`, factories |
| Queries | DB constraints, cursor pagination, filters, workspace scoping | `createTestDb`, factories |
| Worker | `processJob()` business logic only (base lifecycle covered by harness) | `createWorkerHarness`, `createMock*Adapter`, factories |
| React hook | TanStack Query behavior, cache invalidation, optimistic rollback | `createTestQueryClient`, `mswServer`, MSW handlers |
| Zustand store | Pure function tests (no React renderer needed) | none (pure unit) |
| Component | Loading/empty/error states, user flows, accessibility | `renderWithProviders`, `mswServer`, factories |
| E2E | Critical user flows (signup, connect Gmail, review senders, undo, Autopilot Observe) | Playwright + test Gmail account (D183) |

---

**Real-example pairing (locked):**

Every template ships with a corresponding real test in `examples/`:

| Template | Real example |
|---|---|
| `controller.test.template.ts` | `senders-controller.example.test.ts` |
| `service.test.template.ts` | `senders-service.example.test.ts` |
| `queries.test.template.ts` | `senders-queries.example.test.ts` |
| `worker.test.template.ts` | `recommendation-worker.example.test.ts` |
| `react-hook.test.template.tsx` | `use-senders-hook.example.test.tsx` |
| `zustand-store.test.template.ts` | `triage-store.example.test.ts` |
| `component.test.template.tsx` | `triage-row.example.test.tsx` |
| `e2e.spec.template.ts` | `triage-e2e.example.spec.ts` |

Agents learn from both: template = the shape; example = the realized
version with realistic assertions. Architecture Guardian rejects new
test files that obviously deviate from the closest template.

---

**Coverage gates (D184 enforcement mechanism):**

- `packages/shared/`: 70% line coverage, CI fails below.
- `packages/db/`: 70% line coverage, CI fails below.
- `apps/api/src/features/{feature}/`: per-feature 60% line floor; load-
  bearing modules (auth, billing, recommendation, action-execution)
  require 80%.
- `apps/web/src/features/{feature}/`: 50% (UI is covered by E2E).
- Workers: 75% (the lifecycle is harnessed once; per-worker logic
  must be tested).

---

**Forbidden patterns (Architecture Guardian rejects):**

- ❌ Test file that doesn't use the closest matching template's shape
- ❌ Worker test that re-tests BaseDeclutrWorker lifecycle (use harness)
- ❌ TanStack Query mutation test without optimistic-rollback assertion
  (for mutations that opt into optimistic updates)
- ❌ Backend query test that mocks Drizzle entirely (use testcontainers)
- ❌ MSW handler that returns raw data without D202 envelope
- ❌ Hand-crafted entity fixture inline (use factory)
- ❌ Test that creates DB rows without cleanup (use transaction rollback
  harness)

---

**CLAUDE.md addition (when Topic 32 lands):**

```markdown
## Testing rule (D206)

- Use the template matching your layer:
  packages/shared/testing/templates/{layer}.test.template.{ts,tsx}.
- Pair each template with the real example in
  packages/shared/testing/examples/ — read both.
- Use shared harnesses for: NestJS test app, test DB (rolled-back per
  test), mock providers, BaseDeclutrWorker lifecycle, TanStack Query
  test client, render with providers, MSW server.
- Use factories from packages/shared/testing/factories/ — never
  hand-craft entity fixtures.
- Worker tests: validate processJob() only; lifecycle is harnessed.
- Hook mutation tests: cover optimistic update + success + failure
  rollback + invalidation.
- Backend query tests: real DB (testcontainers via harness), not mocks.
- Coverage gates per the table above; CI fails below floor.
```

---

**Timeline impact:** ~1 week for the full testing infrastructure
(templates + harnesses + factories + real examples + CI coverage
config). **Pays back within the first 3 PRs** that consume the
templates — each subsequent feature ships tests ~2x faster with
~50% fewer test-related PR review cycles.

This is foundation infrastructure on the same tier as D203's
BaseDeclutrWorker. Treat as production infra.

**Affects:**

- D182 (Vitest + testcontainers + Playwright): D206 specifies HOW
  to use them per layer.
- D183 (MockGmailProvider): now lives in
  `harnesses/create-mock-gmail-client.ts` and implements
  `MailProviderAdapter` per D201.
- D184 (70% coverage floor): D206 makes the floor enforceable via
  per-layer coverage gates in CI.
- D203 (BaseDeclutrWorker): worker tests inherit from
  `create-worker-harness.ts`; lifecycle is tested once.
- D200 (TanStack Query + Zustand): hook tests use harness; store tests
  are pure functions.
- D202 (envelope): MSW handlers enforce envelope shape so frontend
  tests can't drift from API contract.
- D204 (read services + events): event-driven worker tests use the
  event contract types from `packages/shared/contracts/events/`.
- D205 (UnitOfWork): UnitOfWork harness lets multi-feature flow tests
  exercise atomicity without spinning up a real DB transaction.

---

# 🎯 Architecture Grill Session — locked decisions D198-D206

**9 architectural decisions** locked in this grilling session, covering:

| # | Topic | Outcome |
|---|---|---|
| D198 | Component reuse pattern | Headless hooks for behavior, feature-owned for rendering |
| D199 | Promotion criterion | Lazy promotion (≥2 actual consumers) + spec override |
| D200 | Frontend state management | TanStack Query (server) + Zustand (client) |
| D201 | Backend architecture | Standard NestJS modules + Adapter pattern at boundaries |
| D202 | API response envelope | Envelope + cursor pagination + opaque HMAC-signed cursors |
| D203 | Worker base class | BaseDeclutrWorker (lifecycle, observability, idempotency, dead-letter) |
| D204 | Cross-feature data sharing | Read-only services per feature + events for writes |
| D205 | Auth module structure | 4 modules + AuthSignupOrchestrator exception + UnitOfWork primitive |
| D206 | Test patterns | Per-layer templates + shared harnesses + factories + real examples |

**Cross-cutting infrastructure that resulted:**

- `packages/shared/hooks/` (D198)
- `packages/shared/components/` with promotion rule (D199)
- `packages/shared/contracts/` for adapter interfaces (D201)
- `packages/shared/contracts/api-envelope.ts` + `cursor.ts` (D202)
- `packages/shared/workers/base-declutr-worker.ts` (D203)
- `packages/shared/contracts/events/` (D204)
- `packages/shared/db/unit-of-work.ts` (D205)
- `packages/shared/testing/` with templates + harnesses + factories (D206)

**Plan file decision count: 206 numbered decisions** + 5 inline patches
+ 3 reversal markers across 5 phases.

---

# UI Principles Grill — Codex UI Doc Adoption (2026-05-18)

External UI doc generated by Codex without knowledge of D1-D206
("clean-slate" UI recommendation). Founder evaluated on merit and chose
**principles-up adoption**: elevate Codex's strong principles to
load-bearing UI rules, keep prior decisions that fill Codex's gaps, run
Codex's screen inventory as a completeness checklist.

Outcome: 13 new locked decisions (D207-D219) + UI Constitution summary
table for Architecture Guardian and Design System Agent reference.

**What was NOT changed (Codex conflicts held, do not relitigate):**
- D2 cool/Vercel palette (Codex proposed warm off-white — held)
- D20/D122 4-verdict set (Codex used "Mute" — held; Decide-later is sharper)
- D22 no category prediction (Codex proposed auto-Protect by category — held)
- D19 6-tier pricing structure (Codex showed 2 tiers — held)
- D173 mobile sequencing V2.1+ (Codex said mobile-first — held; responsive web OK)
- D185 visual regression skip at launch (Codex proposed Chromatic — held; Storybook YES via D210)

---

### D207 — Discover→Decide→Automate→Audit→Undo as the load-bearing UI principle

**Rule.** Every UI surface in DeclutrMail must serve exactly one of these
5 stages. The 5 stages are:

- **Discover** — Triage queue ranking, Senders list, Sender Detail,
  Screener queue, Morning Brief (D189), Weekly Value Receipt (D189)
- **Decide** — Triage decision flow (D27-D36), Sender Detail verdict
  actions, Screener actions
- **Automate** — Autopilot Observe/Active toggle (D10), Autopilot rule
  list, future Custom Rule UI (D197 V2.1+)
- **Audit** — Activity log (D35), per-sender activity trail, Weekly Value
  Receipt
- **Undo** — Persistent undo tray (D35), Activity-row undo button,
  undo-expired empty state

**Why.** Without a unifying frame, screens proliferate and the product
devolves into feature-soup. The 5-stage loop is also a marketing story
(sender → decision → automation → audit → undo), so it doubles as
positioning. Codex §25 independently arrived at this loop; strong signal
it's the right frame.

**How to apply.** Every new screen PR declares which stage in its
description. Architecture Guardian rejects PRs introducing surfaces that
don't map to a stage, or surfaces that conflate two stages (e.g., a
"Discover + Automate" screen). Component promotion (D199) checks
consumers fall in compatible stages.

---

### D208 — "What happens next" preview mandatory before every automation or destructive action

**Rule.** Any UI action that changes future inbox behavior, or that
mutates state visible to the user, must render a preview before commit.
Required content of the preview:

1. **What changes** — "Future emails from X will skip your inbox."
2. **What does NOT change** — "Existing emails stay where they are.
   Nothing is deleted."
3. **Undo availability + window** — "Undo available for 7 days."
4. **Reversibility statement** — explicit yes/no.

Applies to: every verdict (Keep / Archive / Unsubscribe / Decide-later
from D20), Autopilot enabling/disabling, Protect/VIP toggling,
account-level mutations, billing changes.

**Why.** Trust is the moat against bulk-delete competitors. Mailstrom/
Unroll.me ask blind trust; we don't. This rule is also what makes
irreversibility psychologically reversible — users feel safer about
automation when they've previewed it.

**How to apply.** Headless hook `useActionPreview()` in
`packages/shared/hooks/` (per D198) builds the preview payload from a
`mutation` descriptor. Feature-owned `<ActionPreview>` components render
it. Architecture Guardian rejects mutation handlers that don't call
`useActionPreview`. Hook `require-preview-before-mutation.sh` blocks the
PR.

---

### D209 — Trust-first microcopy hard rule (extends D194)

**Rule.** All product-surface copy (in-app + marketing + email + push +
docs) follows:

- **Direct trust statements:** "Nothing is deleted." / "Undo available
  for 7 days." / "Future emails will skip your inbox."
- **Plain over hyperbolic:** "Reduces noise" over "Supercharges your
  inbox."
- **AI as explainability, not theater:** "Why this is suggested" over
  "AI detected" / "Smart suggestion."
- **Forbidden words:** AI magic, supercharged, nuke, destroy, blast,
  obliterate, clean (as verb on user data), smart (standalone),
  intelligent (standalone), AI-powered (standalone).
- **Required pattern for any automation copy:** state mechanism, state
  reversibility, state retention.

D194's "Screener" rule (no marketing-speak for the feature name) extends
to all UI copy.

**Why.** D194 locks marketing copy; this extends discipline app-wide.
Trust-sensitive users (D107, D116) inspect copy carefully. A single
"supercharged" undermines years of careful trust-building.

**How to apply.** Hook `check-microcopy.sh` greps PR diffs for forbidden
words. Docs Agent reviews changelog/help copy. Design System Agent
maintains a `copy-tokens.md` of approved patterns in
`packages/shared/copy/`.

---

### D210 — Component-first build with Storybook (Storybook YES, Chromatic NO at launch)

**Rule.** Components ship to Storybook **before** they ship in features.
Build sequence:

1. Token freeze (`packages/shared/tokens/`) — colors, type scale,
   spacing, radius, motion durations
2. 5 golden screens designed in Figma — Landing, Onboarding, Triage,
   Sender Detail, Activity/Undo
3. Primitive extraction to Storybook (`packages/shared/components/`)
4. Feature-owned screens consume primitives (per D198)

Storybook is canonical for component review. Every promoted shared
component (D199) ships with a Storybook story. CI runs Storybook build
on every PR.

Visual regression (Chromatic) remains deferred per D185 — Storybook
gives us isolation review without the operational burden of Chromatic.

**Why.** Solo-founder agent-driven dev (D149, D173) is highest-risk for
design drift. Storybook gives Design System Agent a canonical artifact
to review against. Codex §22 independently recommended this build order.

**How to apply.** Architecture Guardian checks every PR introducing a
`packages/shared/components/` change also includes a `.stories.tsx`
file. Storybook CI must pass for merge. The 5 golden screens are the
only screens allowed to start before component primitives are stable.

---

### D211 — Edge-state screen inventory at launch (extends D166-D171)

**Rule.** Launch ships designed and implemented UI for every state in
the inventory below. No happy-path-only screens.

| Edge state | Existing D coverage | Status |
|---|---|---|
| Initial sync in progress | D6 strict gate | rule + needs designed screen |
| Sync failed (transient) | — | new |
| Sync failed (permanent / OAuth revoked) | D4, D155 | new |
| Gmail permission expired | D4 | new |
| Gmail quota exceeded (provider 429) | D5 | new |
| Undo expired | D35 | new |
| Triage empty state | D33 | covered |
| Senders empty state (new user) | — | new |
| Screener empty state | — | new |
| Autopilot empty state (no rules yet) | — | new |
| Activity empty state | — | new |
| Free limit reached | D19 | new |
| Offline / poor network | D171 | rule + needs designed screen |
| Auth session expired | D155 | new |
| Billing payment failed | — | new |
| Sender deleted from Gmail (404) | — | new |
| Account-deletion in progress | D205 UnitOfWork | new |

**Why.** Premium products look cheap when only happy paths are designed.
D166-D171 set rules but didn't enumerate.

**How to apply.** Each edge state ships with a designed Figma screen, a
Storybook story (per D210), and a Playwright test (per D182, D206) that
triggers the state. Architecture Guardian rejects PRs that introduce a
new error path without a designed UI response.

---

### D212 — Empty states as first-class

**Rule.** Every list/queue/index surface must render a designed empty
state. Empty states must:

- Be **calm, never apologetic** ("No data found" / "Error" / "Nothing
  here" forbidden)
- **Reinforce product mental model** ("DeclutrMail is watching for new
  patterns" not "0 senders")
- **Give next-step framing** when one exists ("Connect a second mailbox
  to see more" not just static text)
- **Never look like an error state** — distinct visual treatment from
  error states

**Why.** Codex §15 — premium UI test. The plan currently locks D33 for
Triage empty state but doesn't generalize.

**How to apply.** Component pattern `<EmptyState>` in
`packages/shared/components/` with required props (`title`,
`description`, optional `action`). Architecture Guardian rejects
list/queue components rendered without an `EmptyState` for zero-data
case. Storybook story required.

---

### D213 — Motion design discipline

**Rule.** Motion is sparse, calm, and serves comprehension — not
delight.

**Allowed motion:**

- Card slide on decision (Triage queue advance)
- Undo banner slide-in entrance, slide-out dismiss
- Scan progress step transitions (D6 sync gate)
- Drawer/modal in-out
- Hover elevation on interactive surfaces
- Status pulse only during active sync (no idle pulse)

**Forbidden:**

- Confetti, sparkle, shimmer
- "AI" particle effects
- Bouncy / overshoot animations
- Multi-color gradient transitions
- Animated charts beyond simple in-tween
- Page-level transitions (>300ms)

**Duration tokens:** 150ms (micro-interaction), 250ms (standard
transition), 400ms (meaningful only — drawer/modal). Anything >400ms
requires Design System Agent approval.

**Why.** Calm-premium feel (D2 cool palette aesthetic) is undermined by
playful motion. Codex §17 independently recommended sparse motion.

**How to apply.** Motion tokens locked in
`packages/shared/tokens/motion.ts` (per D210). Design System Agent owns
updates. Architecture Guardian flags any animation duration outside the
token set.

---

## Completeness gap resolutions (D214-D219)

Codex §24 screen inventory cross-referenced against bundle + D188 launch
surface. 6 gaps identified, resolved as follows.

---

### D214 — Home strip atop Triage (not a separate Home screen)

**Rule.** Triage screen gains a top "today" strip showing situational
awareness for the daily ritual:

```text
Today
You received 184 emails from 63 senders.
DeclutrMail handled 129 automatically.
12 sender decisions can reduce future noise by ~38%.
```

Below the strip: the decision queue (D27-D36).

No separate `/home` route. No 14th screen. D3 screen count preserved.

**Why.** Codex §3 + §14 asked for a Home Command Center. Adding a
14th screen contradicts D187 (anti-redesign scope freeze). A strip
inside Triage gives the situational-awareness mode without scope
explosion. Single screen, dual purpose. Marketing complexity unchanged.

**How to apply.** New component `<TodayStrip>` in
`apps/web/features/triage/components/` (feature-owned per D198). Data
from existing `useTodaySummary()` query (TanStack Query per D200) that
the Brief feature (D189) will reuse. Architecture Guardian: no `/home`
route may be added.

---

### D215 — Senders list owns Search and Protected filter (no separate screens)

**Rule.** The existing Senders screen from the bundle gains:

1. **Typeahead search** in the header — searches sender display name +
   email + domain
2. **Filter chips** — Protected / VIP / Decide-later / Has Active Rule /
   Unsubscribe Pending / All
3. **URL state** — filters reflected in query string for shareable
   deep links (`?protect=true&q=bank`)

No separate `Senders/search` or `Senders/protected` screens. The bundle
Senders screen IS the directory.

**Why.** Codex §24 listed "Search Senders" and "Protected Senders" as
distinct surfaces. The plan keeps them as filtered views of one screen.
Simpler mental model (one place to find any sender). Aligns with
sender-first principle (D20-D22) — every sender path lands on the same
list.

**How to apply.** Senders screen route: `apps/web/features/senders/`.
TanStack Query key includes filter state. Storybook story per filter
variant (D210). E2E test for typeahead + filter combinations.

---

### D216 — Account deletion UI flow at launch (Settings → Account)

**Rule.** Settings page gets an Account sub-section with "Delete account
and data" flow:

1. Initiating click → modal with 2-step confirm + checkbox
   acknowledgment + typed confirmation ("DELETE")
2. On confirm → schedule deletion at T+7 days, send confirmation email
   with cancel link
3. During grace period → red banner on every page "Account deletion
   scheduled for {date}. Cancel?"
4. On T+7 → D205 AuthAccountDeletionOrchestrator runs UnitOfWork, full
   data deletion, account row removed, deletion-receipt email sent

UI must show what gets deleted ("Gmail metadata index, sender
decisions, automation rules, undo history") and what doesn't ("emails
in your actual Gmail account").

**Why.** Codex §20, §24 named this. DPDP Act compliance (D148). Trust
differentiator. D205 has the orchestrator rule but no UI design — this
locks the UI side.

**How to apply.** Route: `apps/web/features/settings/account/`. Uses
D205 UnitOfWork primitive on backend. Playwright test for full
schedule → cancel and schedule → execute paths. Architecture Guardian:
this flow may NOT bypass D205's UnitOfWork even for "test mode."

---

### D217 — Privacy & Data settings sub-page at launch

**Rule.** Settings → Privacy & Data is a dedicated sub-page (not a
section in main Settings). Contains:

1. **"Your Gmail data" card** — visual two-column showing Stored (sender
   email, sender display name, subject, snippet, labels, dates,
   attachment flag) vs. Not Stored (full message bodies, attachments,
   raw MIME). Updates as D178 dependency-scan/data-changes warrant.
2. **Indexed mailboxes list** — connected Gmail accounts with status
3. **Undo retention** — current setting + export button (CSV download)
4. **Data download** — request full export per DPDP Act (link to backend
   D205-orchestrated export job)
5. **Disconnect / Delete data** — link to D216 flow

**Why.** Codex §20 specifically called out this surface. D107/D116/D146
have privacy rules across docs and bundle marketing, but no in-app
surface that consolidates. Privacy-sensitive users inspect this page;
it must look extremely good (Codex's word).

**How to apply.** Route:
`apps/web/features/settings/privacy-and-data/`. "Your Gmail data" card
is `<DataStorageCard>` in `packages/shared/components/` (load-bearing
trust artifact — promote per D199 even with 1 consumer because spec
overrides lazy promotion).

---

### D218 — Public `/changelog` at launch

**Rule.** Public marketing surface `/changelog` listing releases in
reverse-chronological order. Each entry:

- Version + date
- Summary (1-2 sentences)
- Sections: Added / Improved / Fixed
- Links to relevant docs or screens
- RSS feed support

Updated by Docs Agent on every release. Tied to deployment via D160 CI.

**Why.** Codex §24 named this. Low-cost public artifact. High signal
for users + SEO. Docs Agent already has scope (D194 hook).

**How to apply.** Route: `apps/web/(marketing)/changelog/`. Source from
markdown files in `/docs/changelog/`. Required field in every release
PR template (per D187's `require-pr-template.sh`).

---

### D219 — Single-page FAQ `/help` at launch; full Help Center deferred to V2.1

**Rule.** Launch ships a single `/help` page with 15-20 FAQ items:

- How DeclutrMail works (sender-first explainer)
- What data is stored / not stored
- How undo works
- How to unsubscribe
- How Autopilot works
- How to connect / disconnect Gmail
- How to delete account
- Pricing questions
- Privacy questions

Full help center (per-feature articles, search, categorization) deferred
to V2.1, gated on PMV pricing validation.

**Why.** Codex §24 named Help Center. D149 25-35 hrs/week constraint
makes full help center scope-creep at launch. FAQ is the minimum that
deflects support volume; full help center is a V2.1 investment when
revenue justifies.

**How to apply.** Route: `apps/web/(marketing)/help/`. Source from
markdown in `/docs/help-faq/`. Each FAQ entry has slug for deep-linking
(`/help#unsubscribe-flow`). Architecture Guardian: no `/help/[category]/[article]`
route until D219 V2.1 reversal lock.

---

# 🎨 UI Constitution — One-Page Reference

For Architecture Guardian, Design System Agent, and any contributor.
This table is the canonical UI rule set. All rules are enforceable.

| Rule | D | One-line statement | Enforcer |
|---|---|---|---|
| Visual identity | D1 | Geist Sans + Geist Mono | Design System Agent |
| Palette | D2 | Cool/Vercel + deep teal (NOT warm) | Design System Agent |
| Screen scope | D3 + D188 | 13 bundle screens, 4 flagged off at launch | Architecture Guardian |
| Anti-redesign | D187 | No visual changes after PR 3 without `redesign` label + PR template | `require-pr-template.sh` |
| Verdicts | D20 + D122 | 4 only: Keep / Archive / Unsubscribe / Decide-later | Architecture Guardian |
| Sender-first | D20-D22 | All paths land on sender, never message | Architecture Guardian |
| No category prediction | D22 | No ML inferring sender category for recommendations | Architecture Guardian |
| Reasoning UX | D26 | Inline on Triage hero; popover elsewhere | Design System Agent |
| Undo always visible | D35 | Persistent action tray + per-row undo | Architecture Guardian |
| Mobile sequencing | D173 | Desktop-first at launch; responsive web OK; native mobile V2.1+ | Architecture Guardian |
| Component pattern | D198 | Headless hooks for behavior + feature-owned rendering | Architecture Guardian |
| Component promotion | D199 | Lazy: ≥2 actual consumers OR spec override | Architecture Guardian |
| Frontend state | D200 | TanStack Query (server) + Zustand (client) | Architecture Guardian |
| Marketing copy | D194 | "Screener" not "smart filter"; no AI theater | Docs Agent |
| Visual regression | D185 | Skip Chromatic at launch (Storybook only) | — |
| **UI loop** | **D207** | **Every screen serves Discover/Decide/Automate/Audit/Undo** | **Architecture Guardian** |
| **Action preview** | **D208** | **Every mutation shows "what happens next" before commit** | **`require-preview-before-mutation.sh`** |
| **Microcopy** | **D209** | **Trust-first, plain, no AI theater, forbidden-word list** | **`check-microcopy.sh`** |
| **Storybook-first** | **D210** | **Component → Storybook → feature; tokens frozen first** | **Architecture Guardian** |
| **Edge states** | **D211** | **17 named edge states, each designed + tested** | **Architecture Guardian** |
| **Empty states** | **D212** | **Every list has calm, mental-model-reinforcing empty state** | **Architecture Guardian** |
| **Motion** | **D213** | **150/250/400ms; allowed list; forbidden list** | **Design System Agent** |
| **Home strip** | **D214** | **Triage owns daily briefing; no separate /home route** | **Architecture Guardian** |
| **Senders directory** | **D215** | **Senders screen owns search + Protected filter; no separate screens** | **Architecture Guardian** |
| **Account delete UI** | **D216** | **2-step confirm + 7-day grace + email receipt + D205 orchestrator** | **Architecture Guardian** |
| **Privacy & Data page** | **D217** | **Settings sub-page with "Your Gmail data" card + indexed mailboxes + export** | **Architecture Guardian** |
| **Changelog** | **D218** | **Public `/changelog` + Docs Agent updates on release** | **Docs Agent** |
| **Help FAQ** | **D219** | **Single-page FAQ at launch; full Help Center V2.1+** | **Architecture Guardian** |
| **Component naming** | **D220** | **10 promoted + 7 feature-owned; locked names; ProtectedSenderBadge is `<InsightBadge variant>`** | **Architecture Guardian** |
| **Queue framing copy** | **D221** | **Count "decisions" never "senders"/"emails"; "12 decisions to reduce future noise"** | **`check-microcopy.sh`** |
| **No auto-Protect category** | **D222** | **REJECTED at all versions (extends D22); no category-flavored UX, allowlist, or advisory** | **`block-category-prediction.sh`** |
| **Landing headline** | **D223** | **"Control Gmail by sender, not by email."** | **Docs Agent** |

**Bolded rows = locked in this session (D207-D223).**

---

# 🎯 UI Principles Grill Session — locked decisions D207-D219

**13 UI decisions** locked in this grilling session, covering:

| # | Topic | Outcome |
|---|---|---|
| D207 | UI loop | Every screen serves Discover/Decide/Automate/Audit/Undo |
| D208 | Action preview | "What happens next" mandatory before mutations |
| D209 | Microcopy | Trust-first, forbidden-word list, hook-enforced |
| D210 | Component-first | Storybook before features; Chromatic deferred |
| D211 | Edge states | 17-state inventory, each designed + tested |
| D212 | Empty states | First-class, calm, mental-model-reinforcing |
| D213 | Motion | Sparse, calm, 150/250/400ms tokens |
| D214 | Home strip | Inside Triage, not a separate screen |
| D215 | Senders directory | One screen owns search + Protected filter |
| D216 | Account delete UI | 2-step confirm + 7-day grace via D205 |
| D217 | Privacy & Data page | Dedicated Settings sub-page with data-storage card |
| D218 | Changelog | Public `/changelog` + Docs Agent ownership |
| D219 | Help | Single-page FAQ at launch; Help Center V2.1+ |

**New shared artifacts that resulted:**

- `packages/shared/hooks/useActionPreview.ts` (D208)
- `packages/shared/components/EmptyState.tsx` (D212)
- `packages/shared/components/DataStorageCard.tsx` (D217 — spec override on D199)
- `packages/shared/copy/copy-tokens.md` (D209)
- `packages/shared/tokens/motion.ts` (D213)
- New hooks: `require-preview-before-mutation.sh`, `check-microcopy.sh`
  (extends Topic 34 hook list from 8 to 10)
- New marketing routes: `/changelog`, `/help` (D218, D219)
- New settings routes: `account`, `privacy-and-data` (D216, D217)

**Plan file decision count: 219 numbered decisions** + 5 inline patches
+ 3 reversal markers across 5 phases.

---

# UI Cleanup Pass — Final 4 Items from Codex Doc (2026-05-18)

Closeout of 4 minor items from Codex's UI doc that surfaced during the
UI Principles Grill but weren't locked at that point. 4 new decisions
(D220-D223). Plan reaches 223 numbered decisions.

---

### D220 — Component naming inventory (locks Codex §6)

**Rule.** The following 10 components are promoted to
`packages/shared/components/` with locked names. They satisfy D199's
promotion criterion (≥2 actual consumers OR spec override).

**Promoted (10):**

| Name | Consumers | Promotion reason |
|---|---|---|
| `PageShell` | every route | universal layout |
| `PageHeader` | every route | universal layout |
| `EmptyState` | every list/queue | D212 spec override |
| `UndoBanner` | Triage + Activity + Sender Detail + Senders | ≥2 consumers |
| `MetricCard` | Triage (D214 strip) + Brief (D189) + Activity | ≥2 consumers |
| `ActionPill` | Triage + Senders + Activity + Screener | ≥2 consumers |
| `InsightBadge` | Triage + Senders + Sender Detail | ≥2 consumers |
| `TrustBadge` | Marketing + Settings + Onboarding | ≥2 consumers |
| `DangerZoneCard` | Settings/account (D216) + protect-removal flows | ≥2 consumers expected |
| `DataStorageCard` | Settings/privacy (D217) | D217 spec override |

**Feature-owned (7), kept in `apps/web/features/<feature>/components/`:**

| Name | Owner |
|---|---|
| `SenderCard` | Triage (golden screen, owns canonical) |
| `SenderTable` | Senders |
| `SenderActionBar` | Triage |
| `RulePreviewCard` | Autopilot |
| `AuditLogRow` | Activity |
| `ScreenerQueueCard` | Screener |
| `AutopilotStatusCard` | Autopilot |

**Not separate components (variants of others):**

- `ProtectedSenderBadge` = `<InsightBadge variant="protected">`

**Why.** Naming churn is expensive (rename across stories, types,
imports, tests). Locking promoted names now prevents agent renaming
across PRs. Feature-owned names stay flexible — Design System Agent can
adjust during implementation if usage diverges.

**How to apply.** Architecture Guardian rejects PRs introducing a
shared component under a different name, or moving a feature-owned
component to shared without ≥2 consumers (or spec override Ds noted
above). Storybook stories (per D210) use the locked names verbatim.

---

### D221 — Decision Queue framing copy (locks Codex §8 framing)

**Rule.** All UI surfaces that count the Triage queue express the count
as **decisions**, never senders or emails.

**Canonical phrasings:**

- Triage header: "12 decisions to reduce future noise"
- Triage empty state (refines D33): "No decisions today — DeclutrMail
  is watching for new patterns. You'll see recommendations when a
  sender starts creating repeated noise."
- Today strip (D214): "12 sender decisions can reduce future noise by
  ~38%"
- Marketing copy: "thousands of emails become a handful of sender
  decisions" (per Codex §12 subcopy)
- Brief (D189) and Weekly Value Receipt (D189): same pattern — count
  decisions, not raw signal

**Why.** Reinforces D207 (Decide stage), D27 (daily ritual), D20-D22
(sender-first wedge). Differentiates from Gmail's "12 unread" pattern.
Frames every queue item as a value-producing action ("each click makes
my future inbox better" — Codex §8).

**How to apply.** Copy patterns live in
`packages/shared/copy/copy-tokens.md` (D209). Hook
`check-microcopy.sh` rejects PRs where Triage-context strings mention
"senders" or "emails" as the count noun instead of "decisions."

---

### D222 — Auto-Protect via category prediction REJECTED at all versions (extends D22)

**Rule.** DeclutrMail will not introduce auto-Protect via category
prediction, curated category allowlists, or category-flavored advisory
UX at any version. This is a permanent rejection, not a deferral.

**Forbidden mechanisms:**

- ML-based category prediction (banks / healthcare / 2FA / receipts /
  family)
- Hard-coded domain allowlists for category-flavored Protect
  (`noreply@github.com` → "security sender" badge)
- Advisory bands ("Looks security-sensitive — be careful")
- Sender Detail category badges
- Any UX surface that implies "DeclutrMail knows what kind of sender
  this is"

**The wedge.** Sender rules are based on **real engagement data only**:
volume, opens, replies, opt-ins, sender-level user flags. Not predicted
categories. The user's agency over decisions is the moat.

**Why.** D22 already forbids category prediction for verdict
recommendation. D222 extends the prohibition to Protect, advisory UX,
and any category-flavored surface. Categories are hard to predict
accurately (founder's stated reasoning). Real engagement data is honest
and falsifiable. Category prediction is creepy, fragile, and undermines
the user-agency wedge.

**The "Autopilot mis-archives 2FA" safety concern** is mitigated by the
existing chain:

- D10 — Autopilot ships Observe-only at launch (no auto-archive)
- D188 — Autopilot behind feature flag at launch
- D42 — User can manually flag any sender as Protect
- D6 — Strict body-read prohibition means 2FA content detection is
  technically infeasible anyway
- D35 — Undo always available

No additional safety net needed.

**How to apply.** Architecture Guardian rejects any PR that:

- Introduces a `senderCategory` / `predictedType` / `inferredCategory`
  schema field
- Introduces a curated domain allowlist for Protect, advisory, or any
  category-flavored UX
- Adds copy that implies category awareness ("Banks usually …")
- Adds a Sender Detail badge sourced from anything other than
  user-declared flags or real engagement data

Hook `block-category-prediction.sh` (new, extends Topic 34 hook list
from 10 to 11) greps for forbidden schema fields and UI strings.

---

### D223 — Landing page primary headline (locks tentative)

**Rule.** The landing page primary headline is:

> **Control Gmail by sender, not by email.**

**Subcopy (working baseline, refinable in Phase 5):**

> DeclutrMail turns thousands of emails into a handful of sender
> decisions — with automation, privacy-first indexing, and 7-day undo.

**Why.** Strongest single-line distillation of the wedge: defensive
(every competitor opens with "AI inbox cleaner"), specific (says exactly
what we do differently), Gmail-anchored (no abstract "email management"
fluff). Reinforces D20-D22 sender-first wedge. Aligns with D194 marketing
copy rule (no AI theater, no hyperbole). Aligns with D209 microcopy
discipline.

**Refinable in:** Phase 5 Topics 36-38 (GTM, Reddit strategy, SEO
content plan) may iterate on subcopy, hero visual, and supporting
headlines. The primary headline stays the load-bearing line through
Phase 5 iteration unless explicit reversal D.

**How to apply.** Headline + subcopy live in
`apps/web/(marketing)/page.tsx`. Hero visual designed to support
"sender → decision → automation → undo" story (Codex §12). Docs Agent
ensures all marketing surfaces (Reddit posts, blog, comparison pages,
methodology page) reinforce this headline pattern.

---

# 🎯 UI Cleanup Pass — locked decisions D220-D223

**4 cleanup decisions** locked in this pass:

| # | Topic | Outcome |
|---|---|---|
| D220 | Component naming | 10 promoted + 7 feature-owned + 0 separate badge variants |
| D221 | Decision Queue copy | Count "decisions" never "senders" or "emails" |
| D222 | Auto-Protect category | REJECTED at all versions (extends D22) |
| D223 | Landing headline | "Control Gmail by sender, not by email." |

**Topic 34 hook list expanded:** 11 hooks now (was 10 after UI Principles
Grill, was 8 originally). New hook: `block-category-prediction.sh`
(D222).

**Plan file decision count: 223 numbered decisions** + 5 inline patches
+ 3 reversal markers across 5 phases.

---

# Cross-Decision Contradiction Audit — Resolution Pass (2026-05-18)

External audit (general-purpose agent, read-only) identified **11 silent
contradictions** across 10 zones in the 223-decision plan. Founder chose
"resolve all 11 now." Resolution pass produces:

- **3 new decisions** (D224-D226) for structural fixes
- **9 inline patches** marked `[AUDIT PATCH 2026-05-18]` applied to: D5,
  D33, D157, D187, D194, D209, D211, D220, D221
- **Topic 34 hook list collapse:** 11 → 10 hooks
  (`check-screener-copy.sh` merged into `check-microcopy.sh` as
  named-rule mode per R-2)

The 11 findings and their resolutions:

| ID | Severity | Resolution location |
|---|---|---|
| HC-1 | 🔴 | D224 (sync gate transport schema + useSyncStatus contract) |
| HC-2 | 🔴 | Inline patch on D5 |
| HC-3 | 🔴 | D225 (worker policy expansion + named exceptions) |
| HC-4 | 🔴 | Inline patches on D33, D211, D221 |
| SC-1 | 🟠 | D226 (action lifecycle ordering) |
| SC-2 | 🟠 | Inline patch on D220 (demote DangerZoneCard) |
| SC-3 | 🟠 | Inline patch on D187 (PR 3 = tokens + golden screens + Storybook foundation) |
| SC-4 | 🟠 | Inline patch on D157 (worker categorization tags) |
| R-1  | 🟡 | Inline patches on D33, D221 (clarify D33/D212/D221 relationship) |
| R-2  | 🟡 | Hook merge (Topic 34 list collapse) |
| R-3  | 🟡 | Inline patches on D194, D209 (copy hierarchy) |

---

### D224 — Sync gate transport schema + `useSyncStatus` contract (resolves HC-1)

**Rule.** Sync gate transport is settled as follows.

1. **DB schema additions to `provider_sync_state`** (extends D150):
   - `current_stage` enum NOT NULL DEFAULT `'queued'`: values
     `'queued' | 'fetching_metadata' | 'building_sender_index' | 'computing_recommendations' | 'finalizing' | 'ready' | 'failed'`
   - `progress_pct` smallint NOT NULL DEFAULT 0 (0-100)
2. **Backend API:** `GET /api/v1/sync/state` returns
   `{readiness_status, current_stage, progress_pct, error_code?}` per
   D202 envelope.
3. **Frontend hook:** `useSyncStatus()` in
   `apps/web/features/onboarding/hooks/` polls every 3s via TanStack
   Query (per D200) while `readiness_status === 'syncing'`. Stops
   polling on `'ready'` or `'failed'`. Returns full payload to consumers.
4. **D6 lifecycle events are server-side only.** `sync.started`,
   `sync.progress`, `sync.completed`, `sync.failed`, `sync.degraded`
   emit to PostHog + Sentry per D159 only. They are NOT the UI
   transport. The UI sees only `useSyncStatus()` poll results.

**Why.** HC-1 found D6's "lifecycle events" language and D109's stage
indicator UX implied event-driven push, but D200 locked TanStack 3s
polling. Without schema columns for stage and progress, the onboarding
stage indicator (D109) cannot animate stage-by-stage. This decision adds
the columns and locks the hook contract so the UI is buildable.

**How to apply.** D150 (DB schema) gains migration `0007_sync_state_progress.sql`.
D157's `InitialSyncWorker` updates `current_stage` and `progress_pct` on
transition. Architecture Guardian rejects any alternative transport
(websockets, SSE) at launch. Visual regression for the stage indicator
is a Playwright E2E that mocks the 3s poll sequence.

---

### D225 — Worker policy expansion + named exceptions (resolves HC-3)

**Rule.** D203's `WORKER_POLICIES` set expands from
`{webhookPolicy, perMailboxPolicy, batchPolicy}` to add two new
policies:

- **`cronPolicy`** — for periodic jobs without mailbox keying.
  Concurrency 1 globally. Idempotency keyed on
  `(worker_name, scheduled_at_minute)` instead of mailbox+messageId.
  Lifecycle: enqueue from cron scheduler → BaseDeclutrWorker runs
  `processJob()` → on success mark `(worker_name, scheduled_at_minute)`
  done in `cron_runs` table.
- **`adminPolicy`** — for jobs whose purpose IS to surface failures.
  Exempt from D203's "Sentry called once per failure" test. Concurrency
  1 globally. Lifecycle: enqueue → run → may call Sentry multiple
  times → never marks itself failed (the failure IS the alert).

**Named exceptions** in D157's worker list:

- `DeadLetterWorker` — `adminPolicy`. Polls `dead_letter_jobs` every
  60s; alerts Sentry on any new row.
- `WatchRenewalWorker` — `cronPolicy`. Runs every 6h; renews Gmail
  watch subscriptions for all active mailboxes.

**Why.** HC-3 found these two workers in D157 couldn't cleanly extend
`BaseDeclutrWorker` under D203's existing 3 policies. Adding 2 policies
is cleaner than carving out per-worker exceptions and gives the base
class headroom for similar workers in the future.

**How to apply.** D203's `WorkerPolicy` enum extends.
`BaseDeclutrWorker` accepts the new policies. Architecture Guardian
rejects PRs introducing cron-flavored or admin-flavored workers under
the wrong policy. New DB table: `cron_runs(worker_name, scheduled_at_minute, status, ran_at)`.

---

### D226 — Action lifecycle ordering (resolves SC-1)

**Rule.** The ordering of action UX layers is locked:

```text
User intent
  ↓
[D34] Action sheet — confirmation modal + "remember preference" toggle
  ↓ (toggle ON: skip sheet RENDERING, NOT skip preview)
[D208] Action preview — "what happens next" content (mandatory)
       Inside the sheet: renders as modal body
       Sheet skipped: renders as inline row banner
  ↓ (user confirms — or, in skip-sheet mode, taps row action)
[D200] TanStack mutation — optimistic update applied to cache
  ↓ (commit succeeds, OR rolls back on server error)
[D35] Undo tray — persistent banner for 7-day undo window
```

**The D34 "remember preference" toggle skips the SHEET UI (the wrapping
modal), NOT the PREVIEW content.** When the toggle is on:

- The action sheet does not open
- The preview content renders inline as a small banner inside the row
  being acted upon
- User taps row action → preview banner appears for 1s → mutation fires
- Preview is never skipped

**Why.** SC-1 found D34's toggle promised power users they could skip
the action sheet, but D208 makes the action preview mandatory. Without
clarification, the toggle's promise was technically false. This
decision separates: sheet UI is skippable; preview content is not.
Preserves the trust wedge (D208) while preserving D34's power-user
ergonomics.

**How to apply.** `<ActionPreview>` component (D208) supports
`variant="modal"` (default, inside sheet) and `variant="inline"`
(renders into row banner when sheet skipped). Architecture Guardian: any
mutation handler that takes the `skipSheet=true` path must still render
the inline preview banner. Hook `require-preview-before-mutation.sh`
(D208) checks both code paths.

---

## Inline patches (applied below; original D bodies remain authoritative + patched in-place markers)

### [AUDIT PATCH 2026-05-18 on D5]
**Concurrency limits owned by D203 + D225.** D5 retains the Gmail quota
request plan and alerting design only. Numbers: `perMailbox=1` (D5 +
D203 agree); `global=20` (D203 supersedes D5's `global=50`).
Cross-reference: D203 worker policies, D225 cron/admin policy
additions.

### [AUDIT PATCH 2026-05-18 on D33]
**D33 is the Triage instance of the D212 empty-state pattern.** Two
distinct Triage empty states exist:

- **D33 owns:** the "cleared queue, end-of-ritual" state — user has
  decided all queued items today, sees stats summary + "Come back
  tomorrow" + subtle upgrade nudge.
- **D221 owns:** the "no decisions queued at all today" state —
  fresh-look at empty Triage, sees "No decisions today — DeclutrMail is
  watching for new patterns."

Both render via `<EmptyState>` component (D212) with different copy
and action props.

### [AUDIT PATCH 2026-05-18 on D157] — Worker categorization tags

Each worker tagged with execution category:

| Worker | Category | Policy (D203/D225) |
|---|---|---|
| `InitialSyncWorker` | `[on-demand]` | perMailboxPolicy |
| `IncrementalSyncWorker` | `[pubsub]` | perMailboxPolicy |
| `WatchRenewalWorker` | `[cron]` | cronPolicy (D225) |
| `DeadLetterWorker` | `[cron]` | adminPolicy (D225) |
| `EmailDispatchWorker` | `[event:notification.queued]` | batchPolicy |
| `WebhookProcessorWorker` | `[pubsub]` | webhookPolicy |
| `RecommendationRecomputeWorker` | `[event:sender.signal_changed]` | perMailboxPolicy |
| `UnsubscribeWorker` | `[on-demand]` | perMailboxPolicy |
| `OutboxDispatcherWorker` | `[cron]` | cronPolicy (D225) |
| `SenderPolicyUpdaterWorker` | `[event:triage.verdict_applied]` | perMailboxPolicy |
| `ActivityRecorderWorker` | `[event:*]` | batchPolicy |
| `BillingReconcileWorker` | `[cron]` | cronPolicy (D225) |
| `RetentionPurgeWorker` | `[cron]` | cronPolicy (D225) |
| `ExportJobWorker` | `[on-demand]` | perMailboxPolicy |
| `WeeklyValueReceiptWorker` (D189) | `[cron]` | cronPolicy (D225) |
| `MorningBriefWorker` (D189) | `[cron]` | cronPolicy (D225) |
| `AutopilotApplyWorker` | `[event:autopilot.rule_matched]` | perMailboxPolicy |
| `AccountDeletionOrchestrator` (D205/D216) | `[on-demand]` | perMailboxPolicy + UnitOfWork |

D204's read-only services produce events; these are consumed by the
`[event:*]` workers above.

### [AUDIT PATCH 2026-05-18 on D187]
**PR 3 = the PR that lands tokens + 5 golden screens (Landing,
Onboarding, Triage, Sender Detail, Activity/Undo) + Storybook
foundation.** D187 design freeze begins at PR 3 merge. Before PR 3:
design tokens are mutable, Storybook is being seeded, golden screens
are iterating. After PR 3 merge: D187 freeze rules apply
(`require-pr-template.sh` enforces `redesign` label for any visual
change). Sequencing matches D210's build order.

### [AUDIT PATCH 2026-05-18 on D194]
**D194 (Screener marketing copy rule) is a specific application of
D209's trust-first microcopy rule.** On conflict between D194 and D209,
D209 wins. `check-screener-copy.sh` collapses into `check-microcopy.sh`
as a named-rule mode (`--rule=screener`).

### [AUDIT PATCH 2026-05-18 on D209] — Copy hierarchy + hook merge

**Hierarchy.** D209 governs all product-surface copy at the top level.
D194 (Screener marketing rule), D221 (decision queue framing), and D223
(landing headline) are specific applications of D209. **D209 wins on
any conflict.**

**Hook merge (resolves R-2).** `check-screener-copy.sh` (D194) merged
into `check-microcopy.sh` (D209) as a named-rule mode. Hook count
collapses 11 → 10. Topic 34 final hook inventory:

1. `block-dangerous-commands.sh`
2. `block-protected-files.sh`
3. `require-tests-after-edit.sh`
4. `require-no-gmail-hot-path.sh`
5. `verify-no-body-storage.sh`
6. `require-activity-for-actions.sh`
7. `require-idempotency.sh`
8. `require-pr-template.sh` (also enforces D187 redesign-label)
9. `require-preview-before-mutation.sh` (D208)
10. `check-microcopy.sh` (D209 + D194 + D221 named-rule modes)
11. `block-category-prediction.sh` (D222)

Wait — that's 11. The merge collapses #10 from "check-microcopy + check-screener (2 hooks)" to "check-microcopy with screener mode (1 hook)." Net: 11 was the count BEFORE the merge. After the merge:

**10 hooks total.** Above list ends at #10 (`check-microcopy.sh` absorbs
screener mode) + #11 → renumber: `block-category-prediction.sh`
becomes #10. Final count: 10 hooks.

### [AUDIT PATCH 2026-05-18 on D211] — Owning-D for each "new" edge state

Each "new" row in D211's table now has explicit ownership:

| Edge state | Owning D(s) | Note |
|---|---|---|
| Initial sync in progress | D6 + D109 + **D224** | screen now buildable per D224 |
| Sync failed (transient) | D211 | new, D211-owned |
| Sync failed (permanent / OAuth revoked) | D4 + D155 + D211 | D211 specifies UI |
| Gmail permission expired | D4 + D211 | D211 specifies UI |
| Gmail quota exceeded (provider 429) | D5 + D211 | D211 specifies UI |
| Undo expired | D35 + D211 | D211 specifies UI |
| Triage empty state (cleared queue) | D33 + D212 | covered |
| Triage empty state (no decisions today) | D221 + D212 | new state via D221 |
| Senders empty state (new user) | D211 + D212 | new, D211-owned |
| Screener empty state | D211 + D212 | new, D211-owned |
| Autopilot empty state (no rules yet) | D211 + D212 | new, D211-owned |
| Activity empty state | D211 + D212 | new, D211-owned |
| Free limit reached | D19 + D211 | D211 specifies UI |
| Offline / poor network | D171 + D211 | D211 specifies UI |
| Auth session expired | D155 + D211 | D211 specifies UI |
| Billing payment failed | D211 | new, D211-owned |
| Sender deleted from Gmail (404) | D211 | new, D211-owned |
| Account-deletion in progress | D205 + D216 + D211 | D211 specifies UI |

### [AUDIT PATCH 2026-05-18 on D220] — Demote `DangerZoneCard`

`DangerZoneCard` is demoted from promoted-shared to feature-owned
(lives in `apps/web/features/settings/account/components/`). Reason:
D199 promotion criterion is ≥2 *actual* consumers OR spec override;
DangerZoneCard had only Settings/account as actual at this point and
"protect-removal" was speculative future. Re-promote when a 2nd
consumer ships.

Updated promoted count: **9** (was 10). Updated feature-owned list:
adds `DangerZoneCard` under Settings.

### [AUDIT PATCH 2026-05-18 on D221]
**D221 extends D33 (different state, not refinement).** D33 owns the
"cleared queue, end-of-ritual" empty state. D221 owns the "no decisions
queued today" empty state. Both render via D212's `<EmptyState>`
component with different copy.

---

# 🎨 UI Constitution — Updated for D224-D226

Three new rows added:

| Rule | D | One-line statement | Enforcer |
|---|---|---|---|
| **Sync transport** | **D224** | **`provider_sync_state` + `useSyncStatus` 3s poll; D6 events server-side only** | **Architecture Guardian** |
| **Worker policies** | **D225** | **5 policies (webhook/perMailbox/batch/cron/admin); named DLW + WatchRenewal exceptions** | **Architecture Guardian** |
| **Action lifecycle** | **D226** | **sheet → preview → mutation → undo; D34 toggle skips sheet UI not preview** | **`require-preview-before-mutation.sh`** |

(D224 is not strictly UI but belongs in the Constitution because the
onboarding stage indicator depends on it.)

---

# 🎯 Audit Resolution Pass — locked decisions D224-D226 + 9 inline patches

| # | Topic | Outcome |
|---|---|---|
| D224 | Sync transport | Schema + hook contract for sync gate UI |
| D225 | Worker policies | cron + admin policies added; DLW + WatchRenewal named exceptions |
| D226 | Action lifecycle | sheet/preview/mutation/undo order; D34 toggle clarified |

**Topic 34 final hook count: 10** (was 11, R-2 merge collapsed
`check-screener-copy.sh` into `check-microcopy.sh`).

**Promoted shared component count: 9** (was 10, SC-2 demoted
`DangerZoneCard`).

**Plan file decision count: 226 numbered decisions** + 5 inline patches
+ 9 audit patches + 3 reversal markers across 5 phases.

---

# 🛡️ Codex Grill Round 2 — Implementation-Contract Patches (D227-D235)

Round 2 of Codex's grill identified 10 implementation-contract bugs in the
plan. After review, 9 became decisions D227-D235. The 10th (flag defaults)
was explicitly rejected — flags are emergency kill switches at launch, not
cohort-learning instruments; default-true is intentional.

Each Round 2 decision below patches one or more prior decisions; the prior
bodies remain authoritative but are reverbed by the inline patches at the
end of this section.

---

### D227 — Canonical UI verbs K/A/U/L; "Screen" internal only

**Rule.** Product-surface UI uses exactly four user-facing verbs in this
canonical order: **Keep, Archive, Unsubscribe, Later**. Keyboard shortcuts:
**K, A, U, L**. The word "Screen" exists only as an internal enum
(`triage_decision.verdict='screen'`) and never appears in product UI copy.
The word "Screener" continues to refer to the Screener feature only (D194
copy rule governs that name).

D29's "Screen as the 4th verb (S key)," D40's "K/A/U/S," and D81's "press S
during Triage" are reverbed by the inline patches below to K/A/U/L and "L
key." D122's "Decide later" remains the user-facing verb name.

**Why.** D122 changed the verb but D29, D40, D81 still leak the old verb
and shortcut. Without a canonical rule and a grep hook, every agent reading
the plan copies stale verbs into components, Storybook stories, and tests.
Catching this in code review across 50+ files is far more expensive than
enforcing it once at the plan level.

**How to apply.** `check-microcopy.sh` (D209) gains a `--rule=canonical-verbs`
mode that rejects: `"K/A/U/S"`, `"press S"` (case-insensitive, when within
2 lines of an action context), `"Screen →"`, `"Screen "` followed by a noun
pattern in product UI files. Storybook stories (D210) must be written using
K/A/U/L. **D227 must land BEFORE D210 Storybook work begins** so the first
stories encode the right verbs; this is a sequencing requirement in the
implementation order.

---

### D228 — Privacy badge rewrite: "Full bodies fetched: 0" + explicit storage list

**Rule.** The trust badge previously specified in D7 as "Bodies read: 0
forever" is replaced with:

> **Full bodies fetched: 0**
>
> We store: sender (name + email), subject, Gmail's short snippet, dates,
> Gmail labels, read/unread state.
>
> We never fetch or store: full message body, HTML, attachments, inline
> images, raw MIME, headers other than the ones above.

The phrase "Bodies read: 0" is **banned** from product UI and marketing
copy at the canonical-copy hook level.

**Why.** Gmail's API defines `snippet` as "a short part of the message
text." Saying "Bodies read: 0 forever" while storing snippets is
technically attackable by a privacy-paranoid critic: "You DO store message
text." The defensible boundary is "no full bodies, no MIME, no attachments"
— which is true, falsifiable, and impossible to argue around. Boring,
precise privacy copy beats slogans.

**How to apply.** D7's badge copy replaces wholesale. Landing page (D223),
onboarding (D109), and Privacy & Data settings (D217) all use the new copy.
`check-microcopy.sh` gains a `--rule=privacy-badge` mode that rejects
`"Bodies read: 0"` and `"body read: 0"` (case-insensitive) anywhere in
`apps/web/**/*.{tsx,mdx}` and marketing copy directories.

---

### D229 — Pub/Sub OIDC verification contract

**Rule.** The Gmail Pub/Sub push webhook (D14, D156, D180) verifies
authenticity using the OIDC JWT delivered via `Authorization: Bearer <token>`,
**NOT** via `x-goog-authenticated-user-email`. Verification checklist (all
must pass before reading request body):

1. `Authorization` header present and starts with `Bearer `.
2. Token signature validates against Google's JWKS
   (`https://www.googleapis.com/oauth2/v3/certs`).
3. `iss` claim equals `https://accounts.google.com` or `accounts.google.com`.
4. `aud` claim equals the configured push audience
   (env: `PUBSUB_PUSH_AUDIENCE`).
5. `email` claim equals the configured Pub/Sub push service account
   (env: `PUBSUB_PUSH_SA_EMAIL`).
6. `exp` claim is in the future.
7. Request body `message.messageId` is deduped via Redis `SET … NX EX 86400`.
8. Decoded Gmail `historyId` is monotonic per mailbox: reject if `<=` last
   processed `historyId` for that mailbox.

Any failure → HTTP **401** (NOT 403, NOT 200, NOT 204). Log Sentry warning
at level `info`; only rate-anomalies (per D180) escalate to alert.

**Why.** Codex Grill Round 2 #3: `x-goog-authenticated-user-email` is a
Cloud Run IAM-specific header, not the canonical Pub/Sub authenticated-push
mechanism. Per Google's docs, authenticated push uses an OIDC token whose
`email` claim identifies the configured service account. Without the right
spec, agents ship a verifier that "validates" the wrong claim and silently
accepts unauthenticated requests.

**How to apply.** D180's verification clause is reverbed by inline patch
below. Contract test in `apps/api/src/webhooks/pubsub/__tests__/verify-oidc.test.ts`
asserts each failure mode returns 401. Architecture Guardian: webhook
handler must not consume `req.body` until verification passes (enforceable
via NestJS guard ordering).

---

### D230 — Mailto unsubscribe deferred to manual-only at launch

**Rule.** The Unsubscribe action (D9, D207) at launch supports exactly one
automated path: **RFC 8058 one-click HTTP POST** to the URL in
`List-Unsubscribe` paired with `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.

When only a `mailto:` `List-Unsubscribe` header exists, DeclutrMail does
**NOT** auto-send an unsubscribe email from its no-reply address. Instead:

1. Inline affordance: "Manual unsubscribe — opens in Gmail."
2. CTA opens a Gmail compose draft pre-filled with the mailto address,
   subject, and body (via Gmail's compose deep link).
3. Auto-archive fallback (planned for V2.1) pairs with this path so the
   sender stops appearing in the user's view even when unsubscribe is
   manual.

**Why.** Many list processors reject unsubscribes that don't come from the
subscribed address, so DeclutrMail's no-reply attempts would silently fail
("I clicked unsubscribe — why am I still getting emails?"). Doubly
trust-damaging: sending the user's email FROM DeclutrMail's address with
the user's email in the body feels invasive even when technically benign.
Manual mailto preserves the trust wedge until `gmail.send` scope and a
proper send-as-user path land.

**How to apply.** D9 reverbed by inline patch below. Telemetry: when
mailto-only encountered, record `unsubscribe.manual_path_shown` for
activation tracking. D34's action sheet for Unsubscribe shows two outcomes
based on header type: "One-click" (RFC 8058 path) or "Manual via Gmail"
(mailto path). D208 preview distinguishes these clearly.

---

### D231 — `GmailOpenLinkService` with tested fallback strategies

**Rule.** Every "open in Gmail" deep-link in DeclutrMail goes through
`GmailOpenLinkService` (lives in `apps/web/lib/gmail/openLink.ts`). The
service selects a strategy in this order:

1. **`#all/<gmail_message_id>`** — opens by Gmail's internal message ID
   regardless of label/folder. Preferred when the message ID is fresh
   (synced within last 24h).
2. **`#search/from:{sender_email}+subject:{subject}+after:{date-1d}+before:{date+1d}`**
   — privacy-preserving fallback that does not require storing `Message-ID`.
   Used when (a) the `#all/<id>` link has been observed to fail OR
   (b) feature flag `gmail_deeplink_search_fallback=true`.

**`Message-ID` is explicitly NOT stored.** D7's no-headers privacy posture
is preserved. The search fallback is the cost of that choice.

**Multi-account handling:** does NOT use `/u/0`, `/u/1` indexing (depends
on browser Gmail tab order). Uses `?authuser=<email>` query parameter,
which Gmail resolves server-side to the correct account.

**Why.** `#inbox/<id>` breaks when the message is archived or labeled out
of inbox. `/u/0` depends on browser tab order, not backend account order.
The current plan would scatter brittle URLs across 10+ components.
Centralizing the service prevents quiet breakage as Gmail evolves its web
URLs.

**How to apply.** `GmailOpenLinkService` exposes
`buildOpenLink({mailbox_email, gmail_message_id, sender_email, subject, internal_date}): string`.
Playwright smoke tests (D183) cover: inbox message, archived message,
label-only message, multi-account browser. Architecture Guardian rejects
any component constructing a Gmail URL outside the service. D41 reverbed
by inline patch below.

---

### D232 — Account deletion respects undo windows (max-of, or typed waiver)

**Rule.** The flat 7-day account-deletion grace window (D216) is replaced
with:

> **Effective deletion time = `max(now + 7 days, latest_undo_expires_at)`**

where `latest_undo_expires_at = MAX(expires_at) FROM undo_journal WHERE
user_id = ?`. Pro 30-day undo windows can extend deletion to T+30 in the
worst case.

**Waiver path.** User can override with explicit typed confirmation:

- UI shows: "Deleting your DeclutrMail account permanently removes the
  data required to undo recent DeclutrMail actions. You have N undoable
  actions, the latest expiring in M days."
- To waive: user types literal string `DELETE AND WAIVE UNDO` into a
  confirmation input. Without exact match, deletion stays scheduled at the
  max-of date.

**Pause sync while pending.** Once deletion is scheduled, sync is paused
(D205) regardless of OAuth state. Without this, "delete inbox data while
OAuth stays connected" would silently repopulate the index from Gmail.

**Why.** D216's flat T+7 grace breaks the undo trust promise for Pro users
who took a destructive action shortly before requesting deletion. The fix
preserves the contract ("undo always works for its full window") and gives
users an explicit override when they truly want immediate deletion.

**How to apply.** D216 reverbed by inline patch below.
`AccountDeletionOrchestrator` (D205) reads `MAX(expires_at) FROM undo_journal`
at schedule time. Deletion job at `effective_deletion_time` enqueues via
`cronPolicy` (D225) with `scheduled_at_minute` keyed on the computed time.
Settings → Account UI (D216) shows the computed effective date dynamically.

---

### D233 — Offline destructive actions are draft intents, never auto-replay

**Rule.** When the user is offline (D171) and clicks a destructive action
(Archive, Unsubscribe, Later), the action does **NOT** queue in localStorage
for auto-replay on reconnect. Instead:

1. Action stored as a **draft intent** in localStorage:
   `{intent_id, action_type, sender_id, message_ids, captured_at, captured_state_snapshot}`.
2. On reconnect, frontend refetches sender + message state.
3. UI banner: "N actions queued offline. Review before applying." Each
   draft intent renders as a row with:
   - The original action ("Archive 12 messages from Acme")
   - Whether sender/message state has changed since capture
   - "Apply" and "Discard" buttons
4. Only on explicit "Apply" does the mutation execute, with a **fresh**
   idempotency key generated at apply-time.

**No destructive Gmail mutation auto-replays from localStorage.**

Non-destructive offline actions (starring, marking-as-read inside
DeclutrMail UI) can still auto-replay because they're idempotent and
reversible within the app.

**Why.** Stale state + delayed mutation against Gmail = silent damage.
Example: user offline clicks Archive on a sender; reconnects 4 hours later;
in that gap the sender sent an important email; auto-replay archives it
without the user seeing it. Draft-intent + review breaks this gap.

**How to apply.** D171's offline queue is reverbed by inline patch below.
`useOfflineDraftIntents()` hook (D200 Zustand store + localStorage
persistence) owns the queue. `require-preview-before-mutation.sh` (D208)
extends to reject mutations whose `idempotency_key` matches a stored draft
intent unless `confirmed_after_reconnect: true` is set on the mutation
payload.

---

### D234 — Custom-rule production API gated at `is_preset=false`

**Rule.** D197 defers the custom-rule builder UI to V2.1 but keeps the
schema, engine, and routes ready. To prevent agents or power users from
creating a hidden custom-rule API surface before the UX/safety layer ships:

**`POST /api/v1/autopilot/rules` rejects any request with `is_preset=false`
at V2 launch.**

**Allowed at V2 launch:**

- `is_preset=true` requests with `preset_id` in the D192 launch allowlist
  (8 presets).
- Internal test code that bypasses the route handler (forward-compat tests
  insert directly via repository, not via HTTP).

**Allowed when V2.1 unlocks:**

- `is_preset=false` requests when BOTH
  `feature_flag.custom_autopilot_builder_enabled=true` for the workspace
  AND workspace is in the `custom_autopilot_allowlist` table.

Disallowed requests return HTTP **403** with body
`{code: 'custom_rules_not_available', message: 'Custom Autopilot rules launch in V2.1.'}`.

**Why.** D197 says "API endpoints exist with placeholders" — but without
an explicit gate at the API boundary, an agent will faithfully implement
`POST /rules` accepting arbitrary rule shapes, and power users will
scriptably create rules before the safety layer ships. The bug isn't in
the code; it's in the missing gate. (This is the "architecture-ready ≠
externally usable" trap.)

**How to apply.** `AutopilotRulesController.create` (per D201 NestJS
module structure) checks `is_preset` first, then preset_id allowlist, then
feature flag + workspace allowlist. Contract test: `POST /rules` with
`is_preset=false` returns 403 at V2 launch even for authenticated users.
D197 reverbed by inline patch below.

---

### D235 — Partitioning deferred behind measured thresholds

**Rule.** `mail_messages` and other high-volume tables (D150) launch
**unpartitioned**, with the following composite indexes:

- `(mailbox_id, sender_id, received_at DESC)` — sender-detail queries
- `(mailbox_id, received_at DESC)` — recent-mail queries
- `(mailbox_id, gmail_thread_id)` — thread lookups
- `(provider_message_id)` UNIQUE — webhook dedup

Partitioning is deferred until **either** trigger fires:

- **Volume trigger:** `mail_messages` row count exceeds **25M** total OR
  any single mailbox exceeds **2M rows**.
- **Performance trigger:** p95 sender-detail query latency exceeds
  **150ms** for 7 consecutive days after index tuning, AND query plan
  analysis confirms partitioning would help.

When triggered, a separate ADR documents the partitioning strategy (hash
on `mailbox_id`, 16 partitions as starting point), the migration plan
(Atlas multi-step with online table copy), and the rollback plan.

**Why.** Upfront Postgres hash partitioning adds real Atlas + Drizzle
complexity (partitioned table introspection, partition pruning
verification, migration ordering) for a problem the founder doesn't have
at 0-1K users. Ship V2 fast; don't solve 50M-row scale before beta.

**How to apply.** D150 reverbed by inline patch below. Grafana dashboard
(D159 area) gains panels for `mail_messages` row count, per-mailbox row
count percentile, and sender-detail p95 latency. Alerts at 80% of each
threshold. Architecture Guardian: no PR adds `PARTITION BY` syntax to a
Drizzle table at V2.

---

## Inline patches (Round 2; applied below)

### [GRILL2 PATCH 2026-05-18 on D7]
**Privacy badge copy replaced per D228.** D7's "Bodies read: 0 forever"
badge is removed. New badge: "Full bodies fetched: 0" + explicit storage
list (see D228 body). D7's underlying behavior (Gmail snippet only, never
full body/MIME/attachments) is unchanged; only the copy changes.

### [GRILL2 PATCH 2026-05-18 on D9]
**Mailto unsubscribe deferred to manual-only per D230.** D9's
List-Unsubscribe handling: keep RFC 8058 one-click POST path as
described. Remove the mailto auto-send branch. Replace with: "When only
`mailto:` exists, show 'Manual unsubscribe — opens in Gmail' affordance;
CTA opens Gmail compose draft pre-filled." Auto-archive pairing deferred
to V2.1.

### [GRILL2 PATCH 2026-05-18 on D29]
**Verb canonicalization per D227.** D29's "Screen as the 4th verb (S key)"
reverbs to "Later as the 4th verb (L key)." Internal enum
`triage_decision.verdict='screen'` is unchanged (per D227, "Screen" is the
internal name; "Later" is the user-facing verb).

### [GRILL2 PATCH 2026-05-18 on D34]
**Action sheet labels per D227.** D34's action sheet shows verbs in K/A/U/L
order with labels "Keep, Archive, Unsubscribe, Later." "Remember
preference" toggle behavior is unchanged (per D226 it skips the sheet UI,
not the preview).

### [GRILL2 PATCH 2026-05-18 on D40]
**Action toolbar verbs per D227.** D40's "K/A/U/S" reverbs to "K/A/U/L."
The Sender Detail action toolbar shows Keep / Archive / Unsubscribe /
Later in that order.

### [GRILL2 PATCH 2026-05-18 on D41]
**Gmail deep links via `GmailOpenLinkService` per D231.** D41's hardcoded
`https://mail.google.com/mail/u/0/#inbox/<id>` pattern is removed. All
Gmail deep links go through `GmailOpenLinkService.buildOpenLink(...)`
which selects `#all/<id>` as primary and `#search/from:…+subject:…+after:…+before:…`
as fallback. Multi-account via `?authuser=<email>`, not `/u/0`. No
`Message-ID` storage (privacy posture preserved per D7).

### [GRILL2 PATCH 2026-05-18 on D81]
**"Press S" reverbs to "Press L" per D227.** D81's Triage shortcut for
Decide Later is **L**, not S. Pro 30-day undo language in D81 is
unchanged.

### [GRILL2 PATCH 2026-05-18 on D109]
**Onboarding privacy badge per D228.** D109's onboarding screens that
display the trust badge use the D228 copy ("Full bodies fetched: 0" +
explicit storage list). Stage indicator UX is unchanged.

### [GRILL2 PATCH 2026-05-18 on D122]
**Canonical verb name confirmed: "Later" not "Decide later".** D122
introduced "Decide later" as the verb name. D227 shortens the canonical
button label to **"Later"** (single word, matches K/A/U/L shortcut
mnemonic). "Decide later" remains acceptable as descriptive copy in
tooltips and onboarding, but the action button label is "Later."

### [GRILL2 PATCH 2026-05-18 on D150]
**Partitioning deferred per D235.** D150's partitioning specification for
`mail_messages` and related high-volume tables is removed at V2 launch.
Tables launch unpartitioned with composite indexes (per D235). Partitioning
triggers at 25M rows OR 2M rows/mailbox OR p95 > 150ms sustained 7 days.

### [GRILL2 PATCH 2026-05-18 on D171]
**Offline destructive actions as draft intents per D233.** D171's
localStorage offline queue stores draft intents only for destructive
actions (Archive, Unsubscribe, Later). On reconnect: refetch state, show
review banner, require explicit Apply per intent. Non-destructive offline
actions retain auto-replay behavior.

### [GRILL2 PATCH 2026-05-18 on D180]
**Pub/Sub verification contract per D229.** D180's verification clause
replaces wholesale with the D229 OIDC checklist (Authorization Bearer →
JWKS sig → iss → aud → email → exp → messageId dedup → historyId
monotonic). `x-goog-authenticated-user-email` is NOT used. Failures
return 401.

### [GRILL2 PATCH 2026-05-18 on D197]
**Custom-rule API gated per D234.** D197 already defers the UI; D234 adds
the production API gate: `POST /autopilot/rules` rejects `is_preset=false`
at V2 launch with HTTP 403. V2.1 unlock requires both
`custom_autopilot_builder_enabled` flag AND workspace allowlist row.

### [GRILL2 PATCH 2026-05-18 on D205]
**Deletion orchestrator reads undo journal per D232.**
`AccountDeletionOrchestrator` (D205) computes
`effective_deletion_time = max(now + 7 days, MAX(expires_at) FROM undo_journal)`
at schedule time. Sync is paused once deletion is scheduled, regardless
of OAuth state.

### [GRILL2 PATCH 2026-05-18 on D207]
**K/A/U/L card verbs per D227.** D207's "Discover→Decide→Automate→Audit→Undo"
load-bearing principle is unchanged. The "Decide" stage exposes K/A/U/L
verbs (not K/A/U/S). All product cards, Storybook, and microcopy use the
canonical K/A/U/L labels.

### [GRILL2 PATCH 2026-05-18 on D210]
**D227 sequencing prerequisite.** D210 (Storybook-before-features) cannot
begin until D227 (canonical verbs) lands. Implementation order:
D187 freeze sequencing → D227 canonical verbs → D210 Storybook seed →
remaining feature work. Architecture Guardian enforces this in the
implementation-order doc.

### [GRILL2 PATCH 2026-05-18 on D216]
**Effective deletion time per D232.** D216's flat T+7 grace window is
replaced by `max(now + 7 days, latest_undo_expires_at)` with a typed
waiver path (`DELETE AND WAIVE UNDO`). Settings → Account UI displays the
computed effective date dynamically as the user's undo journal evolves.

### [GRILL2 PATCH 2026-05-18 on D217]
**Privacy & Data settings badge per D228.** D217's Privacy & Data sub-page
shows the D228 badge copy. The page's other sections (data export, account
deletion link, OAuth scopes display) are unchanged.

### [GRILL2 PATCH 2026-05-18 on D223]
**Landing headline trust line per D228.** D223's landing page primary
headline is unchanged. The supporting trust badge below the hero uses
D228 copy ("Full bodies fetched: 0" + storage list), not "Bodies read: 0
forever."

---

# 🎨 UI Constitution — Updated for D227-D235

Five new rows added (Constitution now totals 40 rows):

| Rule | D | One-line statement | Enforcer |
|---|---|---|---|
| **Canonical verbs** | **D227** | **K/A/U/L only in product UI; "Screen" is internal enum, never user-facing** | **`check-microcopy.sh --rule=canonical-verbs`** |
| **Privacy badge copy** | **D228** | **"Full bodies fetched: 0" + explicit storage list; "Bodies read: 0" is banned** | **`check-microcopy.sh --rule=privacy-badge`** |
| **Pub/Sub auth** | **D229** | **OIDC Bearer JWT (iss/aud/email/exp + JWKS) — never `x-goog-authenticated-user-email`** | **Architecture Guardian + OIDC contract test** |
| **Gmail deep links** | **D231** | **All Gmail URLs via `GmailOpenLinkService`; `#all/<id>` primary, search fallback; `?authuser=` for multi-account** | **Architecture Guardian** |
| **Offline drafts** | **D233** | **Destructive offline actions become draft intents requiring post-reconnect confirmation** | **`require-preview-before-mutation.sh` extended check** |

The `check-microcopy.sh` hook now carries 4 named-rule modes total:
`canonical-verbs` (D227), `privacy-badge` (D228), `screener` (D194),
`framing` (D221). Hook count stays at **10**.

---

# 🎯 Round 2 Summary

| # | Decision | Patches prior D(s) |
|---|---|---|
| D227 | Canonical K/A/U/L verbs | D29, D40, D81, D122, D207 |
| D228 | Privacy badge rewrite | D7, D109, D217, D223 |
| D229 | Pub/Sub OIDC verification | D180 |
| D230 | Mailto manual-only | D9 |
| D231 | `GmailOpenLinkService` | D41 |
| D232 | Deletion respects undo | D205, D216 |
| D233 | Offline draft intents | D171 |
| D234 | Custom-rule API gate | D197 |
| D235 | Partitioning deferred | D150 |

**Explicit reject from Codex Grill Round 2:** flag defaults (#9). D188's
default-true posture for Brief / Snoozed / Followups / Quiet is intentional
— flags are emergency kill switches at launch, not cohort-learning
instruments. Documented in D188.

**Implementation sequencing prerequisite (new):**
D187 freeze → **D227 canonical verbs** → D210 Storybook seed → feature
work. Codified in inline patch on D210.

**Plan file decision count: 235 numbered decisions** + 5 original inline
patches + 9 audit patches + **19 Round 2 patches** + 3 reversal markers
across 5 phases.

**Hook inventory unchanged at 10.** `check-microcopy.sh` carries 4
named-rule modes (canonical-verbs, privacy-badge, screener, framing) plus
its base copy enforcement.

**UI Constitution rows: 40** (was 35; +5 from Round 2).

**Promoted shared component count unchanged at 9.**

---

## Variant D Senders uplift patches — 2026-05-25

Five inline patches applied via four ADRs in PR #62
(`chore/bootstrap-senders-uplift-d-adrs`). All ADRs `Accepted`
2026-05-25. See `docs/adr/0009-0012` for full rationale.

### [ADR-0009 PATCH 2026-05-25 on D2] — Dashboard palette extension

The D2 cool/Vercel/restrained palette is unchanged for the product as
a whole. Dashboard surfaces (Senders, Activity, Brief, future
Insights) may additionally import a single new accent — violet
`#7C3AED` — under `color.dashboard.{accent, accentSoft, accentBorder}`
for live/active affordances and active-filter-chip state ONLY.

Forbidden everywhere: violet on action buttons, on trust affordances,
on recommendation tones, on any non-dashboard surface. See ADR-0009
for the consumer convention + future ESLint guardrail.

### [ADR-0010 PATCH 2026-05-25 on D213] — Dashboard motion budget extension

D213's allowlist gains three patterns on dashboard surfaces, all
reusing existing duration tokens, all gated by
`prefers-reduced-motion: reduce`:

1. Sparkline draw-on (400 ms, once per component mount)
2. Inline receipt-strip slide in/out (250 ms, reuses `dm-toast-in`)
3. Group chevron rotate on expand/collapse (150 ms)

Activity-pulse dot, stagger-on-first-load, and counter-tick animation
are explicitly REJECTED. D213's forbidden list (confetti, bouncy,
animated charts, idle pulse, page transitions >300 ms) is unchanged.
See ADR-0010.

### [ADR-0011 PATCH 2026-05-25 on D209] — Editorial copy voice scope

D209's forbidden-word list and trust-first rule continue to apply
everywhere unchanged. D209's "purely descriptive, no editorial
framing" rule is RELAXED on two surfaces only: hero strips and
first-class empty states (D212). On those surfaces, copy may include
ONE editorial framing phrase per surface (e.g., "Only 18% were worth
reading."). Action buttons, confirms, receipts, errors, and all
non-hero / non-empty surfaces remain strictly functional. `check-microcopy.sh`
gets a follow-up `--strict-paths` extension. See ADR-0011.

### [ADR-0012 PATCH 2026-05-25 on D38] — Senders intent-grouped tables

D38's Gmail-category grouping (`primary` / `promotions` / `social` /
`updates` / `forums`) is replaced on the Senders surface by
user-intent grouping derived from existing fields:

- **Clean up** = `triage_decisions.verdict = 'unsubscribe'` (auto-expanded)
- **Move later** = `triage_decisions.verdict = 'archive'`
- **Protect** = `sender_policies.is_vip OR is_protected`
- **People** = everything else

Group ordering is fixed; the Clean up group auto-expands. Gmail
category is retained as a 3 px row stripe + secondary advanced-filter
drawer. No new ML, no new schema, no new wire field — derives from
existing `triage_decisions` rows. D222's no-prediction rule is honored
(the verdict already exists; the grouping just regroups by it). See
ADR-0012.

### [ADR-0012 PATCH 2026-05-25 on D39] — Sender detail page editorial composition

D39's strict layout order (`Header → Recommendation banner → Actions
→ Messages → Stats → Charts → History`) is replaced on Variant D's
detail page with: `Editorial hero card (avatar + Fraunces narrative
+ ROI + recommendation + actions + quiet reasoning disclosure) →
4-cell KPI strip → Recent messages → Decision timeline`. The volume
bar chart + open-rate line chart from D45 and the table-style
history from D46 are dropped — the heatmap was prototyped and
rejected ("chart adds noise"). KPI strip absorbs D44's stats. See
ADR-0012 + `~/.claude/plans/how-can-we-uplift-foamy-cloud.md` §D2.

---

**Patch count post-2026-05-25:** 235 decisions + 5 original inline +
9 audit + 19 Round 2 + **5 ADR-0009/10/11/12 patches** + 3 reversal
markers across 5 phases.

