import { LEGACY_PRICE_IDS, PROMO, PROMO_DISCOUNT_IDS } from './pricing.config';

export interface DriftPrice {
  id: string;
  status: string;
  amount: string;
  currencyCode: string;
  inrAmount?: string | null;
  taxInclusive?: boolean;
}

export interface DriftDiscount {
  id: string;
  status: string;
  percent: number;
  restrictedPriceIds: string[];
  expiresAt: string | null;
}

export interface ManifestPriceCheck {
  id: string;
  usdCents: number;
  inrPaise: number | null;
  taxInclusive: boolean;
}

export interface DriftReport {
  ok: boolean;
  failures: string[];
}

/**
 * Read-only comparison of the Paddle catalog against the manifest.
 * FILL_ME ids fail as missing. An active Paddle price in neither the
 * manifest nor LEGACY_PRICE_IDS fails. A missing secret is the caller's
 * UNVERIFIED exit — this function never treats an empty catalog as clean.
 */
export function checkCatalogDrift(input: {
  manifest: ManifestPriceCheck[];
  paddlePrices: DriftPrice[];
  discount: DriftDiscount | null;
  discountId: string;
  /** Price ids PH30 is restricted to. Not every legacy catalog id. */
  promoPriceIds: string[];
}): DriftReport {
  const failures: string[] = [];
  const byId = new Map(input.paddlePrices.map((price) => [price.id, price]));
  const known = new Set<string>([
    ...input.manifest.map((price) => price.id),
    ...Object.keys(LEGACY_PRICE_IDS),
  ]);

  for (const expected of input.manifest) {
    if (!expected.id || expected.id === 'FILL_ME') {
      failures.push(`missing price id ${expected.id || '(empty)'}`);
      continue;
    }
    const live = byId.get(expected.id);
    if (!live || live.status === 'archived') {
      failures.push(`missing or archived price ${expected.id}`);
      continue;
    }
    if (live.amount !== String(expected.usdCents) || live.currencyCode !== 'USD') {
      failures.push(
        `amount mismatch ${expected.id}: paddle ${live.amount} ${live.currencyCode}, manifest ${expected.usdCents} USD`,
      );
    }
    if (expected.inrPaise !== null) {
      if (live.inrAmount !== String(expected.inrPaise)) {
        failures.push(
          `INR override mismatch ${expected.id}: paddle ${live.inrAmount ?? 'none'}, manifest ${expected.inrPaise}`,
        );
      }
      if (expected.taxInclusive && live.taxInclusive === false) {
        failures.push(`tax mode mismatch ${expected.id}: expected tax inclusive`);
      }
    }
  }

  for (const price of input.paddlePrices) {
    if (price.status !== 'active') continue;
    if (!known.has(price.id)) failures.push(`unknown active price ${price.id}`);
  }

  if (!input.discountId || input.discountId === 'FILL_ME') {
    failures.push('missing PH30 discount id');
  } else if (!input.discount || input.discount.id !== input.discountId) {
    failures.push(`missing PH30 discount ${input.discountId}`);
  } else {
    const discount = input.discount;
    if (discount.percent !== PROMO.percentOff) {
      failures.push(
        `PH30 percent mismatch: paddle ${discount.percent}, manifest ${PROMO.percentOff}`,
      );
    }
    const restricted = [...discount.restrictedPriceIds].sort().join(',');
    const expectedRestricted = [...input.promoPriceIds]
      .filter((id) => id !== 'FILL_ME')
      .sort()
      .join(',');
    if (restricted !== expectedRestricted) {
      failures.push(`PH30 restricted prices mismatch: paddle ${restricted || 'none'}`);
    }
    if (discount.expiresAt !== PROMO.endsAt) {
      failures.push(
        `PH30 expires_at mismatch: paddle ${discount.expiresAt ?? 'none'}, manifest ${PROMO.endsAt}`,
      );
    }
  }

  return { ok: failures.length === 0, failures };
}

export function promoDiscountId(env: NodeJS.ProcessEnv = process.env): string {
  return env.PADDLE_ENV === 'sandbox' ? PROMO_DISCOUNT_IDS.sandbox : PROMO_DISCOUNT_IDS.live;
}
