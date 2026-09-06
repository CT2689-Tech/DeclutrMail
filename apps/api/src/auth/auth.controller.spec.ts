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
