# Launch Readiness — 2026-07-18

> **Goal:** public launch within one week (by ~2026-07-25) without reducing
> trust. This doc is the single founder checklist: what was smoked today,
> what passed, and the ordered list of founder actions that remain.
>
> Everything in §1 was verified TODAY (2026-07-18) against live prod or the
> dev stack with real mailbox data. Nothing here is assumed.

---

## 1. Verified today — production surface smoke (all PASS)

Read-only prod checks, zero side effects:

| Surface                                                                         | Result                                                                                                                                |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `declutrmail.com` marketing                                                     | 200                                                                                                                                   |
| `app.declutrmail.com` anon                                                      | 200 shell, **zero sender data in HTML** (client AuthProvider gate, U03 design)                                                        |
| `/senders` anon                                                                 | shell only, no data leak                                                                                                              |
| **Gmail webhook (D229)** — unauthenticated POST to `/api/webhooks/gmail/pubsub` | **401** with proper error envelope. OIDC gate live                                                                                    |
| **Billing webhooks** (Paddle/Razorpay), no signature                            | **503 fail-closed** — dark-launch kill switch working as designed                                                                     |
| **Dev test-login backdoor** — 3 URL variants, both hosts                        | **404 on all**, no cookie, no redirect (triple gate: env flag + allowlist + user check)                                               |
| Security headers (both hosts)                                                   | HSTS 1y, `X-Frame-Options: DENY`, CSP `frame-ancestors 'none'` + nonce + strict-dynamic, nosniff, Referrer-Policy, Permissions-Policy |
| `/privacy` `/terms` `/refunds`                                                  | 200                                                                                                                                   |
| `robots.txt` + `sitemap.xml`                                                    | 200; robots disallows app routes; `/beta` now IN sitemap (July-08 "orphaned" finding fixed)                                           |
| TLS                                                                             | marketing exp Oct 8, app/api exp Sep 6 — auto-renewing                                                                                |

Dev-stack smoke with real data (7,904-sender mailbox, migrated DB at 0047):

- Senders grid + table render clean, zero console errors.
- Mailbox switch (main ↔ crypt account): scoped cache resets correctly, no
  stale-count bleed-through, honest "synced 51d ago" on the idle account.
- Sort relabel verified live: `?sort=first_seen` chip reads **"Newest arrivals"**.
- Tests: db 73/73, web senders suites 1311/1311 across 144 files.
- Migration 0047 (D247 foundation): applied, 7,901/7,901 rows populated,
  rollback verified, CI-pinned Atlas v0.37.0 lint passes.

**Bottom line: no code launch-blocker was found. Every remaining item below
is a founder decision, a copy pass, or an external-account action.**

---

## 2. Founder actions — ordered, trust-first

### P0 — trust contradictions (fix before any public traffic)

**2.1 Refund-guarantee drift — three surfaces, three different terms.**

- D121 (plan): 30-day money-back on Pro. `/refunds` §3: 14-day pro-rata,
  shipped "Pending confirmation". Landing FAQ (+ FAQPage JSON-LD): "30-day
  money-back guarantee on every paid plan".
- **Decide the canonical guarantee** (recommendation on file 2026-07-07:
  30-day all-paid-plans). Then one copy-pass PR aligns `/refunds` §§2–3,
  `faq.tsx` (visible + JSON-LD update together), optionally `llms.txt`.
- Verifies by: all three surfaces identical; "Pending confirmation" marker gone.

**2.2 Legal-page markers + mailboxes.**

- `/refunds` §3 and `/terms` §10 (governing law India/Mumbai) still render
  "Pending confirmation". Confirm both; agent applies copy + bumps stamps.
- Create/alias `privacy@declutrmail.com` + `support@declutrmail.com` at the
  mail host — pages reference them; they must deliver before launch traffic.
- Verifies by: markers gone; test mail to both addresses lands.

**2.3 Account-deletion reachability (July-08 audit trap).**

- Audit finding: deletion could be unreachable after disconnecting the last
  mailbox. Re-check on current main: disconnect sole mailbox → Settings →
  delete account path must still render. If broken, it's a small routing fix —
  flag it and an agent ships it same-day.
- Verifies by: deletion flow reachable in the zero-mailbox state.

### P1 — launch-posture decisions (this week)

**2.4 Billing: launch dark (recommended).**

- Billing is built, shipped dark behind 3 kill switches; nobody can pay or be
  charged. Recommendation: launch free-first, run the §9 go-live sequence in
  `billing-go-live-runbook-2026-07-17.md` only after refund copy (2.1) is
  canonical. No action needed to STAY dark — the smoke confirmed fail-closed.

**2.5 Real-time Gmail webhook path.**

- Pub/Sub topic provisioned; push **subscription** still not created, so new
  mail is picked up by the 5-min drift sweep (5–15 min latency) instead of
  webhooks. Acceptable at launch scale — decide now or defer consciously.
- If wanted: create push subscription → `https://api.declutrmail.com/api/webhooks/gmail/pubsub`
  with the OIDC service account (steps in the 2026-05-21 followup entry).
- Verifies by: `worker.succeeded` with `-delta-` jobId within ~5 min of a test mail.

**2.6 D247 brand grouping: ship the label fix now, finish grouping post-launch (recommended).**

- PR `fix/d247-newest-arrivals-label` (1-line relabel, smoked) — merge this week.
- The server-side grouping foundation (migration 0047 + ADR-0026) is parked on
  `feat/d247-senders-brand-grouping`. Merging it pre-launch would run a prod
  migration for a feature whose API/FE isn't built — defer the whole branch
  post-launch unless you want the migration soaking early. Founder call per §9
  (prod migrations).

### P2 — hygiene (before or shortly after launch)

**2.7 verify-d backlog — 49 stale 🔵 rows.**

- IMPLEMENTATION-LOG has 49 merge-shipped rows never flipped to 🟢-verified
  (list in the 2026-06-29 followup entry). The log is your launch-readiness
  signal; batch-run `pnpm verify-d D###` (agent-runnable) and treat failures
  as real gaps. Recommend: run the batch BEFORE launch day so surprises
  surface while there's still slack.

**2.8 Optional: `GET /api/healthz`.**

- The API host exposes no public unauthenticated route, so there is nothing to
  point an external uptime monitor at. A trivial healthz endpoint closes that
  gap (one small PR). Optional, not a blocker.

**2.9 WeeklyHero dead code.**

- Orphaned BE endpoint + DTOs with zero consumers (2026-07-16 followup). D245
  prelaunch rule says remove directly. One small PR + gates. Post-launch fine.

---

## 3. What today's cleanup PRs change (for your review)

Branch `chore/bootstrap-launch-stale-sweep`:

- `docs/services.md` — Stripe section (D17–D21 assumption) replaced with
  Paddle + Razorpay (D117, actual env keys, dark-launch status).
- `docs/runbooks/secrets-inventory.md` — Stripe slots → Paddle/Razorpay slots;
  rotation cadence updated.
- `apps/api/src/activity/activity.types.ts` — comment referenced deleted
  `decision-queue.md`; reference removed.
- 6 stale session-handoff docs deleted (June d038/senders-v2 series — zero
  inbound references). Kept: `2026-05-30-bulk-actions-final-consensus.md` and
  `2026-05-30-bulk-actions-architecture-codex-review.md` (both still cited by
  MISTAKES.md / LEARNINGS.md / the Action Registry design record).
- `FOUNDER-FOLLOWUPS.md` — D147 cookie-consent entry moved Open → Done with
  evidence (shipped as #282/#289/#320; verified live today: PostHog gated
  behind consent on every call, banner defaults to decline).

Branch `fix/d247-newest-arrivals-label`: the 1-line sort relabel (§2.6).

Branch `feat/d247-senders-brand-grouping` (parked): migration 0047 + schema +
ADR-0026.

---

## 4. Suggested launch-week order

| Day           | Action                                                          | Owner           |
| ------------- | --------------------------------------------------------------- | --------------- |
| Day 0 (today) | Merge relabel + stale-sweep PRs; decide refund terms (2.1)      | Founder         |
| Day 1         | Refund/legal copy-pass PR (2.1 + 2.2); create the two mailboxes | Agent + founder |
| Day 1–2       | Deletion-reachability check (2.3); fix if broken                | Agent           |
| Day 2–3       | verify-d batch (2.7); triage any real gaps it exposes           | Agent           |
| Day 3         | Decide webhook subscription (2.5) + healthz (2.8)               | Founder         |
| Day 4+        | Announce. Billing stays dark until post-launch §9 sequence      | Founder         |

The trust wedge ("Full bodies fetched: 0" + generated storage list + honest
counts) is intact and verified — nothing in this plan trades trust for speed.
