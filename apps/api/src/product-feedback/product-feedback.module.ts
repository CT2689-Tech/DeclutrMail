import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { MailboxAccountsModule } from '../mailboxes/mailbox-accounts.module.js';
import { ProductFeedbackController } from './product-feedback.controller.js';
import { ProductFeedbackService } from './product-feedback.service.js';

@Module({
  imports: [AuthModule, MailboxAccountsModule],
  controllers: [ProductFeedbackController],
  providers: [ProductFeedbackService],
  exports: [ProductFeedbackService],
})
export class ProductFeedbackModule {}
