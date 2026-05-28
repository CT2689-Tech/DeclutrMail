import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

import { JwtService, hashRefreshToken } from './jwt.service.js';

/**
 * JwtService unit tests (D155).
 *
 * Pure unit — no DB, no Redis. Verifies:
 *   - Boot fails fast on missing/short/duplicate secrets.
 *   - Access + refresh tokens carry the same jti.
 *   - Each kind verifies under ITS OWN secret only.
 *   - hashRefreshToken is stable + collision-safe.
 */
describe('JwtService (D155)', () => {
  const ACCESS = 'a'.repeat(48);
  const REFRESH = 'b'.repeat(48);

  beforeEach(() => {
    process.env.JWT_ACCESS_SECRET = ACCESS;
    process.env.JWT_REFRESH_SECRET = REFRESH;
  });

  afterEach(() => {
    delete process.env.JWT_ACCESS_SECRET;
    delete process.env.JWT_REFRESH_SECRET;
    vi.useRealTimers();
  });

  it('throws when JWT_ACCESS_SECRET is missing', () => {
    delete process.env.JWT_ACCESS_SECRET;
    expect(() => new JwtService()).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('throws when JWT_REFRESH_SECRET is shorter than 32 bytes', () => {
    process.env.JWT_REFRESH_SECRET = 'short';
    expect(() => new JwtService()).toThrow(/JWT_REFRESH_SECRET/);
  });

  it('throws when both secrets are identical', () => {
    process.env.JWT_REFRESH_SECRET = ACCESS;
    expect(() => new JwtService()).toThrow(/MUST differ/);
  });

  it('issues an access + refresh pair sharing one jti', async () => {
    const svc = new JwtService();
    const tokens = await svc.issue({
      userId: 'u1',
      workspaceId: 'w1',
      sessionId: 's1',
    });
    const accessClaims = await svc.verify(tokens.accessToken, 'access');
    const refreshClaims = await svc.verify(tokens.refreshToken, 'refresh');
    expect(accessClaims.jti).toBe(refreshClaims.jti);
    expect(accessClaims.sub).toBe('u1');
    expect(accessClaims.wsid).toBe('w1');
    expect(accessClaims.sid).toBe('s1');
    expect(accessClaims.kind).toBe('access');
    expect(refreshClaims.kind).toBe('refresh');
  });

  it('rejects an access token verified as refresh', async () => {
    const svc = new JwtService();
    const tokens = await svc.issue({ userId: 'u1', workspaceId: 'w1', sessionId: 's1' });
    await expect(svc.verify(tokens.accessToken, 'refresh')).rejects.toThrow();
  });

  it('rejects a tampered token', async () => {
    const svc = new JwtService();
    const tokens = await svc.issue({ userId: 'u1', workspaceId: 'w1', sessionId: 's1' });
    const tampered = tokens.accessToken.slice(0, -2) + 'XX';
    await expect(svc.verify(tampered, 'access')).rejects.toThrow();
  });

  it('hashRefreshToken is deterministic + matches IssuedTokens.refreshTokenHash', async () => {
    const svc = new JwtService();
    const tokens = await svc.issue({ userId: 'u1', workspaceId: 'w1', sessionId: 's1' });
    expect(hashRefreshToken(tokens.refreshToken)).toBe(tokens.refreshTokenHash);
    expect(hashRefreshToken(tokens.refreshToken)).toBe(hashRefreshToken(tokens.refreshToken));
    expect(hashRefreshToken(tokens.refreshToken)).not.toBe(hashRefreshToken(tokens.accessToken));
  });
});
