import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppException } from '../common/app-exception.js';
import { refusalOf } from './action-previews.service.js';
import { McpToolError, toToolError } from './mcp-tool-errors.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('toToolError — what a service threw, as the assistant is told it', () => {
  it('turns the monthly limit into QUOTA_EXHAUSTED with the reset date and an upgrade link', () => {
    vi.stubEnv('WEB_URL', 'https://app.declutrmail.com');
    const error = toToolError(
      new AppException({
        code: 'FREE_CAP_REACHED',
        message: 'You have used 50 of 50.',
        details: { limit: 50, used: 50, remaining: 0, resetsAt: '2026-12-01T00:00:00.000Z' },
      }),
    );
    expect(error).toMatchObject({
      code: 'QUOTA_EXHAUSTED',
      message: 'You have used 50 of 50.',
      details: {
        limit: 50,
        used: 50,
        remaining: 0,
        resets_at: '2026-12-01T00:00:00.000Z',
        upgrade_url: 'https://app.declutrmail.com/billing',
      },
    });
  });

  it('turns a plan refusal into UPGRADE_REQUIRED with the link', () => {
    vi.stubEnv('WEB_URL', 'https://app.declutrmail.com');
    const error = toToolError(
      new AppException({ code: 'ACTION_TIER_REQUIRED', message: 'Needs Plus.' }),
    );
    expect(error).toMatchObject({
      code: 'UPGRADE_REQUIRED',
      details: { upgrade_url: 'https://app.declutrmail.com/billing' },
    });
  });

  it.each(['QUEUE_UNAVAILABLE', 'ACTION_QUEUE_UNAVAILABLE', 'ENQUEUE_FAILED'])(
    'answers QUEUE_UNAVAILABLE for %s without repeating the driver’s words',
    (code) => {
      const error = toToolError(
        new ServiceUnavailableException({ code, message: 'connect ECONNREFUSED 10.0.0.5:6379' }),
      );
      expect(error?.code).toBe('QUEUE_UNAVAILABLE');
      expect(error?.message).not.toContain('10.0.0.5');
    },
  );

  it('passes a validation message through as INVALID_REQUEST', () => {
    expect(toToolError(new BadRequestException('Invalid cursor.'))).toMatchObject({
      code: 'INVALID_REQUEST',
      message: 'Invalid cursor.',
    });
  });

  it('returns null for anything it does not know, so the caller answers with a fixed sentence', () => {
    expect(toToolError(new Error('relation "senders" does not exist'))).toBeNull();
    expect(toToolError(new ConflictException({ code: 'SOMETHING_NEW', message: 'x' }))).toBeNull();
    expect(toToolError('a string')).toBeNull();
  });

  it('leaves a tool error as it is', () => {
    const error = new McpToolError('PREVIEW_EXPIRED', 'expired');
    expect(toToolError(error)).toBe(error);
  });
});

describe('refusalOf — which failed starts spend the person’s press', () => {
  it.each([
    ['the monthly limit', new AppException({ code: 'FREE_CAP_REACHED' }), 'QUOTA_EXHAUSTED'],
    [
      'a plan that lacks it',
      new AppException({ code: 'ACTION_TIER_REQUIRED' }),
      'UPGRADE_REQUIRED',
    ],
    [
      'sending switched off',
      new ConflictException({ code: 'UNSUB_SEND_DISABLED', message: 'off' }),
      'UNSUBSCRIBE_UNAVAILABLE',
    ],
  ])('%s does: the person has to change something first', (_label, error, code) => {
    expect(refusalOf(error)).toBe(code);
  });

  it.each([
    ['the queue being down', new ServiceUnavailableException({ code: 'ACTION_QUEUE_UNAVAILABLE' })],
    ['no sender left to act on', new McpToolError('NO_ACTIONABLE_SENDERS', 'none')],
    ['a sender gone missing', new McpToolError('SENDER_NOT_FOUND', 'gone')],
    ['a bad request', new BadRequestException({ code: 'BAD_REQUEST', message: 'no' })],
    ['anything unexpected', new Error('connection reset')],
  ])('%s does not: the press stands and a retry continues', (_label, error) => {
    expect(refusalOf(error)).toBeNull();
  });
});
