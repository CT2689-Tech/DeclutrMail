# WS1b pricing story, Backlog Pass, and catalog drift

Branch `codex/ws1b-pricing-story-pass`, rebased onto `main`.
Deck revision `drop2-r6` (2026-10-11T05:26:15-07:00). This record covers A3, A4,
and A5. It does not flip IMPLEMENTATION-LOG rows: the PR says Relates to
D19, D117, and D126.

## Destructive migrations

Chintan approved applying the comp-unique swap and the waitlist unique
drop on Oct 11 at 9:31 AM PT. This PR still does not apply them.

1. Destructive migration `0093_entitlement_grants_comp_email_uniq` replaces
   `entitlement_grants_email_uniq` with a partial unique index on
   `(email) where source = 'comp'`. It refuses to run if any email has two
   `source='comp'` rows. No columns are dropped. Comp rows are not updated.
2. Destructive migration `0094_waitlist_drop_email_uniq` drops
   `waitlist_email_uniq`. WS1a left that index in place on purpose.
   Rollback recreates it and refuses if duplicate emails exist.
3. Plus annual 2026-10, the Backlog Pass, and PH30 are still `FILL_ME` and
   `listed: false`. Do not paste live price IDs or set `listed: true` in
   this PR.
4. Founder decision 2026-10-11 12:35 PM PT: the three flags are the
   production state when this PR merges. Cloud Run API and worker
   `--set-env-vars` set `PRICING_V2=true`, `METER_V2=true`, and
   `BILLING_PASS_ENABLED=true`. Do not paste live price IDs or set
   `listed: true` in this PR. Merging while the Pass and Plus annual
   2026-10 ids are `FILL_ME` shows the offers and then checkout returns
   `BILLING_NOT_PROVISIONED`. Migration `0092` must be applied before
   the new API serves checkouts, because every checkout writes
   `pending_checkouts.offer`.
5. Add the repo secret `PADDLE_READONLY_API_KEY`. Until it exists, the
   nightly drift workflow fails closed (`UNVERIFIED`). That is intended.
6. Billing/Ops runs `scripts/billing-pass-sandbox-rehearsal.ts` in the
   Paddle sandbox for the Thu Oct 22, 4 PM go/no-go. This PR does not call
   Paddle.

## Flags

All three flags are server env (`=== 'true'`), never `NEXT_PUBLIC_*`.
The Cloud Run deploy sets all three to `true` on the API and the worker.
`--set-env-vars` full-replaces, so a live-only value would be wiped.

Vercel Production, set before the merge build starts (a later edit
without a redeploy does not change pages already rendered at build time):

| Name                   | Value  | When the web reads it                                                                                                                                                                                                                                                |
| ---------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PRICING_V2`           | `true` | Build time for static HTML: marketing layout JSON-LD, `/`, `/terms`, `/refunds`, `/pricing/changelog`, `sitemap.xml`. Request time for the billing page, the app-layout default provider, `llms.txt`, `/pricing.md`, and the `/pricing` fallback if the API is down. |
| `BILLING_PASS_ENABLED` | `true` | Request time for `/pricing.md` and the `/pricing` fallback. The Pass card on `/pricing` and in the app follows the API `passEnabled` field.                                                                                                                          |

`METER_V2` is not read by the web app. Set it on Cloud Run only.

- `PRICING_V2` selects the launch pricing page, teaser, refunds, terms,
  and plan picker. Off keeps today's surfaces.
- `METER_V2` switches Free from the cleanup-action cap to the email meter.
- `BILLING_PASS_ENABLED` shows the Pass and allows Pass checkout. The
  public `GET /api/pricing/public` response and `GET /api/auth/me` both
  include `passEnabled`.

## Readiness before merge

None of the following was created in this PR. No Paddle or Razorpay
write was made.

- Plus annual 2026-10 sandbox price is `SANDBOX_PRICE_IDS.plus_annual`
  (`pri_01m4phk06hdmmq5cw5b8aa5r2y`, $59/yr, product
  `pro_01ky067agvcnc77hf635bsjn01`). It is used only when
  `PADDLE_ENV=sandbox`. The live slot
  `PLUS_ANNUAL_2026_10.paddlePriceId` stays `FILL_ME` and `listed: false`.
  Production checkout returns `BILLING_NOT_PROVISIONED` until that live
  id is pasted. `BILLING_CATALOG_JSON` can still override the sandbox id.
- Backlog Pass sandbox price is `SANDBOX_PRICE_IDS.pass_onetime`
  (`pri_01m4phkr8yhydb76dz11b74br8`, $19 one-time, product
  `pro_01m4phk7mrggrfyqgprpxgz1hr`), same sandbox gate. The live slot
  `OFFERS.backlogPass.price.paddlePriceId` stays `FILL_ME`. The grant
  code is `grantPassFromTransaction` on `transaction.completed` with no
  subscription id, and `revokePassByTransaction` on a one-off
  `adjustment.created`. Both need migration `0092` applied first.
- PH30 sandbox discount is `PROMO_DISCOUNT_IDS.sandbox`
  (`dsc_01m4phpp04scdes9ghqn3qps77`), 30%, code PH30, first payment
  only, restricted to those two sandbox prices, expires
  `2026-10-19T23:59:00Z`. `PROMO_DISCOUNT_IDS.live` stays `FILL_ME`.
  Checkout does not send the code; the banner is display-only. The live
  discount is created at launch and uses `PROMO.endsAt`.
- `PADDLE_READONLY_API_KEY` GitHub repo secret is still missing. The
  drift workflow fails closed `UNVERIFIED`. That is not a Paddle write.
- Razorpay stays a separate rail. `RAILS.razorpay.enabled` is false, and
  the new annual and Pass prices have no Razorpay plan id. Existing INR
  subscriptions still resolve through `LEGACY_PRICE_IDS`. Creating a
  Razorpay plan for the new prices would be a live Razorpay change and
  is not required to keep the rail hidden.
- Migrations `0092` (required before the new API writes
  `pending_checkouts.offer`), then approved destructive `0093` and
  `0094`. None are applied by this PR.
- The Pass purchase proof is the `rehearse` job in
  `.github/workflows/billing-checkout-revocation-rehearsal.yml`,
  dispatched with `rehearsal=pass`. Run 38186077360 used a new job id
  and logged `REHEARSAL_OPERATOR_KEY` empty while `PADDLE_API_KEY`,
  `BILLING_REHEARSAL`, and `PADDLE_ENV` were set. The main checkout
  job (run 38120969543) logs the operator key as set. Pass steps now
  stay in that `rehearse` job. A step prints `boundary NAME=ok`,
  `absent`, or `mismatch` and does not print values. This environment
  still has no Paddle key, so the proof is that workflow run.
- The launch refund window is 14 days. `POLICY.refundWindowDays` is 14.
  Flags-on `/refunds` renders `RefundsV2`. Every window sentence is a
  deck template (`refunds.toc.window`, `refunds.summary`,
  `refunds.window`, and the other `{refundDays}` lines) filled by
  `fillStory` with that constant. `refundLine()` uses the same constant
  on pricing, billing, flags-on `llms.txt`, and `/pricing.md`. With
  `PRICING_V2` on, `/faq`, `/help`, the home teaser, the comparison
  money-back line, and `moneyBackNote(true)` use that same window.
  Flags-off `/refunds`, FAQ, help, and the home teaser still publish
  the D121 30-day page (`MONEY_BACK_NOTE`) so a flags-off view matches
  main. That 30-day page is not the launch policy.

## Impact when the flags flip

- Current paying subscribers keep the Paddle or Razorpay price they
  already pay. This code does not call the provider to change a
  subscription. Legacy price ids still resolve.
- Founding Pro subscriptions keep their legacy price and founding flag.
  The claim, first-250, and promo deep-link sales UI hide. The founding
  cancel note stays.
- Free users mid-month move from the cleanup-action count to a sum of
  `quota_units` in the same signup-anniversary month, cap 1,000 emails,
  archive and delete only. Rows written while the flag was off stay at
  `quota_units` 0, so past archives are not recounted. In-flight jobs
  queued before the flip keep 0. Plus and Pro are not metered.
- A checkout session already created at a legacy price id still
  completes through the webhook. A new Plus annual, Pro, or Pass
  checkout fails closed until a real price id exists. Pro deep links
  open the waitlist card and do not open a Pro confirm panel. India
  visitors default to Paddle; existing Razorpay subscriptions are not
  cancelled.

A paid `transaction.completed` for the Pass price still grants if the
flag is off. The flag gates checkout and UI, not a payment that already
happened. While the price id is `FILL_ME`, checkout returns
`BILLING_NOT_PROVISIONED` and an unknown price is logged and left
unprocessed.

## Migrations

| File                                          | Kind                    | What                                                                                                           |
| --------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------- |
| `0092_entitlement_grant_sources.sql`          | additive                | `source` default `comp`, `provider`, `provider_transaction_id` unique, source check, `pending_checkouts.offer` |
| `0093_entitlement_grants_comp_email_uniq.sql` | destructive, own commit | drop full email unique, add partial unique for comps                                                           |
| `0094_waitlist_drop_email_uniq.sql`           | destructive, own commit | drop `waitlist_email_uniq`                                                                                     |

`atlas.sum` was produced by Atlas community v1.3.0 (`atlas migrate hash`).
None of these migrations has been applied to a live database. #985 takes
`0089` and #981 takes `0090_inbox_report_cache` plus `0091` (concurrent
`mail_messages` index), so these files are `0092`, `0093`, and `0094`.
`0092` must apply before the new API serves checkouts.

## Decisions assumed

- Plan & billing stays the in-app billing name.
- "Gmail account" stays the connection term.
- Over-limit inboxes stay (`POLICY.overLimitInboxes = 'keep'`).
- The Pass card is hidden while `BILLING_PASS_ENABLED` is false.
- With `METER_V2` on, Free stays 1,000 emails per signup-anniversary month.
- `SHOW_FOUNDING_CANCEL_NOTE` is the existing Founding-member cancel line
  only (`sub.foundingMember`). Founding is not offered.
- `IN_CARDS_CONFIRMED` stays false. `PRICE_PROMISE_LINE3` stays the deck line.
- `screen-decisions.ts` was not edited.
- There is no purchase-funnel SQL on this branch. Pass purchases are
  `entitlement_grants.source = 'pass'` plus `purchase_confirmed` with
  `plan: 'pass'`. No new funnel was invented.
- "Connect another" lives in `account-menu.tsx` (WS2). This PR does not
  edit that file. The account-menu test fixture gained `passEnabled: false`
  because `TierEntitlements` now includes the flag.
- After a Pass overlay completes, billing toasts the deck resume line and
  calls `returnAfterUpgrade`. It does not reopen a Senders or Triage
  confirm. That confirm is WS2.

## Rebase onto #997

#997 merged as `68b7e2bc` (`fix(web): order llms.txt from drop2-r12`).
This branch is rebased onto that main. Main's H1-first `llms.txt` and
deck stay canonical. `withPricingChangelog()` runs on the body before
`withOpeningFacts`. `llms-txt.test.ts` expects
`startsWith('# DeclutrMail\n')`. `## Pricing` still goes last when
`PRICING_V2` is on. The changelog line is present only while that flag
is on.

## Rebase onto #978

#978 is on main. This branch keeps its deck-generated `llms.txt` body
and adds only the `/pricing/changelog` line behind `PRICING_V2`. The
CASA line `CASA Tier 2 letter of validation submitted April 15, 2026`
stays. `certified` and `audited` stay forbidden. `next.config.ts` keeps
both `htmlLimitedBots` and the noindex header rules. `joinLaunch` keeps
the object return and `onConflictDoNothing()` with no target.

## Cross-WS

- WS2 mounts the quota chip and owns "Connect another" tracking.
- WS3 fills `PricingTrustSlot` (this PR mounts the stub) and owns FAQ,
  help, how-to, comparison prose, `llms.txt`, and marketing JSON-LD.
  `renderPricingMarkdown()` and `buildOffersJsonLd()` are ready.
- `legal-entity.ts` still returns nothing while `FILL_ME`. Terms render
  the entity line only when `hasLegalEntity()` is true.
- `/pricing/changelog` redirects to `/pricing` while `PRICING_V2` is off.
  `scripts/check-web-bundle-budget.mjs` declares that redirect only when
  the flag is off. The CI web build sets the flag, renders the page, and
  measures it. The sitemap and `llms.txt` include the URL only while the
  same flag is on. With the flag on, the pricing bullet and the pricing
  markdown section both use `POLICY.refundWindowDays`.
- `/terms` and `/refunds` are static and follow the server env at build
  time. The flags-off refunds page keeps main's "cancelling". `/faq` and
  `/help` follow the same server env. `/pricing` reads
  `GET /api/pricing/public`. The home teaser uses the server flag for
  first paint and still reads that endpoint. A non-200 or network error
  keeps the server paint and is not reported. With the server flag off,
  that paint is today's teaser.
- `scripts/web-bundle-budget.json` was regenerated with
  `pnpm check:bundle --rebaseline` after the pricing story and billing
  client graph grew the served JS. The launch teaser and pricing story
  are dynamic chunks; the flag-off first load still includes the gate.
