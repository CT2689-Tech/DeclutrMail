// Public launch flags. No session and no BILLING_ENABLED gate: the
// marketing site has to read PRICING_V2 / METER_V2 / BILLING_PASS_ENABLED
// without a rebuild, including while checkout itself is still dark.

import { Controller, Get } from '@nestjs/common';

import { ok, type Envelope } from '@declutrmail/shared/contracts';
import { isBillingPassEnabled, isMeterV2, isPricingV2 } from '@declutrmail/shared/entitlements';

export interface PublicPricingFlags {
  pricingV2: boolean;
  meterV2: boolean;
  passEnabled: boolean;
}

@Controller('pricing')
export class PricingPublicController {
  /** GET /api/pricing/public */
  @Get('public')
  flags(): Envelope<PublicPricingFlags> {
    return ok({
      pricingV2: isPricingV2(),
      meterV2: isMeterV2(),
      passEnabled: isBillingPassEnabled(),
    });
  }
}
