/**
 * Manual sandbox entry. Reads the catalog India prices. Does not create them.
 * Selection uses the same functions as checkout.
 */
import {
  SANDBOX_INDIA_PRICE_IDS,
  SANDBOX_PRICE_IDS,
  SANDBOX_PRODUCT_IDS,
  checkoutDiscountId,
  selectPaddleCheckoutPrice,
  type PaddleCheckoutCode,
} from '../packages/shared/src/entitlements/pricing.config.js';

import { runIndiaSandboxCheckout } from './paddle-sandbox-india-checkout.mjs';

const year = { interval: 'year', frequency: 1 };

runIndiaSandboxCheckout({
  env: process.env,
  catalog: {
    prices: [
      {
        code: 'plus_annual',
        id: SANDBOX_PRICE_IDS.plus_annual,
        productId: SANDBOX_PRODUCT_IDS.plus,
        amount: '5900',
        currency: 'USD',
        cycle: year,
        usdOnly: true,
      },
      {
        code: 'pass_onetime',
        id: SANDBOX_PRICE_IDS.pass_onetime,
        productId: SANDBOX_PRODUCT_IDS.pass,
        amount: '1900',
        currency: 'USD',
        cycle: null,
        usdOnly: true,
      },
      {
        code: 'plus_annual',
        id: SANDBOX_INDIA_PRICE_IDS.plus_annual,
        productId: SANDBOX_PRODUCT_IDS.plus,
        amount: '199900',
        currency: 'INR',
        cycle: year,
        taxMode: 'internal',
      },
      {
        code: 'pass_onetime',
        id: SANDBOX_INDIA_PRICE_IDS.pass_onetime,
        productId: SANDBOX_PRODUCT_IDS.pass,
        amount: '79900',
        currency: 'INR',
        cycle: null,
        taxMode: 'internal',
      },
    ],
  },
  selectPrice: (input) => {
    const code: PaddleCheckoutCode =
      input.code === 'plus_annual' || input.code === 'pass_onetime' ? input.code : 'other';
    return selectPaddleCheckoutPrice(process.env, {
      usdPriceId: input.usdPriceId,
      code,
      trustedCountry: input.trustedCountry,
    });
  },
  discountIdForPrice: (priceId) => checkoutDiscountId(process.env, priceId),
}).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`::error::${message}`);
  process.exit(1);
});
