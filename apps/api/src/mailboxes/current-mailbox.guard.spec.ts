import { ConflictException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { UsersService } from '../users/users.service.js';
import type { MailboxAccountsService, MailboxSummary } from './mailbox-accounts.service.js';
import { CurrentMailboxGuard, MAILBOX_HEADER } from './current-mailbox.guard.js';

const PRINCIPAL = { userId: 'u1', workspaceId: 'w1', sessionId: 's1', jti: 'j1' };

function makeReq(opts: { headerValue?: string; user?: typeof PRINCIPAL | undefined }) {
  return {
    headers: opts.headerValue ? { [MAILBOX_HEADER]: opts.headerValue } : {},
    user: opts.user,
    mailbox: undefined as { id: string } | undefined,
  };
}

function makeCtx(req: ReturnType<typeof makeReq>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function summary(id: string, status: 'active' | 'disconnected' = 'active'): MailboxSummary {
  return { id, email: `${id}@x.test`, status, connectedAt: null };
}

describe('CurrentMailboxGuard (D155 + D205)', () => {
  let users: { findById: ReturnType<typeof vi.fn> };
  let mailboxes: {
    listByWorkspace: ReturnType<typeof vi.fn>;
    findOwned: ReturnType<typeof vi.fn>;
  };
  let guard: CurrentMailboxGuard;

  beforeEach(() => {
    users = { findById: vi.fn() };
    mailboxes = { listByWorkspace: vi.fn(), findOwned: vi.fn() };
    guard = new CurrentMailboxGuard(
      users as unknown as UsersService,
      mailboxes as unknown as MailboxAccountsService,
    );
  });

  it('throws when JwtGuard did not run first', async () => {
    const req = makeReq({ user: undefined });
    await expect(guard.canActivate(makeCtx(req))).rejects.toThrow(UnauthorizedException);
  });

  it('throws NO_ACTIVE_MAILBOX when no active mailboxes exist', async () => {
    mailboxes.listByWorkspace.mockResolvedValue([summary('m1', 'disconnected')]);
    const req = makeReq({ user: PRINCIPAL });
    await expect(guard.canActivate(makeCtx(req))).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'NO_ACTIVE_MAILBOX' }),
    });
  });

  it('uses single active mailbox when no preference set', async () => {
    mailboxes.listByWorkspace.mockResolvedValue([summary('m1')]);
    users.findById.mockResolvedValue({ preferences: {} });
    const req = makeReq({ user: PRINCIPAL });
    const ok = await guard.canActivate(makeCtx(req));
    expect(ok).toBe(true);
    expect(req.mailbox).toEqual({ id: 'm1' });
  });

  it('throws SELECT_MAILBOX when multiple mailboxes + no preference', async () => {
    mailboxes.listByWorkspace.mockResolvedValue([summary('m1'), summary('m2')]);
    users.findById.mockResolvedValue({ preferences: {} });
    const req = makeReq({ user: PRINCIPAL });
    await expect(guard.canActivate(makeCtx(req))).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'SELECT_MAILBOX' }),
    });
  });

  it('honours user preference activeMailboxId', async () => {
    mailboxes.listByWorkspace.mockResolvedValue([summary('m1'), summary('m2')]);
    users.findById.mockResolvedValue({ preferences: { activeMailboxId: 'm2' } });
    const req = makeReq({ user: PRINCIPAL });
    await guard.canActivate(makeCtx(req));
    expect(req.mailbox).toEqual({ id: 'm2' });
  });

  it('honours X-Active-Mailbox-Id header override', async () => {
    mailboxes.listByWorkspace.mockResolvedValue([summary('m1'), summary('m2')]);
    const req = makeReq({ user: PRINCIPAL, headerValue: 'm2' });
    await guard.canActivate(makeCtx(req));
    expect(req.mailbox).toEqual({ id: 'm2' });
  });

  it('rejects header pointing at unowned mailbox', async () => {
    mailboxes.listByWorkspace.mockResolvedValue([summary('m1')]);
    const req = makeReq({ user: PRINCIPAL, headerValue: 'm-other' });
    await expect(guard.canActivate(makeCtx(req))).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'MAILBOX_NOT_OWNED' }),
    });
  });

  it('falls back to single active when preference points at disconnected mailbox', async () => {
    mailboxes.listByWorkspace.mockResolvedValue([summary('m1'), summary('m2', 'disconnected')]);
    users.findById.mockResolvedValue({ preferences: { activeMailboxId: 'm2' } });
    const req = makeReq({ user: PRINCIPAL });
    await guard.canActivate(makeCtx(req));
    expect(req.mailbox).toEqual({ id: 'm1' });
  });
});
