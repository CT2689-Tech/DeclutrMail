/**
 * Manual sandbox entry. The host and key check live in the mjs module.
 * Selection uses the same functions as checkout.
 */
import {
  SANDBOX_PRICE_IDS,
  checkoutDiscountId,
  selectPaddleCheckoutPrice,
  type PaddleCheckoutCode,
} from '../packages/shared/src/entitlements/pricing.config.js';

import { runIndiaSandboxCheckout } from './paddle-sandbox-india-checkout.mjs';

runIndiaSandboxCheckout({
  env: process.env,
  catalog: {
    plusUsdPriceId: SANDBOX_PRICE_IDS.plus_annual,
    passUsdPriceId: SANDBOX_PRICE_IDS.pass_onetime,
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
