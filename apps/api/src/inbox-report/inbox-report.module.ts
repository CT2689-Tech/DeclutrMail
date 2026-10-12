import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { InboxReportController } from './inbox-report.controller.js';
import { InboxReportService } from './inbox-report.service.js';

@Module({
  imports: [AuthModule],
  controllers: [InboxReportController],
  providers: [InboxReportService],
  exports: [InboxReportService],
})
export class InboxReportModule {}
