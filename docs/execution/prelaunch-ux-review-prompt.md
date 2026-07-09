# Pre-Launch UX / Feasibility / Retention Review Prompt

> **Purpose.** Paste this entire document into Claude (or another coding agent with
> repo access) to run a structured, product-context-aware review of DeclutrMail
> before public launch. The agent should produce findings, not rewrite the product
> unless asked.
>
> **How to use.** Open a fresh Claude session in this repo. Paste everything below
> the `---` line. Optionally attach: `CLAUDE.md`, this file, and
> `docs/execution/prelaunch-enhancement-recommendations.md`.

---

You are reviewing **DeclutrMail**, a Gmail cleanup SaaS (V2, pre-launch / open beta).
You have the full codebase. Your job is **user-facing quality**: usability,
comprehension, feasibility of the promised experience, retention docs, SEO/AEO/GEO,
and pre-launch risk — not architecture purity for its own sake.

## Product in one paragraph

DeclutrMail cleans Gmail by **sender**, not message. The user decides once per
sender using five verbs — **Keep · Archive · Unsubscribe · Later · Delete**
(shortcuts **K/A/U/L/D**). Every destructive action shows a **mandatory preview**,
then mutates Gmail, then is undoable for a plan-tied window (7d Free/Plus, 30d Pro).
Privacy is the wedge: **Full bodies fetched: 0** — only sender, subject, Gmail
snippet, dates, labels, read/unread are stored. Never bodies, attachments, MIME,
or non-allowlisted headers.

## Hard product invariants (do not recommend violating these)

1. **No body storage** (D7, D228) — trust badge copy is exactly
   `"Full bodies fetched: 0"` + the locked storage list. Never
   `"Bodies read: 0 forever."`
2. **Canonical verbs only** — K/A/U/L/D in all product UI. "Screen" is an
   internal enum only; "Screener" is a feature name.
3. **Action lifecycle** — intent → (optional sheet) → **preview** → mutation → undo.
   Preview is never skippable.
4. **No category prediction / auto-protect via ML** (D222) — banned forever.
5. **Mailto unsubscribe is manual** (D230) — prepare, never auto-send.
6. **Offline destructive actions are draft intents** (D233) — never auto-replay.

Source of truth precedence: CLAUDE.md §2 hard rules → latest D-decision in
`docs/execution/Implementation-Plan.md` → ADRs in `docs/adr/` → codebase conventions.

## What already ships (public + app)

### Marketing (public)

`/`, `/pricing`, `/beta`, `/help`, `/contact`, `/security`, `/privacy`, `/terms`,
`/refunds`, `/cookies`

SEO assets already present: `sitemap.ts`, `robots.ts`, `public/llms.txt`,
per-page OG/Twitter via `marketingPageMetadata()`, Organization/WebSite/
SoftwareApplication JSON-LD, FAQPage JSON-LD on landing + `/help`.

### Onboarding

`/onboarding` — Promise → Connect → Sync gate → Preset pick → First triage.

### Authed app

`/senders`, `/senders/[id]`, `/triage`, `/brief`, `/followups`, `/snoozed`,
`/screener`, `/quiet`, `/activity`, `/autopilot`, `/billing`, `/settings`,
`/settings/senders`, `/settings/privacy`, `/admin/security` (allowlist only).

Nav labels flip plain vs power-user (`use-labels.ts`): e.g. "People & lists" vs
"Senders", "Today" vs "Triage".

### Planned but NOT shipped (D132 Tier 2–5 — growth)

`/methodology`, `/vs/*`, `/how-to/*`, `/answers/*`, `/blog`, `/changelog`,
`/inbox-simulator`, full Help Center (deferred D219 → V2.1).

## Locked copy & trust surfaces

- Privacy copy module: `packages/shared/src/copy/privacy.ts`
- Verb registry: `packages/shared/src/actions/verb-registry.ts`
- Help FAQ: `apps/web/src/app/(marketing)/help/page.tsx`
- Landing FAQ: `apps/web/src/features/marketing/landing/faq.tsx`
- `llms.txt`: `apps/web/public/llms.txt`
- Microcopy enforcement: `.claude/hooks/check-microcopy.sh`

When you propose copy changes that touch privacy/refunds/storage claims, quote
locked modules verbatim — never paraphrase trust claims.

## Known open friction (check these; do not rediscover blindly)

From FOUNDER-FOLLOWUPS / LEARNINGS / MISTAKES (as of 2026-07-09):

- Cookie consent (D147) must gate PostHog before prod analytics key is set.
- Apex `declutrmail.com` may still be a Squarespace placeholder; prod app is on
  `app.declutrmail.com` — HTTP 200 ≠ real content.
- Mobile overflow / topbar mailbox switcher clipping at 375px (partially fixed).
- No-active-mailbox gate must still allow `/settings` + `/billing`.
- Billing may be dark (`BILLING_ENABLED=false`) while UI shows tiers — honesty gap.
- Pro-gated nav items (Screener, Brief, Followups) show upsells — check confusion.
- Unsubscribe honesty: "Unsubscribes" (actions) vs "Unsubscribe confirmed".
- Sync "stuck" class: poll-driven UIs look frozen in background tabs.
- Refund terms must stay identical across landing FAQ, `/refunds`, `llms.txt`.

## Your mission (do all five tracks)

### Track A — Usability & comprehension (primary)

Walk every user-facing route as a **first-time Gmail user who is privacy-anxious
and not a power user**. For each screen / flow, answer:

1. **What is this screen for?** (one sentence a stranger would say)
2. **What should I do next?** Is the primary action obvious within 3 seconds?
3. **What jargon or product nouns need a pointer?** (tooltip, empty-state line,
   help link, inline definition). Flag: Senders vs People, Triage, Screener,
   Autopilot Observe/Active, Later vs Snoozed, Quiet hours, VIP/Protect, Brief,
   Followups, standing policies, domain rollup, undo windows.
4. **Where can a wrong click feel irreversible?** Does preview + undo copy make
   the safety net obvious _before_ fear spikes?
5. **Empty / error / loading / gated states** — do they teach, or dead-end?
6. **Mobile (375px) + keyboard** — can the core ritual (K/A/U/L/D) still work?

Produce a table:

| Surface | Confusion risk (H/M/L) | What users may misunderstand | Recommended pointer (copy location) | Effort |

Prioritize **activation** (landing → OAuth → sync → first successful Archive or
Unsubscribe) and **safety comprehension** (preview, undo, privacy badge).

### Track B — Feasibility of the promised experience

Compare marketing claims vs actual product behavior. Flag overclaims:

- Privacy badge / storage list vs real Gmail scopes and stored fields
- "One decision per sender" vs message-level edge cases
- Unsubscribe one-click vs mailto-manual paths
- Undo window lengths by tier
- Autopilot Observe → Active expectations vs real trigger latency
  (webhook vs 5–15 min drift sweep)
- Billing / refunds when `BILLING_ENABLED` is false
- Beta vs "production ready" tone on `/beta`

For each overclaim: **claim → evidence path → severity → fix (copy or product)**.

### Track C — Public docs for retention (what we should have)

Audit what exists vs what a retention-minded SaaS needs at launch. Recommend a
**minimum public docs set** with priority:

**P0 — must exist before paid traffic**

- Privacy, Terms, Refunds, Security, Cookies (exist — audit accuracy + consistency)
- Help/FAQ covering: storage, verbs-in-Gmail-terms, unsubscribe paths, undo,
  disconnect, delete account, Autopilot modes, contact SLA (exists — gap-fill)
- Contact with working `support@` / `privacy@`
- In-app: first-run pointers, empty states that link to `/help#slug`

**P1 — strongly improves activation + retention in first 30 days**

- Methodology / "how we calculate impact" (planned `/methodology`)
- Getting-started guide (3–5 steps; can live as `/help#getting-started` first)
- What each verb does (deep linkable; partially in `/help#verbs-in-gmail-terms`)
- Disconnect / delete / export runbook (user-facing, not ops)
- Billing FAQ: cancel, refund, plan change, Founding Pro
- Status / known limitations during beta
- Changelog (even a thin `/changelog`)

**P2 — growth / SEO / AEO (D132 Tiers 2–4)**

- `/vs/*` comparisons (honest "choose them if…" callouts per plan)
- `/how-to/*` intent pages
- `/answers/*` AEO/GEO answer pages (question-as-H1, direct answer in first 2
  sentences, FAQ/HowTo JSON-LD, cite privacy claims from locked module)
- Inbox simulator (D133) as no-signup trial of the ritual

For each missing doc: **audience, job-to-be-done, proposed URL, source-of-truth
copy module, success metric** (e.g. time-to-first-action, support ticket rate).

### Track D — SEO / AEO / GEO (current industry standard)

Review what is shipped and what is missing against 2026 norms:

**SEO (search engines)**

- Unique title/description/canonical/OG per public page
- `sitemap.xml` + `robots.txt` (authed paths disallowed)
- Internal linking: landing ↔ help ↔ pricing ↔ security ↔ methodology
- Core Web Vitals / noindex on app + onboarding (already intended)
- Comparison + how-to content clusters (not shipped)
- Avoid thin/duplicate FAQ across `/` and `/help` — complementary, not cloned

**AEO (answer engines — Google AI Overviews, featured snippets)**

- Question-form H1/H2s with a direct answer in the first 40–60 words
- FAQPage / HowTo / SoftwareApplication JSON-LD that mirrors visible text
- Single-source Q&A arrays (no parallel copy drift)
- Cite verifiable claims (storage list, OAuth scope, undo windows)

**GEO (generative engine optimization — ChatGPT, Perplexity, Claude browsing)**

- Accurate `llms.txt` aligned with sitemap + locked privacy/refund copy
- Clear entity definition: what DeclutrMail is / is not (Gmail-only, metadata-only)
- Authoritative pages agents can quote: `/security`, `/privacy`, `/help`, `/methodology`
- Avoid contradictory numbers across surfaces (refund days, undo days, prices)

Deliver: **gap list with file paths**, plus a **content calendar outline** for the
first 8 weeks post-launch (Tier 3/4 pages from D132) without inventing fake stats.

### Track E — Pre-launch enhancement recommendations

Recommend only high-leverage items before launch. Group as:

1. **Block launch** (trust, legal, billing honesty, data-loss, OAuth verification)
2. **Block paid conversion** (checkout live, refunds consistent, entitlement UX)
3. **Block retention** (aha-moment clarity, undo discoverability, support path)
4. **Nice after first 50 users** (growth pages, simulator, testimonials)

Include: cookie consent before PostHog key; domain/DNS cutover; transactional
email; Gmail watch/Pub/Sub; account deletion execution approval; mobile smoke;
plain-language mode default for first session; in-product "why this
recommendation" pointers; activity honesty for async unsubscribe.

Do **not** recommend category prediction, body reading, auto-mailto, or skipping
preview.

## Method constraints

- Read the code and rendered copy. Prefer file-path evidence.
- Do not propose redesigns that fight the design freeze / Storybook source of
  truth unless a comprehension failure is severe.
- Prefer **pointers** (one sentence, tooltip, empty-state, help deep-link) over
  new features.
- Surgical: every recommendation must map to a user failure mode.
- If something needs a founder decision (legal, refund scope, domain, deletion),
  mark **FOUNDER** — do not invent policy.
- Respect CLAUDE.md §9 stop-conditions (OAuth scopes, token crypto, prod
  migrations, billing webhooks, account deletion, privacy retention, webhook auth).

## Smoke checklist (run if stack is available)

If `./scripts/cloud-smoke.sh` or `./scripts/dev-up.sh` works:

1. Marketing: `/` `/pricing` `/help` `/privacy` `/security` `/refunds` — content
   (not just HTTP 200), `og:image` present, FAQ JSON-LD matches visible Q&A.
2. `llms.txt` + `sitemap.xml` + `robots.txt` consistency.
3. Dev-login → `/senders` → filters → single action with preview → undo.
4. `/triage` → K/A/U/L/D → undo tray / `Z`.
5. Mailbox switch (two seeded accounts) → scoped cache resets.
6. Pro upsells on gated routes when tier is free.
7. `/settings` + `/billing` reachable with no active mailbox.
8. `/cookies` + consent behavior if D147 is present.
9. 375px pass on senders, triage, topbar, brief/followups/snoozed.
10. Console: no 409-storm on sync status; no privacy copy violations.

If the stack cannot run, do a **static route + copy audit** and label smoke as
BLOCKED with exact missing dependency.

## Output format

1. **Executive verdict** (5–8 sentences): launch readiness for private beta vs
   public paid launch.
2. **Top 15 user-comprehension risks** (ranked), each with pointer fix.
3. **Public docs matrix** (Have / Partial / Missing) with P0–P2.
4. **SEO / AEO / GEO gap list** with file paths.
5. **Enhancement backlog** grouped Block-launch / Block-paid / Block-retention /
   Post-50-users.
6. **Smoke results table** (Pass / Fail / Blocked / N/A).
7. **Founder decisions needed** (bullets only).

Start by reading `CLAUDE.md`, then the marketing pages and onboarding/triage/
senders entry screens, then produce the report. Do not open a PR unless asked.
