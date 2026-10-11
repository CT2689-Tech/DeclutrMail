// apps/api/src/waitlist/waitlist.module.ts — D19 waitlist capture.
//
// Public (pre-auth) marketing surface; see waitlist.controller.ts for
// the compensating controls. DRIZZLE arrives via the global DbModule.

import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { OptionalSessionGuard } from './optional-session.guard.js';
import { WaitlistController } from './waitlist.controller.js';
import { WaitlistV1Controller } from './waitlist-v1.controller.js';
import { WaitlistService } from './waitlist.service.js';

@Module({
  imports: [AuthModule],
  controllers: [WaitlistController, WaitlistV1Controller],
  providers: [WaitlistService, OptionalSessionGuard],
})
export class WaitlistModule {}
