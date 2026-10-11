# WS1b pricing story, Backlog Pass, and catalog drift

Branch `codex/ws1b-pricing-story-pass`, rebased onto `main`.
Deck revision `drop2-r6` (2026-10-11T05:26:15-07:00). This record covers A3, A4,
and A5. It does not flip IMPLEMENTATION-LOG rows: the PR says Relates to
D19, D117, and D126.

## Destructive migrations

Chintan approved applying the comp-unique swap and the waitlist unique
drop on Oct 11 at 9:31 AM PT. This PR still does not apply them.

1. Destructive migration `0090_entitlement_grants_comp_email_uniq` replaces
   `entitlement_grants_email_uniq` with a partial unique index on
   `(email) where source = 'comp'`. It refuses to run if any email has two
   `source='comp'` rows. No columns are dropped. Comp rows are not updated.
2. Destructive migration `0091_waitlist_drop_email_uniq` drops
   `waitlist_email_uniq`. WS1a left that index in place on purpose.
   Rollback recreates it and refuses if duplicate emails exist.
3. Plus annual 2026-10, the Backlog Pass, and PH30 are still `FILL_ME` and
   `listed: false`. Do not paste live price IDs or set `listed: true` in
   this PR.
4. Do not set `PRICING_V2`, `METER_V2`, or `BILLING_PASS_ENABLED` in
   production. The launch switch is a later go/no-go.
5. Add the repo secret `PADDLE_READONLY_API_KEY`. Until it exists, the
   nightly drift workflow fails closed (`UNVERIFIED`). That is intended.
6. Billing/Ops runs `scripts/billing-pass-sandbox-rehearsal.ts` in the
   Paddle sandbox for the Thu Oct 22, 4 PM go/no-go. This PR does not call
   Paddle.

## Flags

All three flags are server env, default false, never `NEXT_PUBLIC_*`.

- `PRICING_V2` selects the launch pricing page, teaser, refunds, terms,
  and plan picker. Off keeps today's surfaces.
- `METER_V2` is unchanged from WS1a.
- `BILLING_PASS_ENABLED` shows the Pass and allows Pass checkout. The
  public `GET /api/pricing/public` response and `GET /api/auth/me` both
  include `passEnabled`, so the client does not need a rebuild.

A paid `transaction.completed` for the Pass price still grants if the
flag is off. The flag gates checkout and UI, not a payment that already
happened. While the price id is `FILL_ME`, checkout returns
`BILLING_NOT_PROVISIONED` and an unknown price is logged and left
unprocessed.

## Migrations

| File                                          | Kind                    | What                                                                                                           |
| --------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------- |
| `0089_entitlement_grant_sources.sql`          | additive                | `source` default `comp`, `provider`, `provider_transaction_id` unique, source check, `pending_checkouts.offer` |
| `0090_entitlement_grants_comp_email_uniq.sql` | destructive, own commit | drop full email unique, add partial unique for comps                                                           |
| `0091_waitlist_drop_email_uniq.sql`           | destructive, own commit | drop `waitlist_email_uniq`                                                                                     |

`atlas.sum` was produced by Atlas community v1.3.0 (`atlas migrate hash`).
None of these migrations has been applied to a live database.

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

## Cross-WS

- WS2 mounts the quota chip and owns "Connect another" tracking.
- WS3 fills `PricingTrustSlot` (this PR mounts the stub) and owns FAQ,
  help, how-to, comparison prose, `llms.txt`, and marketing JSON-LD.
  `renderPricingMarkdown()` and `buildOffersJsonLd()` are ready.
- `legal-entity.ts` still returns nothing while `FILL_ME`. Terms render
  the entity line only when `hasLegalEntity()` is true.
- `/pricing/changelog` redirects to `/pricing` while `PRICING_V2` is off,
  and that redirect is declared in `scripts/check-web-bundle-budget.mjs`.
  A build with the flag on renders the page. Remove that redirect line
  in the same change so the bundle check measures it.
- `/terms` and `/refunds` are static and follow the server env at build
  time. `/pricing` and the home teaser read `GET /api/pricing/public`,
  so those two flip without a web rebuild.
- `scripts/web-bundle-budget.json` was regenerated with
  `pnpm check:bundle --rebaseline` after the pricing story and billing
  client graph grew the served JS. The launch teaser and pricing story
  are dynamic chunks; the flag-off first load still includes the gate.
