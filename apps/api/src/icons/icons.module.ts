import { Module } from '@nestjs/common';
import { Queue } from 'bullmq';

import { createRedisConnection, DOMAIN_ICON_QUEUE } from '@declutrmail/workers';
import type { DomainIconJobData } from '@declutrmail/workers';

import { AuthModule } from '../auth/auth.module.js';
import { IconsController } from './icons.controller.js';
import { DOMAIN_ICON_QUEUE_TOKEN, IconsService } from './icons.service.js';
import { OptionalJwtGuard } from './optional-jwt.guard.js';

/**
 * IconsModule (ADR-0034) — the first-party brand icon endpoint.
 *
 * Owns nothing user-scoped: its only table is `domain_icons`, a global
 * cache keyed on domain. It imports `AuthModule` for `OptionalJwtGuard`
 * — the route READS anonymously but only an authenticated caller may
 * cause an outbound resolution — and no mailbox module, since icons
 * are not mailbox-scoped and the route deliberately has no
 * `CurrentMailbox` dependency.
 *
 * The queue producer is null without `REDIS_URL` (same fail-open shape
 * as `ActionsModule` / `SendersModule`): local dev with no Redis
 * serves whatever is already cached and simply never schedules new
 * resolutions, so every uncached sender renders a monogram.
 */
@Module({
  imports: [AuthModule],
  controllers: [IconsController],
  providers: [
    IconsService,
    OptionalJwtGuard,
    {
      provide: DOMAIN_ICON_QUEUE_TOKEN,
      useFactory: (): Queue<DomainIconJobData> | null => {
        const url = process.env.REDIS_URL;
        if (!url) {
          return null;
        }
        return new Queue<DomainIconJobData>(DOMAIN_ICON_QUEUE, {
          connection: createRedisConnection(url),
        });
      },
    },
  ],
  // `SendersModule` resolves brand-mark availability for a whole page
  // in one read instead of letting the browser ask per avatar.
  exports: [IconsService],
})
export class IconsModule {}
