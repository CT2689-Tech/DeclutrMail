import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { EmailClickController } from './email-click.controller.js';
import { OptionalSessionGuard } from './optional-session.guard.js';

@Module({
  imports: [AuthModule],
  controllers: [EmailClickController],
  providers: [OptionalSessionGuard],
})
export class EmailClickModule {}
