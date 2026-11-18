// Public pricing facts. No session and no BILLING_ENABLED gate: the
// marketing site reads India checkout availability without a rebuild.

import { Controller, Get } from '@nestjs/common';

import { ok, type Envelope } from '@declutrmail/shared/contracts';
import { indiaPaddlePricesConfigured } from '@declutrmail/shared/entitlements';

export interface PublicPricingFlags {
  /**
   * `pricingV2` / `meterV2` / `passEnabled` are always true: the 2026-10
   * pricing is unconditional. They stay on the wire because a web build
   * that predates their removal reads an absent value as the retired
   * pricing, and the web and API deploy separately.
   */
  pricingV2: true;
  meterV2: true;
  passEnabled: true;
  /** True when both India Paddle price ids are set. Not a feature flag. */
  indiaCheckoutOpen: boolean;
}

@Controller('pricing')
export class PricingPublicController {
  /** GET /api/pricing/public */
  @Get('public')
  flags(): Envelope<PublicPricingFlags> {
    return ok({
      pricingV2: true,
      meterV2: true,
      passEnabled: true,
      indiaCheckoutOpen: indiaPaddlePricesConfigured(),
    });
  }
}
