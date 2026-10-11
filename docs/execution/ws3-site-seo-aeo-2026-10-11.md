# WS3 website, SEO, and AEO — 2026-10-11

Branch `codex/ws3-site-seo-aeo` is rebased onto main after WS1a landed
(`d72d2976`, PR #977). The temporary stub cherry-pick is not replayed.
Do not merge from this record.

Copy is deck revision `drop2-r6` (issued 2026-10-11T05:26:15-07:00). Plan
names and the Plus price come from the WS1 formatters (`planName`,
`priceLine` on the manifest). `{passDays}`, `{passPrice}`, and `{refundDays}`
stay blank, so `fillComplete` drops those clauses, including the “-day
money-back” sentence. The final comparison CTA still hides `refundLine()`
while that formatter is empty.

## Decisions assumed

- `AI_CONSENT_GATE_LIVE` is false. Sixteen gated strings keep today’s wording.
  `ws3.security.ai.intro` ships now, so /security names both AI uses. Links go
  to `/privacy#ai-processing`.
- `SHOW_INJECTION_LINE` is false. The prompt-injection sentence is omitted.
- `LAUNCH_STAGE` is `ga`. The footer does not link “Open beta”. `/beta` stays live.
- `SECURITY_CONTACT` is `privacy`. security.txt uses `privacy@declutrmail.com`,
  the address already published for privacy and vulnerability mail in
  `apps/web/src/app/(marketing)/privacy/page.tsx`,
  `apps/web/src/app/(marketing)/contact/page.tsx`, and
  `apps/web/src/app/(marketing)/support-pages.test.tsx`. `security@` is unused.
- `HERO_KICKER`, `HIW_H1`, `TRUST_ROW_VARIANT`, and `VS_FAQ_Q2_STYLE` are the
  recommended deck values. `VS_FAQ_Q1_STYLE` is unused; the “better” question
  does not ship.
- `ORGANIZATION_SAME_AS` is empty, so Organization JSON-LD omits `sameAs`.
  Offers come only from `buildOffersJsonLd()` (currently `[]`).
- Founder decision 2026-10-11 12:26 PM PT: ship without a legal company
  name or business address. `LEGAL_ENTITY_NAME` and `LEGAL_ENTITY_ADDRESS`
  are empty strings. Filling both is the later one-line change. No flag
  and no env var. `hasLegalEntity()` is false while either is blank, so
  the footer and /contact omit the legal line instead of rendering a
  placeholder, an empty element, or a broken sentence. The postal address
  block stays omitted while `BUSINESS_POSTAL_ADDRESS` is empty.
- Verification facts, from the founder on 2026-10-11, and nothing past them:
  Google OAuth verification for `gmail.modify` was approved April 21, 2026
  on GCP project `declutrmail-ai-prod`; brand verification was approved
  August 18, 2026; the TAC Security CASA Tier 2 letter of validation was
  submitted April 15, 2026. Rendered dates use US order. The project name
  stays in the constant comment and is not added to the deck sentences.
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
