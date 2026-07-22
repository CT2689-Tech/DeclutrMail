# Launch Checklist — updated 2026-07-19

> **Goal:** public launch by ~2026-07-25 without reducing trust.
> One page. Do §2 top-to-bottom. §1 is already done — context only.

---

## 1. DONE — verified, no action needed

- [x] **Prod security smoke (2026-07-18, read-only): all PASS.** Gmail
      webhook unauth → 401 (D229 OIDC live) · billing webhooks → 503
      fail-closed (dark-launch switches working) · dev-login backdoor →
      404 everywhere, no cookie · full security-header set (HSTS, CSP
      `frame-ancestors 'none'`, DENY, nosniff) · legal pages 200 ·
      robots/sitemap clean, `/beta` indexed · TLS auto-renewing.
      **Zero code launch-blockers found.**
- [x] **App smoke on real data** (7,904-sender mailbox): senders grid +
      table clean, zero console errors; mailbox switch resets scoped
      cache correctly; tests db 73/73, web senders 1311/1311.
- [x] **"Newest arrivals" relabel** — merged as
      [#353](https://github.com/CT2689-Tech/DeclutrMail/pull/353)
      (fixes the "product doesn't match Gmail" perception; data was
      verified correct — 1 row per From-address by design).
- [x] **Stale sweep + this doc** — merged as
      [#354](https://github.com/CT2689-Tech/DeclutrMail/pull/354)
      (Stripe docs → Paddle/Razorpay per D117; dead refs removed; 6
      unreferenced handoffs deleted).
- [x] **D147 cookie consent** — confirmed shipped (#282/#289/#320) and
      verified live: PostHog gated on every call, banner defaults to
      decline. Followup moved to Done. Setting `NEXT_PUBLIC_POSTHOG_KEY`
      in prod is safe.
- [x] **D247 brand-grouping foundation** — migration 0047 + ADR-0026
      built, smoked, **parked** on branch `feat/d247-senders-brand-grouping`
      (see step 6).

---

## 2. YOUR STEPS — in order

### ~~Step 1 — Decide refund terms~~ ✅ DONE (was already shipped)

Founder confirmed 30-day/all-paid-plans 2026-07-19 — and verification showed
it ALREADY shipped 2026-07-08 (PR #308, D121): /refunds, landing FAQ +
JSON-LD (single source), llms.txt, cancel-modal, /help — all identical;
markers gone; guard tests lock the terms. The "drift" followups were stale
(now moved to Done). Optional cosmetic: /pricing page shows no money-back
line (in-app surfaces do) — say the word to add it.

### Step 2 — Mailboxes: add `.com` domain alias (P0, ~10 min) — IN PROGRESS

Workspace aliases (privacy/support/legal/billing/founder@declutrmail.ai)
created 2026-07-19 ✓. Legal pages promise the **.com** addresses; MX for
.com already points to Google.

1. Admin console → Account → Domains → Manage domains → **Add a domain** →
   `declutrmail.com` → type: **domain alias** of declutrmail.ai.
2. Verify ownership (TXT record).
3. Send test mail to `privacy@declutrmail.com` + `support@declutrmail.com`.

✅ Done when: both .com test mails land.

### ~~Step 3 — Deletion-reachability check~~ ✅ DONE 2026-07-19

Smoked in zero-mailbox state (both mailboxes disconnected via SQL, restored
after): Settings renders, "Delete account and data" present + enabled. The
July-08 audit trap is fixed on current main.

### Step 4 — verify-d backlog (P1) — NEEDS ONE FOUNDER PICK

Ran 2026-07-19. Finding: `pnpm verify-d` RECORDS verification, performs
none — bulk-flipping 49 rows would fabricate. Pick one:

- **(a) targeted (recommended):** agent properly verifies the ~10
  launch-critical Ds (privacy/webhook/sync/deletion) and flips only those;
  rest post-launch.
- **(b) honest bulk-ack:** flip all 49 with source "hand-smoked at merge,
  2026-07 batch ack" — your assertion to make, not the agent's.
- **(c) leave 🔵** until post-launch.

✅ Done when: chosen option executed; log reflects reality.

### Step 5 — Billing go-live (founder chose NOT to defer, 2026-07-19)

Full sequence lives in `billing-go-live-runbook-2026-07-17.md`. Founder
starts ① NOW (days of lead time): Paddle seller account + verification
(sandbox account meanwhile) and Razorpay KYC + enable Subscriptions.
Then ② collect API keys → ③ GitHub Actions secrets → ④ run "Provision
billing catalog" workflow (sandbox) + hand agent the manifest patch →
⑤ register webhooks + secrets → ⑥ agent binds Cloud Run secrets + flips
`BILLING_ENABLED` (founder merges) → ⑦ founder sandbox-verifies (buy
Plus/Pro/Founding, cancel, refund; note the Paddle-overlay stale-card
suspect) → ⑧ production cutover + one real purchase-and-refund.
Refund terms already canonical (step 1), so no copy gate remains.

**Real-time webhooks** (separate decision): still deferred by default —
drift-sweep latency 5–15 min is fine at launch scale.

### Step 6 — D247 grouping: PRE-LAUNCH (founder decision 2026-07-19)

In progress. API stage (server-side grouped list, complete counts,
contract tests) building on `feat/d247-senders-brand-grouping`; FE stage
(default-off toggle, table+grid group rows, expand-to-members, client
rollup removal) follows; full dev-login browser smoke before PRs.

### Step 7 — Launch day

1. Re-run the read-only prod smoke (agent: "re-run launch smoke") — expect
   the same all-PASS results as §1.
2. Announce.

Pre-launch detection gate: deploy `GET /api/healthz`, then run
`scripts/setup-uptime-monitoring.sh` and prove the alert reaches the founder.
Post-launch hygiene queue (no dates): WeeklyHero dead-code removal · D247 finish.

---

**Trust posture:** "Full bodies fetched: 0" + generated storage list +
honest counts — intact and verified. Nothing above trades trust for speed.
