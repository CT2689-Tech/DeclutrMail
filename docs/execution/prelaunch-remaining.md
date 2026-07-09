# What’s left after the growth IA ship (2026-07-09)

## Agent-shippable — DONE on this branch

| Item                                                    | Status |
| ------------------------------------------------------- | ------ |
| `/help#getting-started`, `#beta-limits`, `#billing-faq` | ✅     |
| Empty-state → help pointers                             | ✅     |
| `/methodology`, `/changelog`                            | ✅     |
| `/compare` + 5× `/vs/*` (D142–D145)                     | ✅     |
| 5× `/how-to/*` + HowTo JSON-LD                          | ✅     |
| 5× `/answers/*` + FAQPage JSON-LD                       | ✅     |
| `/blog` shell                                           | ✅     |
| `/inbox-simulator` (D133 pragmatic)                     | ✅     |
| Hero “Try the demo first”, footer Compare/Demo/Blog     | ✅     |
| Sitemap (30) ↔ llms.txt ↔ nested FS discovery           | ✅     |
| Settings Privacy → Mailboxes / Account deep links       | ✅     |

## Founder-owned — cannot finish in code alone

| Item                                                          | Why                     |
| ------------------------------------------------------------- | ----------------------- |
| Apex DNS off Squarespace (`declutrmail.com`)                  | DNS / hosting           |
| `support@` + `privacy@` accept mail                           | Mail host aliases       |
| `NEXT_PUBLIC_POSTHOG_KEY` only after live D147 consent verify | Prod env                |
| `GMAIL_CONNECT_ENABLED` + OAuth redirect URIs on prod hosts   | Google Cloud + env      |
| `BILLING_ENABLED=true` + Paddle/Razorpay catalog + webhooks   | Provider + secrets      |
| Account deletion execution approval (§9)                      | Founder sign-off        |
| Pub/Sub push subscription for real-time Autopilot             | GCP                     |
| Resend (or equivalent) for transactional email                | Provider key            |
| Headed 375px + real two-mailbox Gmail smoke                   | Founder machine / OAuth |
| Full D139 whitepaper (3 SVGs, CASA PDF embed)                 | Content + assets        |
| Full D133 “real cascade in browser” extraction                | Optional hardening      |

Private beta with real Gmail can proceed once the **founder-owned** row for DNS + OAuth + support mailboxes is green. Growth SEO pages no longer block that.
