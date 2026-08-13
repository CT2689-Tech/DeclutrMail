/**
 * `/pricing.md` — the pricing page as Markdown, for answer engines.
 *
 * Why this exists: pricing is the fact LLMs get wrong most often about a
 * SaaS, because they read it out of a rendered table, a stale review site,
 * or a screenshot. This serves the same numbers as plain text so there is
 * nothing to misparse, and it is generated from `pricing-model.ts` — the
 * same pure derivations over `TIER_MANIFEST` that render `/pricing` — so
 * it cannot quote a price the checkout would not charge.
 *
 * It is deliberately NOT in the sitemap: it is an alternate representation
 * of `/pricing`, not a second indexable page. Discovery is through
 * `llms.txt` and the `text/markdown` alternate on `/pricing`.
 */

import { type PricePoint } from '@declutrmail/shared/entitlements';

import {
  CAPABILITY_LABELS,
  TIER_JOBS,
  cardBullets,
  comparablePricingTiers,
  compareRows,
  formatInr,
  formatUsd,
  foundingProPromo,
  pricingTiers,
} from '@/features/marketing/pricing/pricing-model';
import { siteUrl } from '@/features/marketing/landing/urls';

/** "$9/mo · ₹749/mo in India" — both real manifest amounts, never an FX rate. */
function priceLine(point: PricePoint, per: string): string {
  const usd = `${formatUsd(point.usdCents)}${per}`;
  // INR is quoted only where that exact price point is provisioned on
  // Razorpay, matching what an India checkout will actually charge.
  return point.razorpayPlanId === null
    ? usd
    : `${usd} · ${formatInr(point.inrPaise)}${per} in India`;
}

function planSection(): string {
  return comparablePricingTiers()
    .map((tier) => {
      const lines = [`### ${tier.name}`, '', `Job: ${TIER_JOBS[tier.id]}`, ''];
      const monthly = tier.prices.monthly;
      const annual = tier.prices.annual;

      if (monthly && monthly.usdCents === 0 && !annual) {
        // State the figure rather than only the word: a model answering
        // "how much does it cost" should find a number to quote.
        lines.push(`Price: ${formatUsd(monthly.usdCents)}/mo — free, no card required.`);
      } else {
        if (monthly) lines.push(`Monthly: ${priceLine(monthly, '/mo')}`);
        if (annual) {
          lines.push(
            `Annual: ${priceLine(annual, '/yr')} (${formatUsd(Math.round(annual.usdCents / 12))}/mo effective)`,
          );
        }
      }

      lines.push('', 'Includes:', ...cardBullets(tier).map((bullet) => `- ${bullet}`));
      return lines.join('\n');
    })
    .join('\n\n');
}

function promoSection(): string {
  const founding = foundingProPromo();
  if (!founding) return '';
  const { hostTier, promo } = founding;
  return [
    `### ${promo.name}`,
    '',
    `Annual: ${priceLine(promo.annual, '/yr')} for the first ${promo.maxRedemptions} paying subscribers.`,
    `Grants ${hostTier.name} capabilities. The price stays locked while the subscription remains active.`,
    'Limited redemption, so it is not listed as a standing price.',
  ].join('\n');
}

function unavailableSection(): string {
  // The manifest pairs `nonPurchasableRow` with `purchasable: false`
  // exactly, asserted in entitlements.test.ts — so a missing row means
  // that test is already red. Skip the line rather than interpolate
  // `undefined` into a document whose whole claim is exact figures.
  const rows = pricingTiers().flatMap((tier) => {
    const row = tier.purchasable ? undefined : tier.nonPurchasableRow;
    return row ? [`- ${tier.name}: not purchasable at launch — ${row.label}.`] : [];
  });
  return rows.length ? ['## Not available yet', '', ...rows].join('\n') : '';
}

function comparisonTable(): string {
  const tiers = comparablePricingTiers();
  const header = `| Feature | ${tiers.map((tier) => tier.name).join(' | ')} |`;
  const divider = `| --- | ${tiers.map(() => '---').join(' | ')} |`;
  const rows = compareRows().map(
    (row) => `| ${row.label} | ${row.values.map((value) => value ?? 'Not included').join(' | ')} |`,
  );
  return [header, divider, ...rows].join('\n');
}

export function GET() {
  const origin = siteUrl();

  const markdown = `# DeclutrMail pricing

> Generated from the same pricing manifest that renders ${origin}/pricing, so
> these amounts are the amounts checkout charges. If a figure here disagrees
> with a third-party listing, this file is correct.

Billing runs through Paddle as merchant of record in USD worldwide, and through
Razorpay in INR for India. Both amounts below are independently set prices, not
a currency conversion — an India visitor is quoted and charged the INR figure.

## Plans

${planSection()}

${promoSection()}

${unavailableSection()}

## Feature comparison

${comparisonTable()}

Capability names above are the user-facing ones. "${CAPABILITY_LABELS.autopilot}"
and "${CAPABILITY_LABELS['autopilot-active']}" are the same feature at two
behaviours, which is the Plus-to-Pro difference rather than a second product.

## What every plan does, including Free

- Every Archive, Later, Delete, and Unsubscribe action shows the current
  matching count, an available sample, and the exact Gmail changes before you
  approve it. The worker re-checks Gmail at execution, so the final affected
  count can change if the mailbox changed in between.
- Manual actions affect current matched mail. They do not create future-mail
  rules; that is what Autopilot presets are for.
- Archive and Later can be reversed from Activity for the plan's undo window.
- Delete carries an Activity token for up to 30 days while Gmail retains
  Trash. Emptying Trash ends recovery sooner.
- A delivered unsubscribe request cannot be recalled.
- Full bodies fetched: 0. DeclutrMail never fetches or stores a full message
  body, HTML, attachments, inline images, or raw MIME. The published storage
  list is at ${origin}/security.

## Terms

- Paid plans carry a 30-day money-back guarantee. Terms: ${origin}/refunds
- Cancel any time from billing settings; access continues to the end of the
  paid period.
- Gmail and Google Workspace only. DeclutrMail is not affiliated with or
  endorsed by Google.
- Full pricing page: ${origin}/pricing
`;

  return new Response(markdown, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=3600',
    },
  });
}
