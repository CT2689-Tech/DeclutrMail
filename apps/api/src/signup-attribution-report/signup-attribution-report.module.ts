import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { SecurityEventsModule } from '../security-events/security-events.module.js';
import { UsersModule } from '../users/users.module.js';
import { SignupAttributionReportController } from './signup-attribution-report.controller.js';
import { SignupAttributionReportService } from './signup-attribution-report.service.js';

@Module({
  // Nest instantiates controller guards in this module's context; the allowlist
  // guard therefore needs UsersModule here even though the guard is exported.
  imports: [AuthModule, UsersModule, SecurityEventsModule],
  controllers: [SignupAttributionReportController],
  providers: [SignupAttributionReportService],
})
export class SignupAttributionReportModule {}
