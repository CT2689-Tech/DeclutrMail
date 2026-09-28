import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { SupportRequestQueue } from '@declutrmail/workers';
import { UsersModule } from '../users/users.module.js';
import { SupportRequestController } from './support-request.controller.js';
import { SUPPORT_QUEUE_TOKEN, SupportRequestService } from './support-request.service.js';

@Module({
  imports: [AuthModule, UsersModule],
  controllers: [SupportRequestController],
  providers: [
    SupportRequestService,
    {
      provide: SUPPORT_QUEUE_TOKEN,
      useFactory: (): SupportRequestQueue | null =>
        process.env.REDIS_URL ? new SupportRequestQueue(process.env.REDIS_URL) : null,
    },
  ],
})
export class SupportRequestModule {}
