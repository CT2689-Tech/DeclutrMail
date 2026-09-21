import { describe, expect, it, vi } from 'vitest';
import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthController } from './auth.controller.js';

function harness() {
  const sessions = { rotate: vi.fn() };
  const jwt = { verify: vi.fn().mockResolvedValue({ sid: 'session-1' }) };
  const csrf = { issue: vi.fn().mockReturnValue('new-csrf') };
  const controller = new AuthController(
    ...([sessions, jwt, csrf, {}, {}, {}, {}] as unknown as ConstructorParameters<
      typeof AuthController
    >),
  );
  const response = { cookie: vi.fn(), clearCookie: vi.fn() };
  const request = { cookies: { dm_refresh: 'refresh-token' } } as unknown as Request;
  const refresh = () => controller.refresh(request, response as unknown as Response);
  return { sessions, jwt, response, refresh };
}

describe('AuthController refresh failure classification', () => {
  it('keeps cookies and returns a retryable failure when rotation cannot reach the database', async () => {
    const { sessions, response, refresh } = harness();
    sessions.rotate.mockRejectedValue(new Error('Database connection unavailable'));
    await expect(refresh()).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(response.clearCookie).not.toHaveBeenCalled();
    expect(response.cookie).not.toHaveBeenCalled();
  });

  it('still clears cookies when the session service rejects a revoked or reused token', async () => {
    const { sessions, response, refresh } = harness();
    sessions.rotate.mockRejectedValue(new UnauthorizedException('Session revoked'));
    await expect(refresh()).rejects.toBeInstanceOf(UnauthorizedException);
    expect(response.clearCookie).toHaveBeenCalledTimes(3);
    expect(response.cookie).not.toHaveBeenCalled();
  });

  it('rejects an invalid signed token before attempting rotation', async () => {
    const { sessions, jwt, refresh } = harness();
    jwt.verify.mockRejectedValue(new Error('Invalid signature'));
    await expect(refresh()).rejects.toBeInstanceOf(UnauthorizedException);
    expect(sessions.rotate).not.toHaveBeenCalled();
  });

  it('writes fresh cookies after successful rotation', async () => {
    const { sessions, response, refresh } = harness();
    sessions.rotate.mockResolvedValue({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      accessExpiresAt: new Date(),
      refreshExpiresAt: new Date(),
    });
    await expect(refresh()).resolves.toMatchObject({ data: { ok: true } });
    expect(response.cookie).toHaveBeenCalledTimes(3);
    expect(response.clearCookie).not.toHaveBeenCalled();
  });
});

describe('AuthController me', () => {
  function meHarness() {
    let releaseMailboxes!: (rows: unknown[]) => void;
    const users = {
      findById: vi.fn().mockResolvedValue({
        id: 'user-1',
        email: 'a@example.com',
        workspaceId: 'ws-1',
        timezone: null,
        preferences: {},
        signupAttributionRef: null,
        signupAttributionHeardFrom: 'friend',
      }),
    };
    const mailboxes = {
      listByWorkspace: vi.fn(
        () => new Promise<unknown[]>((resolve) => (releaseMailboxes = resolve)),
      ),
    };
    const sync = {
      getReadinessByMailbox: vi.fn().mockResolvedValue(new Map([['mb-1', 'ready']])),
      getNeedsReconnectByMailbox: vi.fn().mockResolvedValue(new Map([['mb-1', false]])),
    };
    const entitlements = {
      cleanupSummary: vi.fn().mockResolvedValue({
        tier: 'free',
        limit: 50,
        used: 8,
        remaining: 42,
        resetsAt: new Date('2026-10-01T00:00:00.000Z'),
      }),
    };
    const controller = new AuthController(
      ...([{}, {}, {}, users, mailboxes, sync, entitlements] as unknown as ConstructorParameters<
        typeof AuthController
      >),
    );
    const principal = { userId: 'user-1', workspaceId: 'ws-1', sessionId: 's', jti: 'j' };
    return {
      controller,
      principal,
      entitlements,
      release: (rows: unknown[]) => releaseMailboxes(rows),
    };
  }

  it('starts the quota read without waiting for the mailbox list', async () => {
    const h = meHarness();
    const pending = h.controller.me(h.principal);
    await Promise.resolve();
    expect(h.entitlements.cleanupSummary).toHaveBeenCalledWith('ws-1');
    h.release([{ id: 'mb-1', email: 'a@example.com', status: 'active', connectedAt: null }]);
    const { data } = await pending;
    expect(data.tier).toBe('free');
    expect(data.cleanupRemaining).toBe(42);
    expect(data.cleanupResetsAt).toBe('2026-10-01T00:00:00.000Z');
    expect(data.activeMailboxId).toBe('mb-1');
    expect(data.mailboxes[0]).toMatchObject({ readiness: 'ready', needsReconnect: false });
  });
});
