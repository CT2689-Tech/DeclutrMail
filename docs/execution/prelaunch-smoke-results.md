# Pre-Launch Smoke Results — 2026-07-09

> Environment: Cursor cloud agent (`bc-249e77ab-9367-406e-bcb4-02a655f4abd6`).
> Stack: local Postgres 16 + Redis + API `:4000` + Next `:3000` via
> `scripts/cloud-smoke.sh` pattern (manual PG start — `runuser` unavailable
> without root). Seed: `scripts/cloud-seed.sql` (2 mailboxes, free→pro toggled).
> Dev-login: `chintan.a.thakkar@gmail.com`.
>
> **Not covered here:** real Gmail OAuth, real mutations against Google,
> browser SPA interactions, 375px visual layout, PostHog consent banner,
> worker job completion (worker health port collided with API on `:4000`).

---

## Verdict

**Marketing + SEO surface: green.** All 10 public pages render with expected
trust copy; sitemap/robots/llms.txt/og:image present; banned privacy phrase
absent; growth IA pages correctly 404 until built.

**Authed API read surface: mostly green.** Core list/detail endpoints return
200 under a seeded Pro workspace. Account-level endpoints stay reachable with
**no active mailbox** (settings / deletion / export = 200; senders = 409
`NO_ACTIVE_MAILBOX` as designed). Billing correctly 503s `BILLING_DISABLED`.

**Mutation path: partial.** Composite archive **preview** returns real counts;
**enqueue** succeeds + is idempotent; worker did not process the job in this
env (health listen `EADDRINUSE :4000`), so Activity stayed empty and Gmail
was never touched (seed has no real tokens anyway — `GMAIL_CONNECT_ENABLED=false`).

**Browser SPA smoke: HTTP-only.** All primary app routes returned 200 HTML
shells with cookies; this is **not** a full interactive §8 smoke (no Playwright
walk of preview modal / undo tray / mailbox switcher UI).

---

## Results table

| #   | Check                                                                                        | Result                      | Notes                                                                                                                     |
| --- | -------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 1   | Marketing `/` content + privacy badge                                                        | **Pass**                    | `Full bodies fetched: 0`, JSON-LD present                                                                                 |
| 2   | `/pricing` Free/Plus/Pro                                                                     | **Pass**                    |                                                                                                                           |
| 3   | `/help` FAQ + anchors + JSON-LD                                                              | **Pass**                    | Anchors: store, unsub, verbs, undo, disconnect, delete, autopilot, pricing, refunds, contact. **No `#getting-started`**   |
| 4   | `/privacy` `/security` `/terms` `/refunds` `/cookies` `/contact` `/beta`                     | **Pass**                    | Refunds state 30-day money-back (founder-confirmed 2026-07-08)                                                            |
| 5   | Banned copy `Bodies read: 0` on public + onboarding                                          | **Pass**                    | 0 hits                                                                                                                    |
| 6   | `sitemap.xml` = 10 marketing paths                                                           | **Pass**                    | Matches `llms.txt` page set                                                                                               |
| 7   | `robots.txt` disallows authed + `/onboarding`                                                | **Pass**                    |                                                                                                                           |
| 8   | `llms.txt` + privacy boundary                                                                | **Pass**                    | Refund line soft (“see refund policy”) — intentional after overclaim fix                                                  |
| 9   | `og:image` / twitter:image on `/`                                                            | **Pass**                    | Pinned via `marketingPageMetadata`                                                                                        |
| 10  | Growth pages `/methodology` `/vs/*` `/how-to/*` `/answers/*` `/changelog` `/inbox-simulator` | **N/A (404)**               | Expected missing — D132 backlog                                                                                           |
| 11  | Dev-login → `/api/auth/me`                                                                   | **Pass**                    | 2 active mailboxes after seed                                                                                             |
| 12  | Senders / summary / weekly-hero                                                              | **Pass**                    |                                                                                                                           |
| 13  | Triage queue / size / stats                                                                  | **Pass**                    |                                                                                                                           |
| 14  | Activity / summary                                                                           | **Pass**                    | Empty until worker completes jobs                                                                                         |
| 15  | Autopilot rules + pending                                                                    | **Pass**                    |                                                                                                                           |
| 16  | Screener queue (Pro)                                                                         | **Pass**                    |                                                                                                                           |
| 17  | Screener on Free                                                                             | **Pass**                    | 402/403-class `PRO_FEATURE_REQUIRED`                                                                                      |
| 18  | Briefs today                                                                                 | **Pass**                    | 404 empty-day OK                                                                                                          |
| 19  | Briefs list without `from`/`to`                                                              | **Fail (contract)**         | 400 requires date range — FE must always send; not a user bug if UI does                                                  |
| 20  | Followups / snoozed / quiet-hours GET                                                        | **Pass**                    |                                                                                                                           |
| 21  | Onboarding state / me settings                                                               | **Pass**                    |                                                                                                                           |
| 22  | Billing subscription while dark                                                              | **Pass**                    | 503 `BILLING_DISABLED`; FE has honest copy path                                                                           |
| 23  | Account deletion status + export                                                             | **Pass**                    | Reachable with and without active mailbox                                                                                 |
| 24  | Sync status `/api/v1/sync/status`                                                            | **Pass**                    |                                                                                                                           |
| 25  | Mailbox switch `PATCH /api/mailboxes/:id/active`                                             | **Pass**                    | `/me` reflects new `activeMailboxId`                                                                                      |
| 26  | No-active-mailbox: settings/billing/deletion/export                                          | **Pass**                    | senders correctly 409                                                                                                     |
| 27  | Archive preview (real count)                                                                 | **Pass**                    | `inboxCount: 2` for Acme News                                                                                             |
| 28  | Composite preview                                                                            | **Pass**                    | Counts + subjects (includes seed XSS-ish subject — display escaping is FE concern)                                        |
| 29  | `POST /api/actions` archive enqueue + idempotency                                            | **Pass**                    | Same `actionId` on replay; status `queued`                                                                                |
| 30  | Worker completes action → Activity row                                                       | **Blocked**                 | Worker boot: health server `EADDRINUSE :4000` (API already bound). Needs separate health port in this dual-process layout |
| 31  | Web app routes HTTP 200 (senders…settings)                                                   | **Pass (shallow)**          | Shell only; not interactive                                                                                               |
| 32  | Real Gmail OAuth / mutate / undo in Gmail                                                    | **Blocked**                 | No Google tokens; connect disabled in `.env.local`                                                                        |
| 33  | 375px visual / keyboard K/A/U/L/D                                                            | **Blocked**                 | No headed browser pass in this run                                                                                        |
| 34  | D147 cookie consent gating PostHog                                                           | **Blocked (not exercised)** | Banner code exists in repo; live prod-key gate still Open in FOUNDER-FOLLOWUPS                                            |
| 35  | Apex `declutrmail.com` content (not Squarespace)                                             | **Blocked**                 | Founder DNS; local smoke used localhost                                                                                   |

---

## Comprehension / pointer risks observed during smoke

These are **product UX notes** from the smoke + static route audit (not
interactive usability testing):

1. **No `/help#getting-started`** — post-sync users land on `/senders` with
   jargon (Senders / Triage / Screener) and no first-run checklist.
2. **Help covers verbs + undo well** — good deep-links exist; empty states
   should point at them more aggressively.
3. **Billing dark vs pricing CTAs** — API honest; confirm every marketing CTA
   that says “upgrade” does not imply live checkout while `BILLING_ENABLED=false`.
4. **Screener Pro gate copy is clear** at API layer; FE upsell must match.
5. **Activity empty after enqueue** will confuse users if workers lag —
   preview promised “2 messages”; ledger stays empty until worker succeeds.
6. **Seed subject injection strings** (`=HYPERLINK…`, `=cmd|…`) appear in
   preview subjects — good security test data; ensure FE never renders as
   formula/HTML.
7. **Growth SEO/AEO pages absent** — expected; blocks organic acquisition more
   than private-beta retention.

---

## How to re-run

```bash
# Cloud / no-Docker:
sudo -u postgres … pg_ctl start   # or fix cloud-smoke.sh runuser
redis-server --daemonize yes
./scripts/cloud-smoke.sh up       # after PG is up
./scripts/cloud-smoke.sh seed login
# Fix cookie jar ownership if /tmp/dmlogs was created as postgres:
sudo chown -R "$USER" /tmp/dmlogs
curl -s -c /tmp/dmlogs/cookies.txt "http://127.0.0.1:4000/api/auth/dev/login?email=chintan.a.thakkar@gmail.com"
pnpm --filter @declutrmail/web dev   # :3000

# Full local (preferred for interactive §8 smoke):
./scripts/dev-up.sh
# browser → http://localhost:4000/api/auth/dev/login?email=chintan.a.thakkar@gmail.com
```

For worker alongside API in cloud-smoke, set the worker health listen port
away from `4000` (see `apps/api/src/worker.ts` health server) before claiming
mutation→activity completeness.

---

## Related docs

- Prompt for Claude UX review: `docs/execution/prelaunch-ux-review-prompt.md`
- Docs / SEO / enhancement recommendations:
  `docs/execution/prelaunch-enhancement-recommendations.md`
