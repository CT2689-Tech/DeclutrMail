# Two-account smoke runbook — reviewed PR stack (2026-06-26)

Turnkey local smoke for the 7-PR fix stack (#199 #201 #206 #219 #220 #224 #226).
The cloud review container could NOT run this — no real Gmail OAuth tokens
and Postgres can't run there (sandbox). Per CLAUDE.md §8 the real
OAuth-connected smoke is a founder-hands task; this is the exact checklist.

Every code path below is already covered by integration tests (PGlite +
real migrations) and two adversarial agent reviews; this runbook is the
final live confirmation against your two connected accounts
(`chintan.a.thakkar@gmail.com` + `chintan.a.thakkar.crypt@gmail.com`).

## Setup

```bash
# .env.local: DEV_AUTH_ENABLED=true, DEV_AUTH_EMAIL_PREFIX=chintan
docker compose up -d redis
./scripts/dev-up.sh                       # api :4000 + worker
pnpm --filter @declutrmail/web dev        # web :3000
# Authenticate the dev session:
open "http://localhost:4000/api/auth/dev/login?email=chintan.a.thakkar@gmail.com"
```

Always SQL-force edge states reversibly and RESTORE after (note pre-values first).

## #224 — Data export (CSV injection + mid-stream) — HIGH

1. Pick a sender; set an attacker-style subject on one of its messages:
   `UPDATE mail_messages SET subject='=HYPERLINK("http://evil","x")' WHERE id='<msg>';`
   (note the old subject; restore after).
2. `curl -b <cookie> 'http://localhost:4000/api/account/export?format=csv' -o exp.csv`
   → **PASS:** the cell is `'=HYPERLINK(...)` (leading apostrophe) — open in
   Sheets/Excel, it stays text, does NOT execute. JSON export unaffected.
3. Inspect file keys = D228 allowlist only (no bodies/tokens). Restore subject.
4. (Optional, hard to force) mid-stream failure → truncated download +
   a server `Data export failed mid-stream` log line, never a clean 200.

## #206 — Tier enforcement — HIGH ×2

- **No-op no-charge:** on a `free` workspace, `POST` a 365d-delete on a sender
  with no aged INBOX mail → worker resolves 0 → re-check `/api/auth/me`
  `cleanupRemaining` is UNCHANGED (the no-op consumed nothing). Then a real
  archive (>0) DOES decrement.
- **Free cap:** drive used to 5 → next archive `402 FREE_CAP_REACHED`.
- **Inbox limit at activation:** free workspace already at its limit →
  `GET /api/auth/google/connect-mailbox/start` 402, AND completing an OAuth
  callback for a NEW account is now also blocked (the fix) — but reconnecting
  an already-active account is NOT blocked. Switch tiers via SQL, restore to `pro`.

## #220 — Screener — HIGH + mediums

- Seed/await a few `screener_quarantine` rows (Phase-B senders). `/screener`.
- **Keep** → preview → confirm → row leaves queue, NO Gmail change (D72).
- **Archive** (sender with ≥1 inbox msg) → preview shows real count → confirm →
  worker archives → row leaves on terminal success; **Undo** restores it.
- **Failed-action stays pending:** force the label job to fail (e.g. revoke
  scope mid-flight, or kill the worker) → the sender STAYS in the Screener
  (no longer silently dropped — the decided_at fix).
- **Graduation:** a pending Phase-B sender that accrues ≥3 msgs + ≥7 days →
  re-score → leaves the Screener (no longer shows in both Screener + Triage).
- **Keyboard:** expand a row → press A → preview opens (not a direct mutation);
  Enter confirms, Escape cancels. K/A/U/L/D all map.
- **Tier gate:** non-pro → `/api/screener/*` 402 PRO_FEATURE_REQUIRED + upsell.

## #219 — Billing

- Billing-dark (default): `/billing` shows the honest "not live yet" notice,
  no error toast; plan card from `me` tier.
- **Cancel stale-error fix:** with `BILLING_ENABLED=true` + a sub, open Cancel,
  force a failure, "Keep my plan", reopen → NO stale error shown.

## #201 — CSP (enforcing)

- Walk every route with devtools open + a `securitypolicyviolation` listener →
  zero violations; PostHog + Sentry beacons fire; avatars load.
- Confirm the policy has no `report-uri`/`report-to`: native CSP payloads can
  include full URLs and bypass the SDK scrubber. `CSP_REPORT_ONLY=true` remains
  a browser-console rollback until a first-party normalizing collector exists.
  Note: Paddle/Razorpay checkout `<script>` will need a nonced loader at U13
  (host entry is CSP2-only).

## #226 — Nav + onboarding gate

- Nav lists only built surfaces (no Screener/Billing while unmerged).
- **Onboarding flash fix:** `UPDATE users SET onboarded_at=NULL` +
  disconnect all mailboxes → load → redirects to /onboarding, NO flash of the
  reconnect gate. Restore `onboarded_at`.
- Mailbox switch (both accounts) re-scopes senders; no stale cache.

## Teardown

Restore every SQL-forced value, undo any real Gmail archives, flush the dev
redis db. Verify `users.preferences` + tier + quarantine counts == pre-smoke.
