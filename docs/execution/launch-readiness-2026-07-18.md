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

### Step 1 — Decide refund terms (P0, ~10 min, unblocks step 2)

Three public surfaces disagree: plan D121 "30-day Pro" · `/refunds` §3
"14-day pro-rata (Pending confirmation)" · landing FAQ + JSON-LD "30-day
every paid plan".

1. Pick one: **(a) 30-day, all paid plans** (recommended — matches the FAQ
   crawlers already read), (b) 30-day Pro only, (c) 14-day pro-rata.
2. Also confirm `/terms` §10 governing law: India/Mumbai — yes/no.
3. Tell the agent the picks → one copy-pass PR fixes `/refunds`, FAQ
   (visible + JSON-LD together), `llms.txt`, removes both "Pending
   confirmation" markers.

✅ Done when: all three surfaces state identical terms; no marker left.

### Step 2 — Create two mailboxes (P0, ~10 min)

Legal pages reference `privacy@declutrmail.com` + `support@declutrmail.com`.

1. Mail host → add both as aliases to your inbox.
2. Send a test mail to each.

✅ Done when: both test mails land.

### Step 3 — Deletion-reachability check (P0, ~15 min, agent-runnable)

July-08 audit: account deletion may be unreachable after disconnecting the
last mailbox.

1. Ask the agent to smoke it: disconnect sole mailbox on dev → Settings →
   deletion path must render.
2. If broken: small routing fix, same-day PR.

✅ Done when: deletion flow reachable in the zero-mailbox state.

### Step 4 — verify-d backlog (P1, agent-runnable, run before launch day)

49 D-rows merged but never verified (list in FOUNDER-FOLLOWUPS 2026-06-29
entry). Ask the agent to batch-run `pnpm verify-d D###` and report
failures as real gaps.

✅ Done when: backlog rows flip 🔵→🟢 or have a logged gap.

### Step 5 — Two conscious decisions (P1, ~5 min each; "defer" is valid)

- **Real-time webhooks:** Pub/Sub push subscription not created → new mail
  lands via 5-min drift sweep (5–15 min latency). Fine at launch scale.
  Decide: create subscription now (steps in the 2026-05-21 followup) or
  defer. Recommended: **defer**.
- **Billing:** stays dark (verified fail-closed). Run the §9 go-live in
  `billing-go-live-runbook-2026-07-17.md` only AFTER step 1 lands.
  Recommended: **launch free-first, billing later**.

### Step 6 — D247 grouping: post-launch (recommended)

Branch parked. Finishing it (API + FE toggle) is ~2 PRs + a prod
migration — don't spend launch week on it. Say "finish D247" whenever
ready.

### Step 7 — Launch day

1. Re-run the read-only prod smoke (agent: "re-run launch smoke") — expect
   the same all-PASS results as §1.
2. Announce.

Post-launch hygiene queue (no dates): `GET /api/healthz` for uptime
monitoring · WeeklyHero dead-code removal · D247 finish.

---

**Trust posture:** "Full bodies fetched: 0" + generated storage list +
honest counts — intact and verified. Nothing above trades trust for speed.
