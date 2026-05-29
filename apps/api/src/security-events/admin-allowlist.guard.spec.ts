import type { ExecutionContext } from '@nestjs/common';
import { NotFoundException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { UsersService } from '../users/users.service.js';
import { AdminAllowlistGuard, isAllowlisted } from './admin-allowlist.guard.js';

/**
 * AdminAllowlistGuard tests (D181 read surface).
 *
 * Contract:
 *   - Any failure → NotFoundException (404), never 401/403, so an
 *     enumerator cannot distinguish "this route exists but you can't
 *     read it" from "this route doesn't exist".
 *   - Allowlist source is `ADMIN_EMAIL_ALLOWLIST` env (comma-separated).
 *   - Fail-closed: unset / empty env → every request 404s.
 *   - Case-insensitive email match; exact (not prefix).
 */

function makeCtx(req: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('isAllowlisted (D181 founder allowlist)', () => {
  const ORIG = process.env.ADMIN_EMAIL_ALLOWLIST;
  afterEach(() => {
    if (ORIG === undefined) {
      delete process.env.ADMIN_EMAIL_ALLOWLIST;
    } else {
      process.env.ADMIN_EMAIL_ALLOWLIST = ORIG;
    }
  });

  it('returns false when env is unset (fail-closed)', () => {
    delete process.env.ADMIN_EMAIL_ALLOWLIST;
    expect(isAllowlisted('chintan.a.thakkar@gmail.com')).toBe(false);
  });

  it('returns false when env is empty / whitespace', () => {
    process.env.ADMIN_EMAIL_ALLOWLIST = '';
    expect(isAllowlisted('a@b.example')).toBe(false);
    process.env.ADMIN_EMAIL_ALLOWLIST = '   ';
    expect(isAllowlisted('a@b.example')).toBe(false);
  });

  it('returns true for an exact match', () => {
    process.env.ADMIN_EMAIL_ALLOWLIST = 'founder@x.example';
    expect(isAllowlisted('founder@x.example')).toBe(true);
  });

  it('is case-insensitive on both sides', () => {
    process.env.ADMIN_EMAIL_ALLOWLIST = 'Founder@X.Example';
    expect(isAllowlisted('FOUNDER@x.EXAMPLE')).toBe(true);
  });

  it('matches one of N comma-separated entries; trims whitespace', () => {
    process.env.ADMIN_EMAIL_ALLOWLIST = ' a@x.example , b@x.example,c@x.example ';
    expect(isAllowlisted('b@x.example')).toBe(true);
    expect(isAllowlisted('c@x.example')).toBe(true);
    expect(isAllowlisted('d@x.example')).toBe(false);
  });

  it('rejects a prefix-style match (only exact)', () => {
    process.env.ADMIN_EMAIL_ALLOWLIST = 'founder@x.example';
    // An attacker crafting a longer email that begins with the
    // allowlisted local-part must NOT be treated as allowlisted.
    expect(isAllowlisted('founder@x.example.evil.example')).toBe(false);
    expect(isAllowlisted('founderx@x.example')).toBe(false);
  });
});

describe('AdminAllowlistGuard.canActivate', () => {
  const ORIG = process.env.ADMIN_EMAIL_ALLOWLIST;
  let users: { findById: ReturnType<typeof vi.fn> };
  let guard: AdminAllowlistGuard;

  beforeEach(() => {
    users = { findById: vi.fn() };
    guard = new AdminAllowlistGuard(users as unknown as UsersService);
  });

  afterEach(() => {
    if (ORIG === undefined) {
      delete process.env.ADMIN_EMAIL_ALLOWLIST;
    } else {
      process.env.ADMIN_EMAIL_ALLOWLIST = ORIG;
    }
  });

  it('404s when req.user is absent (defensive — JwtGuard should have run)', async () => {
    process.env.ADMIN_EMAIL_ALLOWLIST = 'founder@x.example';
    await expect(guard.canActivate(makeCtx({}))).rejects.toBeInstanceOf(NotFoundException);
    expect(users.findById).not.toHaveBeenCalled();
  });

  it('404s when the user row is missing (session ghost user)', async () => {
    process.env.ADMIN_EMAIL_ALLOWLIST = 'founder@x.example';
    users.findById.mockResolvedValueOnce(null);
    await expect(guard.canActivate(makeCtx({ user: { userId: 'u-1' } }))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('404s when the user email is NOT in the allowlist', async () => {
    process.env.ADMIN_EMAIL_ALLOWLIST = 'founder@x.example';
    users.findById.mockResolvedValueOnce({ id: 'u-2', email: 'random@example.com' });
    await expect(guard.canActivate(makeCtx({ user: { userId: 'u-2' } }))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('returns true when the user email IS in the allowlist', async () => {
    process.env.ADMIN_EMAIL_ALLOWLIST = 'founder@x.example,second@x.example';
    users.findById.mockResolvedValueOnce({ id: 'u-3', email: 'second@x.example' });
    await expect(guard.canActivate(makeCtx({ user: { userId: 'u-3' } }))).resolves.toBe(true);
  });

  it('404s when env is unset (mis-configuration fails closed)', async () => {
    delete process.env.ADMIN_EMAIL_ALLOWLIST;
    users.findById.mockResolvedValueOnce({ id: 'u-4', email: 'founder@x.example' });
    await expect(guard.canActivate(makeCtx({ user: { userId: 'u-4' } }))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
