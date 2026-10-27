import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { AuthModule } from '../auth/auth.module.js';
import { JwtGuard } from '../auth/jwt.guard.js';
import { JwtService } from '../auth/jwt.service.js';
import { SessionsService } from '../auth/sessions.service.js';
import { DRIZZLE } from '../db/db.module.js';
import { SignupAttributionReportController } from './signup-attribution-report.controller.js';
import { SignupAttributionReportModule } from './signup-attribution-report.module.js';
import { SignupAttributionReportService } from './signup-attribution-report.service.js';

@Global()
@Module({ providers: [{ provide: DRIZZLE, useValue: {} }], exports: [DRIZZLE] })
class FixtureDbModule {}

// Keep the real guards and feature modules. Only network-backed auth services are replaced.
@Module({
  providers: [
    { provide: JwtService, useValue: {} },
    { provide: SessionsService, useValue: {} },
    JwtGuard,
  ],
  exports: [JwtService, SessionsService, JwtGuard],
})
class FixtureAuthModule {}

describe('signup attribution report module composition', () => {
  it('resolves the actual controller guards through their owning module dependencies', async () => {
    const module = await Test.createTestingModule({
      imports: [FixtureDbModule, SignupAttributionReportModule],
    })
      .overrideModule(AuthModule)
      .useModule(FixtureAuthModule)
      .compile();
    try {
      expect(module.get(SignupAttributionReportController)).toBeInstanceOf(
        SignupAttributionReportController,
      );
      expect(module.get(SignupAttributionReportService)).toBeInstanceOf(
        SignupAttributionReportService,
      );
    } finally {
      await module.close();
    }
  });
});
