import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import { ok, type Envelope, type SignupAttributionReport } from '@declutrmail/shared/contracts';

import { JwtGuard } from '../auth/jwt.guard.js';
import { RateLimit } from '../common/rate-limit/index.js';
import { AdminAllowlistGuard } from '../security-events/admin-allowlist.guard.js';
import { SignupAttributionReportService } from './signup-attribution-report.service.js';

@Controller('admin/signup-attribution')
@UseGuards(JwtGuard, AdminAllowlistGuard)
export class SignupAttributionReportController {
  constructor(private readonly reports: SignupAttributionReportService) {}

  @Get()
  @RateLimit('triage-load')
  @Header('Cache-Control', 'private, no-store')
  async getReport(): Promise<Envelope<SignupAttributionReport>> {
    return ok(await this.reports.getReport());
  }
}
