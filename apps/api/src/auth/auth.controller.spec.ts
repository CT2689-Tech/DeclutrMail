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
      getMailboxHealth: vi
        .fn()
        .mockResolvedValue(new Map([['mb-1', { readiness: 'ready', needsReconnect: false }]])),
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
      users,
      mailboxes,
      sync,
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

  it('starts sync health when user and mailboxes resolve even while quota is pending', async () => {
    const h = meHarness();
    let releaseQuota!: (value: unknown) => void;
    h.entitlements.cleanupSummary.mockImplementation(
      () => new Promise((resolve) => (releaseQuota = resolve)),
    );
    let settled = false;
    const pending = h.controller.me(h.principal).finally(() => (settled = true));
    h.release([{ id: 'mb-1', email: 'a@example.com', status: 'active', connectedAt: null }]);
    try {
      await vi.waitFor(() => expect(h.sync.getMailboxHealth).toHaveBeenCalledWith(['mb-1']), {
        timeout: 100,
        interval: 5,
      });
      expect(settled).toBe(false);
    } finally {
      releaseQuota({ tier: 'pro', remaining: null, resetsAt: null });
      await pending;
    }
  });

  it('does not read sync health for a missing user', async () => {
    const h = meHarness();
    h.users.findById.mockResolvedValue(null);
    const pending = h.controller.me(h.principal);
    h.release([{ id: 'mb-1', email: 'a@example.com', status: 'active' }]);
    await expect(pending).rejects.toBeInstanceOf(UnauthorizedException);
    expect(h.sync.getMailboxHealth).not.toHaveBeenCalled();
  });

  it('does not start a new health read after quota has already failed', async () => {
    const h = meHarness();
    const failure = new Error('Quota database unavailable');
    h.entitlements.cleanupSummary.mockRejectedValue(failure);
    const pending = h.controller.me(h.principal);
    await expect(pending).rejects.toBe(failure);
    h.release([{ id: 'mb-1', status: 'active' }]);
    // Release all promise continuations without relying on elapsed time.
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(h.sync.getMailboxHealth).not.toHaveBeenCalled();
  });

  it('returns no active mailbox for an empty mailbox list', async () => {
    const h = meHarness();
    const pending = h.controller.me(h.principal);
    h.release([]);
    const { data } = await pending;
    expect(data.activeMailboxId).toBeNull();
    expect(data.mailboxes).toEqual([]);
    expect(h.sync.getMailboxHealth).toHaveBeenCalledWith([]);
  });

  it('keeps the selected active mailbox and reconnect health in the same envelope', async () => {
    const h = meHarness();
    h.users.findById.mockResolvedValue({
      id: 'user-1',
      email: 'a@example.com',
      workspaceId: 'ws-1',
      timezone: 'UTC',
      preferences: { activeMailboxId: 'mb-2' },
      signupAttributionRef: null,
      signupAttributionHeardFrom: 'friend',
    });
    h.sync.getMailboxHealth.mockResolvedValue(
      new Map([
        ['mb-1', { readiness: 'ready', needsReconnect: false }],
        ['mb-2', { readiness: 'ready', needsReconnect: true }],
      ]),
    );
    const pending = h.controller.me(h.principal);
    h.release([
      { id: 'mb-1', status: 'active' },
      { id: 'mb-2', status: 'active' },
    ]);
    const { data } = await pending;
    expect(data.activeMailboxId).toBe('mb-2');
    expect(data.mailboxes[1]).toMatchObject({ readiness: 'ready', needsReconnect: true });
  });
});
