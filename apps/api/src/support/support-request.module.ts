import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { UsersModule } from '../users/users.module.js';
import { SupportRequestController } from './support-request.controller.js';
import { SupportRequestService } from './support-request.service.js';

@Module({
  imports: [AuthModule, NotificationsModule, UsersModule],
  controllers: [SupportRequestController],
  providers: [SupportRequestService],
})
export class SupportRequestModule {}
