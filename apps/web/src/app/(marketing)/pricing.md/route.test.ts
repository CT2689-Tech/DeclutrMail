/**
 * `/pricing.md` drift guard.
 *
 * The point of a machine-readable pricing file is that a model can trust
 * it, so the failure mode that matters is not "the file is missing" but
 * "the file quotes a price nothing charges". Every assertion here is
 * computed FROM `TIER_MANIFEST`, and the last one is the important one: no
 * money figure may appear in the document that the manifest cannot produce.
 */

import { describe, expect, it } from 'vitest';

import {
  TIER_MANIFEST,
  UNIFORM_UNDO_WINDOW_DAYS,
  type TierDefinition,
} from '@declutrmail/shared/entitlements';

import {
  CAPABILITY_LABELS,
  formatInr,
  formatUsd,
  pricingTiers,
} from '@/features/marketing/pricing/pricing-model';
import { GET } from './route';

const TIERS = pricingTiers();
const PURCHASABLE = TIERS.filter((tier) => tier.purchasable);

function pricePoints(tier: TierDefinition) {
  return [tier.prices.monthly, tier.prices.annual].filter((point) => point !== null);
}

async function body(): Promise<string> {
  const response = GET();
  expect(response.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8');
  return response.text();
}

describe('/pricing.md — machine-readable pricing', () => {
  it('names every purchasable tier and its manifest amounts in both charged currencies', async () => {
    const markdown = await body();

    for (const tier of PURCHASABLE) {
      expect(markdown, tier.id).toContain(tier.name);
      for (const point of pricePoints(tier)) {
        expect(markdown, `${tier.id} USD`).toContain(formatUsd(point.usdCents));
        // INR is quoted only where the point is actually provisioned on
        // Razorpay — quoting it otherwise advertises a price no checkout
        // can take (D117).
        if (point.razorpayPlanId !== null) {
          expect(markdown, `${tier.id} INR`).toContain(formatInr(point.inrPaise));
        }
      }
      expect(markdown, `${tier.id} inboxes`).toContain(String(tier.inboxLimit));
      expect(markdown, `${tier.id} undo`).toContain(`${tier.undoWindowDays} days`);
    }
  });

  it('publishes the promo with its redemption cap, not as a standing price', async () => {
    const markdown = await body();
    const promo = TIER_MANIFEST.pro.promo;

    expect(promo).toBeTruthy();
    expect(markdown).toContain(promo!.name);
    expect(markdown).toContain(formatUsd(promo!.annual.usdCents));
    expect(markdown).toContain(String(promo!.maxRedemptions));
    expect(markdown).toMatch(/Limited redemption/i);
  });

  it('marks the unpurchasable tiers as unavailable instead of quoting placeholder values', async () => {
    const markdown = await body();

    for (const tier of TIERS.filter((candidate) => !candidate.purchasable)) {
      expect(markdown).toContain(`${tier.name}: not purchasable at launch`);
      expect(markdown).toContain(tier.nonPurchasableRow!.label);
    }
  });

  it('lists every capability the manifest ships', async () => {
    const markdown = await body();
    for (const label of Object.values(CAPABILITY_LABELS)) {
      expect(markdown, label).toContain(label);
    }
  });

  it('carries the product limits with the plans, not just the features', async () => {
    const markdown = await body();

    expect(markdown).toMatch(/matching count.{0,120}before you\s+approve/is);
    expect(markdown).toMatch(/do not create future-mail\s+rules/is);
    expect(markdown).toMatch(/delivered unsubscribe request cannot be recalled/i);
    expect(markdown).toContain('never fetches or stores full email contents');
    // The universal-undo shorthand this repo bans everywhere else.
    expect(markdown).not.toMatch(/every action (?:is|remains) (?:undoable|reversible)/i);
  });

  it('states the Activity Undo window for Archive and Later instead of hedging (D245)', async () => {
    const markdown = await body();

    expect(markdown).not.toContain("for the plan's undo window");
    if (UNIFORM_UNDO_WINDOW_DAYS !== null) {
      expect(markdown).toContain(
        `Archive and Later can be reversed from Activity for the ${UNIFORM_UNDO_WINDOW_DAYS}-day Activity Undo window.`,
      );
    }
    // Gmail's own Trash retention is a separate fact and stays literal.
    expect(markdown).toContain('Delete carries an Activity token for up to 30 days');
  });

  it('quotes no money figure the manifest cannot produce', async () => {
    const markdown = await body();

    const allowedUsd = new Set<string>();
    const allowedInr = new Set<string>();
    const record = (point: { usdCents: number; inrPaise: number }) => {
      allowedUsd.add(formatUsd(point.usdCents));
      allowedInr.add(formatInr(point.inrPaise));
    };
    for (const tier of TIERS) {
      for (const point of pricePoints(tier)) {
        record(point);
        // The "/mo effective" line divides the annual amount in the same
        // currency, so its rounded value is legitimate output too.
        if (point === tier.prices.annual) {
          record({
            usdCents: Math.round(point.usdCents / 12),
            inrPaise: Math.round(point.inrPaise / 12),
          });
        }
      }
      if (tier.promo) record(tier.promo.annual);
    }

    for (const found of markdown.match(/\$[\d,]+(?:\.\d{2})?/g) ?? []) {
      expect(allowedUsd.has(found), `${found} is not a manifest price`).toBe(true);
    }
    for (const found of markdown.match(/₹[\d,]+(?:\.\d{2})?/g) ?? []) {
      expect(allowedInr.has(found), `${found} is not a manifest price`).toBe(true);
    }
  });
});
