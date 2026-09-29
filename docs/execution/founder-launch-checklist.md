# Founder launch checklist

**Reconciled with the branch on 2026-09-22. Production status has not been re-verified by this review.**

This replaces the July checklist as the operating queue. Its July 9 observations remain historical evidence in Git; statements such as “no MX,” “billing disabled,” “secrets unbound,” and tool authentication status must not be treated as current facts. A passing repository test or local browser check does not prove deployment, payment settlement, mail delivery, or alert usability.

## 1. Before merging this branch

- [ ] Review the final diff and run the repository-required checks on the exact candidate commit. The [experience delivery audit](implementation-delivery-audit-2026-09-22.md) and [performance delivery audit](performance-delivery-audit-2026-09-22.md) record prior results and their limits; later edits need their own checks.
- [ ] Test the candidate with controlled accounts: connect/onboard, switch mailboxes, inspect senders on desktop and mobile, preview one and multiple senders, protect/exclude a sender, and verify Activity outcomes and supported undo. Unsubscribe cannot be undone: one-click requests and user-sent Gmail drafts require distinct verification.
- [ ] Test Delete and unsubscribe's optional Archive/Delete historical controls, including age filter, Inbox only versus Inbox + archived, protected exclusions, and changed/zero counts. Do not submit real destructive actions merely to inspect a preview.
- [ ] Check Billing with synthetic/sandbox lifecycle states: current paid, pending checkout, payment issue, cancellation, downgrade, expired access, delayed/failed upgrade quote, and invoice retrieval. An immediate upgrade must require a fresh successful quote.
- [ ] Review the [draft release note](release-note-draft-2026-09-22.md). Add an actual UTC merge date and commit evidence only after merge, before publishing a changelog entry.

Current manifest facts: Free offers 50 cleanup actions/month and one inbox; Plus offers unlimited cleanup, Screener, Autopilot and Quiet Hours for one inbox; Pro supports five inboxes and the Pro tools. Supported Activity undo is 30 days on every tier, subject to action and message-retention limits. Pricing amounts and capabilities come from `packages/shared/src/entitlements/pricing.config.ts`, not this checklist.

## 2. After deploying the approved candidate

- [ ] Run `scripts/launch-preflight.sh` against the intended environment; inspect each group and retain timestamped results. It covers DNS/mail/web/API/config probes, not full product behavior.
- [ ] Open the exact public and authenticated production URLs. Check homepage, pricing, permissions checkpoint, simulator, strongest guides, comparison pages, help/contact, security/privacy, and app entry on desktop and narrow mobile.
- [ ] Confirm canonical, sitemap, robots, Open Graph and article metadata use the public origin. `/pricing.md` is an alternate representation with noindex/follow and a canonical Link header to `/pricing`.
- [ ] Verify real OAuth and first sync with an authorized test inbox, including reconnect and mailbox switching. Confirm a known test message reaches the app through the expected watch/sync path; a successful health probe alone does not prove Gmail delivery.
- [ ] Confirm anonymous/no-consent browsing sends no optional analytics; accept and withdraw consent and verify behavior. Verify first-touch attribution survives OAuth without later simulator navigation overwriting it; self-report remains separate.
- [ ] Query current first-party signup/activation data before making customer-count or conversion claims. Existing synthetic walkthroughs remain labeled examples; founder mailbox data must be labeled and re-queried before publication.

## 3. Billing and transactional email: verify, do not reprovision blindly

The current `.github/workflows/deploy-cloud-run.yml` declares `BILLING_ENABLED=true` and `PADDLE_ENV=production` for the API and binds Paddle secrets. It also binds the Resend API key to the worker and webhook secret to the API. The old instructions to enable billing or add those bindings are obsolete. This is manifest evidence, **not verification of the active revision or secret values**.

- [ ] Read the deployed revision's configuration and check the existing catalog/webhook setup without exposing credentials. Keep sandbox and live environments separate.
- [ ] Follow [billing guardrails](../runbooks/billing-guardrails.md) and the [ordered billing runbook](billing-go-live-runbook-2026-07-17.md): catalog read, notification destination read, sandbox purchase/webhook/refund rehearsal, then an explicitly approved live low-value purchase and immediate refund at cutover. Do not repeat a live charge simply because an old checkbox is open.
- [ ] Check that public plan/base prices, localized provisioned options, actual checkout quote, cancellation timing, and invoice amounts agree. Do not call a manifest/list price a confirmed upcoming charge. Confirm Founding Pro availability rather than publishing an invented number of seats left.
- [ ] Verify `support@declutrmail.com` and `privacy@declutrmail.com` receive mail at the intended destination. Independently verify transactional sending, delivery, and signed webhook handling. Current DNS, sender-domain verification and secret bindings need fresh evidence.
- [ ] Rehearse account deletion scheduling/cancellation and authorized test-account expiry using the existing implementation and its current grace/retention contract. This is not permission to purge production data. Account deletion is distinct from disconnecting one mailbox and from deleting messages in Gmail.

## 4. Operational acceptance

- [ ] Verify the deployed health probe and uptime alert; verify the intended person receives the test notification.
- [ ] Open the exact shared monitoring URLs in the intended authenticated account. Panels must render without errors and show expected freshness. Otherwise record “created, usability unverified” with the blocker.
- [ ] Verify source maps, actionable error routing and consent-safe telemetry. Optional Sentry/PostHog availability must not control product behavior.
- [ ] Follow [performance verification](../ops/performance-verification.md) for before/after request timings, database/worker connection budgets, queue progress and provider quota behavior. No measured speedup or production latency claim exists merely because bounded queries and parallel reads passed tests.
- [ ] Verify current budget alerts and secret inventory. `NEXT_PUBLIC_*` values require a web rebuild; Cloud Run environment replacement must preserve all intended values. Do not re-add the obsolete `RATE_LIMIT_ENABLED=false` flag.

## 5. Promotion follows evidence

Use [MARKETING-RUNBOOK.md](MARKETING-RUNBOOK.md) for posting tasks. Existing guides, comparisons, metadata and simulator do not need rebuilding. Keep founder handles, launch slots, real preview recordings, customer research and directory submissions open until completed. Older draft copy must be refreshed before use. No posting, launch announcement, payment, provider write or production deployment was performed by this reconciliation.
