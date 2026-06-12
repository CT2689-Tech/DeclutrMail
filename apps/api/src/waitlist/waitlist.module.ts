// apps/api/src/waitlist/waitlist.module.ts — D19 waitlist capture.
//
// Public (pre-auth) marketing surface; see waitlist.controller.ts for
// the compensating controls. DRIZZLE arrives via the global DbModule.

import { Module } from '@nestjs/common';

import { WaitlistController } from './waitlist.controller.js';
import { WaitlistService } from './waitlist.service.js';

@Module({
  controllers: [WaitlistController],
  providers: [WaitlistService],
})
export class WaitlistModule {}
