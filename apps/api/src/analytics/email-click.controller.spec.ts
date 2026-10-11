import 'reflect-metadata';

import { BadRequestException, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';

import type { ProductEventsPort } from '@declutrmail/shared/analytics/product-events';

import { JwtService } from '../auth/jwt.service.js';
import { SessionsService } from '../auth/sessions.service.js';
import { RATE_LIMIT_METADATA } from '../common/rate-limit/rate-limit.types.js';
import { EmailClickController } from './email-click.controller.js';
import { OptionalSessionGuard } from './optional-session.guard.js';

const MAILBOX = '00000000-0000-4000-8000-000000000002';
const USER = '11111111-1111-4111-8111-111111111111';

function controller(record = vi.fn()): {
  controller: EmailClickController;
  record: ReturnType<typeof vi.fn>;
} {
  const port: ProductEventsPort = { record };
  return { controller: new EmailClickController(port), record };
}

function request(userId?: string): Request {
  return { user: userId === undefined ? undefined : { userId } } as Request;
}

describe('POST /api/v1/analytics/email-click', () => {
  it('rejects a body that carries an email address', () => {
    const { controller: click, record } = controller();
    expect(() =>
      click.recordClick(
        { template: 'lapse', mailboxId: MAILBOX, email: 'ada@example.com' },
        request(),
      ),
    ).toThrow(BadRequestException);
    expect(record).not.toHaveBeenCalled();
  });

  it('records a valid anonymous click', () => {
    const { controller: click, record } = controller();
    const result = click.recordClick({ template: 'weekly', mailboxId: MAILBOX }, request());
    expect(result).toEqual({ data: { status: 'accepted' } });
    expect(record).toHaveBeenCalledWith(
      'email_link_clicked',
      { template: 'weekly', mailbox_id: MAILBOX },
      undefined,
    );
  });

  it('records an authenticated click with the session user id', () => {
    const { controller: click, record } = controller();
    click.recordClick({ template: 'sync_failed' }, request(USER));
    expect(record).toHaveBeenCalledWith('email_link_clicked', { template: 'sync_failed' }, USER);
  });

  it('rejects an unknown template', () => {
    const { controller: click, record } = controller();
    expect(() => click.recordClick({ template: 'not-a-template' }, request())).toThrow(
      BadRequestException,
    );
    expect(record).not.toHaveBeenCalled();
  });

  it('is rate-limited and does not require CSRF', () => {
    const source = EmailClickController.prototype.recordClick;
    expect(Reflect.getMetadata(RATE_LIMIT_METADATA, source)).toEqual({
      bucket: 'default',
      limit: 30,
      windowSec: 60,
    });
    const guards = Reflect.getMetadata('__guards__', source) as unknown[] | undefined;
    const names = (guards ?? []).map((guard) =>
      typeof guard === 'function' ? guard.name : String(guard),
    );
    expect(names.join(' ')).not.toMatch(/Csrf/);
  });
});

describe('OptionalSessionGuard', () => {
  const guard = new OptionalSessionGuard({} as JwtService, {} as SessionsService);

  it('lets an anonymous request through', async () => {
    const ctx = {
      switchToHttp: () => ({ getRequest: () => ({ cookies: {} }) }),
    } as ExecutionContext;
    expect(await guard.canActivate(ctx)).toBe(true);
  });
});
