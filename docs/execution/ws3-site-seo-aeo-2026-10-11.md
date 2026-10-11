# WS3 website, SEO, and AEO — 2026-10-11

Branch `codex/ws3-site-seo-aeo` is based on main `ed3e9de2` plus the WS1a stub
cherry-pick `5347ac42` (local `4ad5caee`). Later WS1a commits are not included.
Rebase once onto main after WS1a lands. Do not merge from this record.

Copy is deck revision `drop2-r6` (issued 2026-10-11T05:26:15-07:00). Prices, plan
names, and the refund sentence come from the WS1 formatters. Those formatters
still return empty strings, so `{refundDays}`, `{passDays}`, and `{passPrice}`
render blank and the comparison price FAQ drops the empty “-day money-back”
clause. The final comparison CTA hides `refundLine()` while it is empty.

## Decisions assumed

- `AI_CONSENT_GATE_LIVE` is false. Sixteen gated strings keep today’s wording.
  `ws3.security.ai.intro` ships now, so /security names both AI uses. Links go
  to `/privacy#ai-processing`.
- `SHOW_INJECTION_LINE` is false. The prompt-injection sentence is omitted.
- `LAUNCH_STAGE` is `ga`. The footer does not link “Open beta”. `/beta` stays live.
- `SECURITY_CONTACT` is `privacy`. security.txt uses `privacy@declutrmail.com`
  until Chintan confirms `security@declutrmail.com`.
- `HERO_KICKER`, `HIW_H1`, `TRUST_ROW_VARIANT`, and `VS_FAQ_Q2_STYLE` are the
  recommended deck values. `VS_FAQ_Q1_STYLE` is unused; the “better” question
  does not ship.
- `ORGANIZATION_SAME_AS` is empty, so Organization JSON-LD omits `sameAs`.
  Offers come only from `buildOffersJsonLd()` (currently `[]`).
- `LEGAL_ENTITY_NAME` and `LEGAL_ENTITY_ADDRESS` stay `FILL_ME`. The footer and
  /contact render the legal sentence only when `hasLegalEntity()` is true.
- `CASA_LOV_SUBMITTED_ON` is `15 April 2026` and `BRAND_VERIFICATION_APPROVED_ON`
  is `18 August 2026`, each marked `// CONFIRM before deploy (Chintan)`.
  Rendered dates use US order. The existing British OAuth constant is unchanged.
- Hero screenshots were not in `apps/web/public/marketing/`. The current hero
  visual stays.
- Home mobile: the header drops `backdrop-filter` under 880px, and the open
  menu locks scroll with `body.dm-public-menu-open` instead of `body:has()`.
  `text-wrap: balance` on the display H1 stays. No Lighthouse score is claimed.

## Cross-workstream

- `WaitlistV1JoinResult.providerClass` and `WaitlistService.joinLaunch` classify
  every `kind: 'provider'` signup and return the class. The stored provider is
  still the visitor’s pick when they made one. This touches the WS1 waitlist
  contract.
- Terms §6 launch-stage wording stays with WS1.
- `AI_PROCESSING_DISCLOSURE` in `action-safety.ts` is unchanged. WS2 owns the
  consent-gate rewrite of that constant.

## Not measured

Lighthouse mobile for `/` was not run. Do not treat the CSS cuts as a score
of 90. Polish’s sanitized hero set was absent, so no screenshot slot was added.
