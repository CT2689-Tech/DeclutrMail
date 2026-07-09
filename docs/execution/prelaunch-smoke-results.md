# Pre-Launch Smoke Results — 2026-07-09 (updated)

> Environment: Cursor cloud agent. Stack: local Postgres 16 + Redis + API
> `:4000` + Next `:3000`. Seed: `scripts/cloud-seed.sql`. Dev-login:
> `chintan.a.thakkar@gmail.com`.
>
> **Round 2** covers the P0/P1 retention work landed on this branch
> (`/help#getting-started`, empty-state pointers, `/methodology`,
> `/changelog`).

---

## Verdict — CONFIRMED for private-beta docs/retention slice

**Marketing + SEO: green.** All 12 public pages (10 prior + methodology +
changelog) render with expected trust copy. Sitemap (12 locs), robots,
llms.txt, og:image present. Help FAQPage JSON-LD has **13** questions
including getting-started + beta-limits. Banned privacy phrase absent.

**Authed API: green.** Reads, mailbox switch, action preview, action
enqueue (`201` Created + idempotent), Pro/Free screener gate, no-active
mailbox escape hatch all behave as designed.

**App shells: green (HTTP).** Primary authed routes return 200 without
Application error. Interactive SPA empty-state pointer rendering was
unit-tested (939 web tests green); headed browser walk still founder-side
for real Gmail.

**Not claimed:** real Gmail OAuth mutations, worker→Activity completion in
this dual-process layout, 375px visual, apex DNS content.

---

## Round 2 results

| #   | Check                                                                                                            | Result            |
| --- | ---------------------------------------------------------------------------------------------------------------- | ----------------- |
| 1   | `/` + footer Methodology/Changelog links                                                                         | **Pass**          |
| 2   | `/help` `#getting-started` + `#beta-limits` + FAQ JSON-LD 13                                                     | **Pass**          |
| 3   | `/methodology` privacy verbatim + 8 sections                                                                     | **Pass**          |
| 4   | `/changelog` thin shell                                                                                          | **Pass**          |
| 5   | `/beta` → `/help#beta-limits` pointer                                                                            | **Pass**          |
| 6   | sitemap 12 paths incl. methodology/changelog                                                                     | **Pass**          |
| 7   | llms.txt lists both + 30-day money-back on pricing line                                                          | **Pass**          |
| 8   | Banned `Bodies read: 0` on public pages                                                                          | **Pass** (0 hits) |
| 9   | Authed API reads (me, senders, triage, activity, autopilot, screener, followups, snoozed, settings, sync, quiet) | **Pass**          |
| 10  | Billing dark `503 BILLING_DISABLED`                                                                              | **Pass**          |
| 11  | Mailbox `PATCH …/active` switch                                                                                  | **Pass**          |
| 12  | Action preview + enqueue (`201`)                                                                                 | **Pass**          |
| 13  | No-active: settings/deletion 200; senders 409                                                                    | **Pass**          |
| 14  | Free screener `PRO_FEATURE_REQUIRED` (402)                                                                       | **Pass**          |
| 15  | App shells `/senders`…`/settings` HTTP 200                                                                       | **Pass**          |
| 16  | Unit tests `@declutrmail/web`                                                                                    | **Pass** (939)    |
| 17  | Real Gmail / headed UI / worker complete                                                                         | **Blocked** (env) |

---

## What this confirms

The agent-doable P0/P1 retention slice is **ready to merge** for private
beta documentation/activation support:

1. First-run users have `/help#getting-started`.
2. Empty Senders / Triage / Activity / Autopilot point at the right help anchors.
3. Trust page `/methodology` exists for GEO/citation + anxious users.
4. `/changelog` signals the product is alive.
5. SEO plumbing (sitemap ↔ filesystem ↔ llms.txt) stays reconciled.

## Still founder-owned before public paid launch

- Apex DNS off Squarespace; `support@` / `privacy@` mailboxes
- PostHog prod key only after live consent verification
- Billing live + real Gmail OAuth smoke
- Account deletion execution approval (§9)
- Headed 375px + mailbox lifecycle smoke on founder machine

## Related

- Prompt: `docs/execution/prelaunch-ux-review-prompt.md`
- Recommendations: `docs/execution/prelaunch-enhancement-recommendations.md`
