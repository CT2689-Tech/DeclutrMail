import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppException } from '../common/app-exception.js';
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
