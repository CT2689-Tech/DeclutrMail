import { ServiceUnavailableException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { SIGNUP_HEARD_FROM_VALUES } from '@declutrmail/shared/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { JwtGuard } from '../auth/jwt.guard.js';
import { JwtService } from '../auth/jwt.service.js';
import { SessionsService } from '../auth/sessions.service.js';
import { AdminAllowlistGuard } from '../security-events/admin-allowlist.guard.js';
import { UsersService } from '../users/users.service.js';
import { SignupAttributionReportController } from './signup-attribution-report.controller.js';
import { SignupAttributionReportService } from './signup-attribution-report.service.js';

// Real HTTP, JwtGuard and existing admin allowlist gate; no external auth or database.
describe('signup attribution report HTTP access', () => {
  let app: INestApplication;
  let base: string;
  const report = {
    observedAt: '2026-10-27T19:00:00.000Z',
    totalAccounts: 0,
    answered: 0,
    skipped: 0,
    unanswered: 0,
    unrecognized: 0,
    channels: SIGNUP_HEARD_FROM_VALUES.filter((channel) => channel !== 'skipped').map(
      (channel) => ({ channel, count: 0 }),
    ),
  };
  const reports = { getReport: vi.fn() };
  const findById = vi.fn();
  const originalAllowlist = process.env.ADMIN_EMAIL_ALLOWLIST;

  beforeEach(async () => {
    process.env.ADMIN_EMAIL_ALLOWLIST = 'founder@example.test';
    reports.getReport.mockReset().mockResolvedValue(report);
    findById.mockReset().mockImplementation(async (id: string) => ({
      id,
      email: id === 'founder' ? 'founder@example.test' : 'member@example.test',
    }));
    const module = await Test.createTestingModule({
      controllers: [SignupAttributionReportController],
      providers: [
        { provide: SignupAttributionReportService, useValue: reports },
        { provide: UsersService, useValue: { findById } },
        {
          provide: JwtService,
          useValue: {
            verify: vi.fn(async (token: string) => ({
              sub: token,
              wsid: 'synthetic-workspace',
              sid: 'synthetic-session',
              jti: 'synthetic-jti',
            })),
          },
        },
        {
          provide: SessionsService,
          useValue: { lookupByJti: vi.fn(async () => ({ id: 'synthetic-session' })) },
        },
        JwtGuard,
        AdminAllowlistGuard,
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  });

  afterEach(async () => {
    await app.close();
    if (originalAllowlist === undefined) delete process.env.ADMIN_EMAIL_ALLOWLIST;
    else process.env.ADMIN_EMAIL_ALLOWLIST = originalAllowlist;
  });

  it('rejects anonymous access before querying any aggregate', async () => {
    const res = await fetch(`${base}/api/admin/signup-attribution`);
    expect(res.status).toBe(401);
    expect(reports.getReport).not.toHaveBeenCalled();
    expect(findById).not.toHaveBeenCalled();
  });

  it('conceals the report from a signed-in non-admin', async () => {
    const res = await fetch(`${base}/api/admin/signup-attribution`, {
      headers: { cookie: 'dm_access=member' },
    });
    expect(res.status).toBe(404);
    expect(reports.getReport).not.toHaveBeenCalled();
  });

  it('fails closed when the existing admin allowlist is unset', async () => {
    delete process.env.ADMIN_EMAIL_ALLOWLIST;
    const res = await fetch(`${base}/api/admin/signup-attribution`, {
      headers: { cookie: 'dm_access=founder' },
    });
    expect(res.status).toBe(404);
    expect(reports.getReport).not.toHaveBeenCalled();
  });

  it('returns the envelope privately to an allowlisted account', async () => {
    const res = await fetch(`${base}/api/admin/signup-attribution`, {
      headers: { cookie: 'dm_access=founder' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(await res.json()).toMatchObject({ data: report });
    expect(reports.getReport).toHaveBeenCalledOnce();
  });

  it('returns unavailable instead of a successful empty report after a read failure', async () => {
    reports.getReport.mockRejectedValueOnce(
      new ServiceUnavailableException('Signup attribution unavailable.'),
    );
    const res = await fetch(`${base}/api/admin/signup-attribution`, {
      headers: { cookie: 'dm_access=founder' },
    });
    expect(res.status).toBe(503);
    expect(await res.json()).not.toHaveProperty('data');
  });
});
