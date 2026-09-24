# Release note draft — product experience and performance

**Draft prepared 2026-09-22. Not published, not a merge date, and not a production-release assertion.**

Before moving any text into the public changelog, confirm the exact merged commit, use its UTC merge date, add repository evidence as required by `learn/changelog-content.ts`, and verify deployment. Do not attach measured speedups or customer outcomes without measurements.

## Proposed customer-facing note

DeclutrMail has a refreshed interface for reviewing Gmail by sender, with clearer navigation, a sender inspector, and more visible scope before bulk changes. Historical cleanup controls retain the age and Inbox/archived choices, including optional Archive or Delete alongside an unsubscribe request.

Billing brings your current access, connected-inbox allowance, payment status and receipts ahead of plan shopping. Immediate plan upgrades require a fresh quote before confirmation. Plan prices remain separate from the amount confirmed by the payment provider.

The update also reduces repeated work in sender inspection, account switching and several background/API read paths. Activity statistics count a sender once when estimating recurring volume. These changes have controlled test coverage; no production percentage speedup is claimed.

The privacy and action boundaries remain explicit: full email contents and attachments are never fetched or stored. Subjects and Gmail preview snippets are among the listed stored fields. Gmail remains the reader. Unsubscribe submits a supported request or opens a Gmail draft for you to send; the sender decides whether and when delivery stops. Existing messages move only when you approve that cleanup separately.

## Internal publication evidence

- [Experience requirement-to-delivery audit](implementation-delivery-audit-2026-09-22.md): implemented screens, controlled tests, local real-data checks and synthetic lifecycle reviews.
- [Performance delivery audit](performance-delivery-audit-2026-09-22.md): implementation, suite results, boundedness and measurement limits.
- [Founder checklist](founder-launch-checklist.md): candidate, rollout, payment, mail and operational gates still require current evidence.

## Launch content refresh evidence — checked 2026-09-22

All eight comparison entries were reviewed against their official sources. These are vendors' documented capabilities and policies, not hands-on competitor tests or independent privacy audits. Dates describe source review, not product release. Existing alternatives/matrix pages reuse this registry.

- Clean Email: [features](https://clean.email/features), [free/trial help](https://clean.email/help/accounts/free-trial-and-subscriptions), [privacy](https://clean.email/privacy), [Quick Cancel](https://clean.email/help/cleaning/canceling-accidental-action-with-quick-cancel). Added the optional five-second pre-execution cancel and its default-off state; kept durable recovery and unexposed paid pricing qualified.
- Trimbox: [product](https://www.trimbox.io/), [Gmail](https://www.trimbox.io/trimbox-for-gmail), [privacy](https://www.trimbox.io/privacy). Retained vendor-attributed on-device claim alongside the separate account/usage privacy terms. Unexposed price, automation and recovery remain unknown, not unsupported.
- SaneBox: [features](https://www.sanebox.com/help/138-what-is-a-feature), [SaneLater](https://www.sanebox.com/help/348-getting-the-most-out-of-sanelater), [privacy](https://www.sanebox.com/help/412-privacy-and-security-i-don-t-want-sanebox-reading-my-mail), [pricing](https://www.sanebox.com/pricing). Removed unverified trial duration, numeric plan limits and BlackHole retention; noted that current optional AI features prevent a blanket header-only claim. Pricing's rendered snapshot did not expose its cards. Privacy text was retrievable through official-domain search after direct-open failures.
- Leave Me Alone: [FAQ](https://leavemealone.com/faq/), [security](https://leavemealone.com/security/), [pricing](https://leavemealone.com/pricing/), [Rollups](https://leavemealone.com/rollups/). Updated Screener naming and fallback-filter context. Kept the explicitly described $19 seven-day pass; dynamic recurring-price placeholders were not treated as real prices. Rollup content storage remains explicit.
- Unroll.Me: [product](https://unroll.me/), [privacy](https://unroll.me/legal/privacy), [FTC's 2019 settlement](https://www.ftc.gov/news-events/news/press-releases/2019/12/ftc-finalizes-settlement-company-misled-consumers-about-how-it-accesses-uses-their-email). Added the distinction between general panel terms and restrictions on Gmail API data; removed the blanket “pay in data” framing. FTC text was retrieved through official-domain search after direct-open failures.
- Gmail and Gmail filters: [filters](https://support.google.com/mail/answer/6579?hl=en), [unsubscribe](https://support.google.com/mail/answer/15433283?hl=en), [organize/archive](https://support.google.com/mail/answer/9259770?hl=en), [delete/recover](https://support.google.com/mail/answer/7401?hl=en), [Manage subscriptions](https://support.google.com/mail/answer/15621070?hl=en). Qualified history claims to reviewed documentation and included Google's new-mail-to-Spam behavior after Manage subscriptions opt-out. The official rollout caveat remains.
- Meta Muse: [newsroom](https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/), [Connectors](https://www.meta.com/help/artificial-intelligence/1687253048996149/), [privacy/security](https://www.meta.com/help/artificial-intelligence/1047255454427887/). Rechecked the existing agent/connector distinction; clarified that optional model-improvement use is initially enabled according to its Help Center. Unstated cleanup features and paid prices remain unknown.

Guide updates cover the sender inspector, bulk historic scope, precise unsubscribe result and uniform Activity recovery window. `/pricing.md` now separates base catalog amounts from actual checkout/renewal charges and declares its alternate indexing intent. Marketing context uses five Pro inboxes, Plus Screener/Autopilot/Quiet Hours, and optional Watch first; historical production claims were not marked freshly verified.

## Content verification

- Focused web suite: eight files, 115 tests passed (`/tmp/launch-copy-tests.log`). Covers pricing headers and catalog/charge distinctions, comparison-source and uncertainty rules, guide examples and historical controls, and existing entitlement/privacy content guards.
- No competitor subscription, authenticated product trial, publication, production rollout or financial operation was performed. Dynamically unavailable competitor prices remain explicitly unverified.
