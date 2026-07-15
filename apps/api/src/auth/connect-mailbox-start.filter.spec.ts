import {
  BadRequestException,
  type CanActivate,
  type ExecutionContext,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppException } from '../common/app-exception.js';
import {
  ConnectMailboxStartFilter,
  connectMailboxStartResult,
} from './connect-mailbox-start.filter.js';

@Injectable()
class RejectBeforeHandlerGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    throw new BadRequestException('private guard detail');
  }
}

@Controller('_connect-start-filter-test')
class FilteredBrowserStartController {
  @Get()
  @UseGuards(RejectBeforeHandlerGuard)
  @UseFilters(ConnectMailboxStartFilter)
  start(): void {}

  @Get('unavailable')
  @UseFilters(ConnectMailboxStartFilter)
  unavailable(): void {
    throw new ServiceUnavailableException('private infrastructure detail');
  }
}

describe('ConnectMailboxStartFilter', () => {
  const originalWebUrl = process.env.WEB_URL;

  afterEach(() => {
    if (originalWebUrl === undefined) delete process.env.WEB_URL;
    else process.env.WEB_URL = originalWebUrl;
  });

  it.each([
    [HttpStatus.BAD_REQUEST, 'target_invalid'],
    [HttpStatus.PAYMENT_REQUIRED, 'inbox_limit'],
    [HttpStatus.UNAUTHORIZED, 'session_retry'],
    [HttpStatus.TOO_MANY_REQUESTS, 'rate_limited'],
    [HttpStatus.FORBIDDEN, null],
  ] as const)('maps HTTP %s to the closed %s result', (status, result) => {
    expect(connectMailboxStartResult(status)).toBe(result);
  });

  it.each([
    [new BadRequestException('private target detail'), 'target_invalid'],
    [new AppException({ code: 'INBOX_LIMIT_REACHED' }), 'inbox_limit'],
    [new HttpException('slow down', HttpStatus.TOO_MANY_REQUESTS), 'rate_limited'],
  ] as const)(
    'redirects an expected browser-start failure without echoing detail',
    (error, result) => {
      process.env.WEB_URL = 'https://app.example.test/';
      const redirect = vi.fn();
      const host = {
        switchToHttp: () => ({ getResponse: () => ({ redirect }) }),
      };

      new ConnectMailboxStartFilter().catch(
        error,
        host as unknown as Parameters<ConnectMailboxStartFilter['catch']>[1],
      );

      expect(redirect).toHaveBeenCalledWith(
        302,
        `https://app.example.test/settings?connect_start_result=${result}#mailboxes`,
      );
      expect(JSON.stringify(redirect.mock.calls)).not.toContain(error.message);
    },
  );

  it('catches a guard failure before the browser-start handler runs', async () => {
    process.env.WEB_URL = 'https://app.example.test';
    const moduleRef = await Test.createTestingModule({
      controllers: [FilteredBrowserStartController],
      providers: [RejectBeforeHandlerGuard],
    }).compile();
    const app = moduleRef.createNestApplication();

    try {
      await app.listen(0, '127.0.0.1');
      const response = await fetch(`${await app.getUrl()}/_connect-start-filter-test`, {
        redirect: 'manual',
      });

      expect(response.status).toBe(HttpStatus.FOUND);
      expect(response.headers.get('location')).toBe(
        'https://app.example.test/settings?connect_start_result=target_invalid#mailboxes',
      );
    } finally {
      await app.close();
    }
  });

  it('delegates an unexpected HTTP 5xx to the global diagnostic envelope', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [FilteredBrowserStartController],
      providers: [RejectBeforeHandlerGuard],
    }).compile();
    const app = moduleRef.createNestApplication();

    try {
      await app.listen(0, '127.0.0.1');
      const response = await fetch(`${await app.getUrl()}/_connect-start-filter-test/unavailable`, {
        redirect: 'manual',
      });
      const body = (await response.json()) as { error: Record<string, unknown> };

      expect(response.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
      expect(body.error).toMatchObject({
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
      });
      expect(body.error.correlationId).toEqual(expect.any(String));
      expect(JSON.stringify(body)).not.toContain('private infrastructure detail');
    } finally {
      await app.close();
    }
  });
});
