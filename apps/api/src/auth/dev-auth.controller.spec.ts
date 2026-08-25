import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import type { Request, Response } from 'express';

import { DevAuthController, devAuthEnabled, devAuthEmailAllowed } from './dev-auth.controller.js';
import type { UsersService } from '../users/users.service.js';
import type { SessionsService } from './sessions.service.js';
import type { CsrfService } from './csrf.service.js';

/**
 * Safety proof for the dev test-login (D206). The behavior under test is
 * almost entirely "refuse" — the whole point is that this auth bypass is
 * unreachable unless explicitly opted in, in a non-prod env, for an
 * allowlisted email.
 */
describe('dev-auth gating', () => {
  const ORIGINAL = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  describe('devAuthEnabled', () => {
    it('false in production even when DEV_AUTH_ENABLED=true', () => {
      process.env.NODE_ENV = 'production';
      process.env.DEV_AUTH_ENABLED = 'true';
      expect(devAuthEnabled()).toBe(false);
    });

    it('false when DEV_AUTH_ENABLED is unset or not exactly "true"', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.DEV_AUTH_ENABLED;
      expect(devAuthEnabled()).toBe(false);
      process.env.DEV_AUTH_ENABLED = '1';
      expect(devAuthEnabled()).toBe(false);
    });

    it('true only in non-prod with the explicit opt-in', () => {
      process.env.NODE_ENV = 'development';
      process.env.DEV_AUTH_ENABLED = 'true';
      expect(devAuthEnabled()).toBe(true);
    });
  });

  describe('devAuthEmailAllowed', () => {
    it('false when the prefix is unset (no email is allowed by default)', () => {
      delete process.env.DEV_AUTH_EMAIL_PREFIX;
      expect(devAuthEmailAllowed('chintan@example.com')).toBe(false);
    });

    it('matches only the configured prefix', () => {
      process.env.DEV_AUTH_EMAIL_PREFIX = 'chintan';
      expect(devAuthEmailAllowed('chintan.a.thakkar@gmail.com')).toBe(true);
      expect(devAuthEmailAllowed('attacker@evil.com')).toBe(false);
    });
  });
});

describe('DevAuthController.login', () => {
  const ORIGINAL = { ...process.env };
  let users: { findByEmail: ReturnType<typeof vi.fn> };
  let sessions: { issue: ReturnType<typeof vi.fn> };
  let csrf: { issue: ReturnType<typeof vi.fn> };
  let db: { update: ReturnType<typeof vi.fn> };
  let controller: DevAuthController;
  let res: { cookie: ReturnType<typeof vi.fn>; redirect: ReturnType<typeof vi.fn> };

  const req = { ip: '127.0.0.1', headers: {} } as unknown as Request;

  beforeEach(() => {
    users = { findByEmail: vi.fn().mockResolvedValue({ userId: 'u1', workspaceId: 'w1' }) };
    sessions = { issue: vi.fn().mockResolvedValue({ tokens: {}, sessionId: 's' }) };
    csrf = { issue: vi.fn().mockReturnValue('csrf') };
    db = makeDbStub();
    res = { cookie: vi.fn(), redirect: vi.fn() };
    controller = new DevAuthController(
      users as unknown as UsersService,
      sessions as unknown as SessionsService,
      csrf as unknown as CsrfService,
      db as never,
    );
  });
  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  function enable(): void {
    process.env.NODE_ENV = 'development';
    process.env.DEV_AUTH_ENABLED = 'true';
    process.env.DEV_AUTH_EMAIL_PREFIX = 'chintan';
  }

  it('404s when the dev login is disabled', async () => {
    delete process.env.DEV_AUTH_ENABLED;
    await expect(
      controller.login('chintan@gmail.com', req, res as unknown as Response),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(sessions.issue).not.toHaveBeenCalled();
  });

  it('404s for a non-allowlisted email even when enabled', async () => {
    enable();
    await expect(
      controller.login('attacker@evil.com', req, res as unknown as Response),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(users.findByEmail).not.toHaveBeenCalled();
    expect(sessions.issue).not.toHaveBeenCalled();
  });

  it('404s when the allowlisted user does not exist (never creates one)', async () => {
    enable();
    users.findByEmail.mockResolvedValue(null);
    await expect(
      controller.login('chintan@gmail.com', req, res as unknown as Response),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(sessions.issue).not.toHaveBeenCalled();
  });

  it('issues a session + redirects when all three gates pass', async () => {
    enable();
    await controller.login('chintan.a.thakkar@gmail.com', req, res as unknown as Response);
    expect(sessions.issue).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', workspaceId: 'w1' }),
    );
    expect(res.cookie).toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(302, expect.stringContaining('/senders'));
  });
});

/**
 * Minimal Drizzle chain stub for `db.update(x).set(y).where(z)`. Records
 * the `set` payload so a test can assert WHAT was written, not merely
 * that something was.
 */
function makeDbStub(): { update: ReturnType<typeof vi.fn>; sets: unknown[] } {
  const sets: unknown[] = [];
  const update = vi.fn(() => ({
    set: (values: unknown) => {
      sets.push(values);
      return { where: () => Promise.resolve() };
    },
  }));
  return { update, sets };
}

describe('DevAuthController.setTier (dev-only entitlement switch)', () => {
  const ORIGINAL = { ...process.env };
  let db: ReturnType<typeof makeDbStub>;
  let controller: DevAuthController;
  let res: { redirect: ReturnType<typeof vi.fn> };

  const principal = { userId: 'u1', workspaceId: 'w1' } as never;

  beforeEach(() => {
    db = makeDbStub();
    res = { redirect: vi.fn() };
    controller = new DevAuthController(
      { findByEmail: vi.fn() } as unknown as UsersService,
      { issue: vi.fn() } as unknown as SessionsService,
      { issue: vi.fn() } as unknown as CsrfService,
      db as never,
    );
  });
  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  function enable(): void {
    process.env.NODE_ENV = 'development';
    process.env.DEV_AUTH_ENABLED = 'true';
  }

  it('404s when the dev gate is off — and writes nothing', async () => {
    delete process.env.DEV_AUTH_ENABLED;
    await expect(
      controller.setTier(principal, 'pro', undefined, res as unknown as Response),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('404s in production even when explicitly enabled', async () => {
    process.env.NODE_ENV = 'production';
    process.env.DEV_AUTH_ENABLED = 'true';
    await expect(
      controller.setTier(principal, 'pro', undefined, res as unknown as Response),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('404s on a tier that is not in the manifest', async () => {
    enable();
    for (const bogus of ['admin', 'PRO', '', undefined]) {
      await expect(
        controller.setTier(principal, bogus, undefined, res as unknown as Response),
      ).rejects.toBeInstanceOf(NotFoundException);
    }
    expect(db.update).not.toHaveBeenCalled();
  });

  it('writes the requested tier and lands on Settings by default', async () => {
    enable();
    await controller.setTier(principal, 'plus', undefined, res as unknown as Response);
    expect(db.sets).toEqual([{ tier: 'plus' }]);
    expect(res.redirect).toHaveBeenCalledWith(302, expect.stringContaining('/settings'));
  });

  it('honours a same-origin next path', async () => {
    enable();
    await controller.setTier(principal, 'pro', '/brief', res as unknown as Response);
    expect(res.redirect).toHaveBeenCalledWith(302, expect.stringContaining('/brief'));
  });

  it('refuses to bounce the browser to another host', async () => {
    enable();
    // `//evil.com` and `/\evil.com` are protocol-relative URLs, not paths:
    // a bare `startsWith('/')` check would send the browser off-origin.
    for (const hostile of ['//evil.com', '/\\evil.com', 'https://evil.com', 'brief']) {
      res.redirect.mockClear();
      await controller.setTier(principal, 'pro', hostile, res as unknown as Response);
      const target = res.redirect.mock.calls[0]![1] as string;
      expect(target).toContain('/settings');
      expect(target).not.toContain('evil.com');
    }
  });
});
