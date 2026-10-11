# WS1a pricing foundation

Branch `codex/ws1a-pricing-foundation`. Deck revision `drop2-r6`
(2026-10-11T05:26:15-07:00). This record covers A1 and A2 only. WS1b
(A3–A5) is a later branch.

## Flags

`PRICING_V2` and `METER_V2` are server env flags, default false. Nothing
in this change turns them on. Production should set both to the string
`false` on Vercel and Cloud Run until the launch switch.

## Missing price IDs

Plus annual 2026-10, the Backlog Pass, and the PH30 discount still use
`FILL_ME`. Those price points are present and `listed: false`. Checkout
resolves `FILL_ME` to null and returns `BILLING_NOT_PROVISIONED`. No live
Paddle or Razorpay catalog, flag, or price was changed.

These existing price IDs stay resolvable through `LEGACY_PRICE_IDS`:

- Plus annual $90 `pri_01ky15axzc9mz8sxw43c0wtn6h`
- Plus monthly $9 `pri_01ky15axxbeeyge87f9hehw37t`
- Pro monthly `pri_01ky15ay15wqjaz0wjfnhe94vs`
- Pro annual `pri_01ky15ay2p27rbevtvc0gb6qta`
- Founding `pri_01ky15ay4bj9t68bv158hwwfqw`

Razorpay plan ids `plan_THtwadiHmKTaze`, `plan_THtwb3iWLy7qyp`,
`plan_THtwbSxTZRClHX`, `plan_THtwbs4FAeqWlv`, and `plan_THtwcIa7pf9HzZ`
are unchanged.

## Migrations

Both new migrations are additive. Neither was applied to a live database.

- `0084_waitlist_launch_columns.sql` adds nullable waitlist columns and a
  second unique index. `waitlist_email_uniq` was not dropped. Dropping it
  is a destructive follow-up and needs Chintan's OK.
- `0085_action_jobs_quota_units.sql` adds `quota_units integer not null
default 0`. No backfill. Rollback drops the column.

## Decisions assumed

- The billing screen name stays Plan & billing.
- The connection term is "Gmail account".
- Over-limit inboxes stay (`POLICY.overLimitInboxes` is `keep`).
- The Pass card stays hidden. `BILLING_PASS_ENABLED` is WS1b.
- With `METER_V2` on, Free is 1,000 emails per signup-anniversary month.
  With the flag off, the meter stays 50 cleanup actions.
- A live Pass or subscription is the workspace tier after the grant floor.
  Plus stamps 0. Recovery of a failed row stamps the retry; a non-failed
  row never reaches that insert.

## Seams outside WS1 ownership

- `apps/web/src/features/settings/settings-index/settings-screen.tsx` reads
  `useTier().inboxLimit`.
- `apps/web/src/features/mailboxes/account-menu.tsx` uses the Plus and
  waitlist CTAs when `useTier().pricingV2` is true.
- `apps/web/src/lib/entitlements/upgrade-gate.ts` keeps optional
  `requested` and `suggestedPreset` on the free-cap 402, and stores
  `pendingWindowPreset` for the confirm surface that applies it.
- `apps/api/src/actions/actions.service.ts` and
  `packages/workers/src/label-action.worker.ts` stamp and settle
  `quota_units`. Unsubscribe stays a 2-unit preflight while `METER_V2`
  is off, and draws 0 while it is on.
- `apps/api/src/auth/auth.controller.ts` adds optional meter fields on
  `GET /api/auth/me`. Older clients ignore them.

## Not in this change

Pass checkout, the grants unique-index swap, the pricing page rewrite,
refunds and terms, the literal guard, the drift check, and `PROMO.startsAt`
are WS1b. The chip and preview line are not mounted in app chrome.
