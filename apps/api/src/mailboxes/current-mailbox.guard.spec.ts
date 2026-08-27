import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MailboxAccountsService } from './mailbox-accounts.service.js';
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

describe('CurrentMailboxGuard (D155 + D205)', () => {
  let mailboxes: {
    resolveActiveForRequest: ReturnType<typeof vi.fn>;
  };
  let guard: CurrentMailboxGuard;

  beforeEach(() => {
    mailboxes = { resolveActiveForRequest: vi.fn() };
    guard = new CurrentMailboxGuard(mailboxes as unknown as MailboxAccountsService);
  });

  it('throws when JwtGuard did not run first', async () => {
    const req = makeReq({ user: undefined });
    await expect(guard.canActivate(makeCtx(req))).rejects.toThrow(UnauthorizedException);
  });

  it('throws NO_ACTIVE_MAILBOX when no active mailboxes exist', async () => {
    mailboxes.resolveActiveForRequest.mockResolvedValue({ kind: 'none-active' });
    const req = makeReq({ user: PRINCIPAL });
    await expect(guard.canActivate(makeCtx(req))).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'NO_ACTIVE_MAILBOX' }),
    });
  });

  it('uses single active mailbox when no preference set', async () => {
    mailboxes.resolveActiveForRequest.mockResolvedValue({ kind: 'resolved', id: 'm1' });
    const req = makeReq({ user: PRINCIPAL });
    const ok = await guard.canActivate(makeCtx(req));
    expect(ok).toBe(true);
    expect(req.mailbox).toEqual({ id: 'm1' });
  });

  it('resolves the first active mailbox when multiple active + no preference (matches /me, no 409)', async () => {
    // Regression: this used to throw 409 SELECT_MAILBOX while /me resolved
    // first-active, producing a rendered-but-409ing dashboard (founder
    // break-test 2026-05-28). Guard now agrees with /me: first active wins.
    mailboxes.resolveActiveForRequest.mockResolvedValue({ kind: 'resolved', id: 'm1' });
    const req = makeReq({ user: PRINCIPAL });
    const ok = await guard.canActivate(makeCtx(req));
    expect(ok).toBe(true);
    expect(req.mailbox).toEqual({ id: 'm1' });
  });

  it('honours user preference activeMailboxId', async () => {
    mailboxes.resolveActiveForRequest.mockResolvedValue({ kind: 'resolved', id: 'm2' });
    const req = makeReq({ user: PRINCIPAL });
    await guard.canActivate(makeCtx(req));
    expect(req.mailbox).toEqual({ id: 'm2' });
  });

  it('honours X-Active-Mailbox-Id header override', async () => {
    mailboxes.resolveActiveForRequest.mockResolvedValue({ kind: 'resolved', id: 'm2' });
    const req = makeReq({ user: PRINCIPAL, headerValue: 'm2' });
    await guard.canActivate(makeCtx(req));
    expect(req.mailbox).toEqual({ id: 'm2' });
    expect(mailboxes.resolveActiveForRequest).toHaveBeenCalledWith({
      workspaceId: PRINCIPAL.workspaceId,
      userId: PRINCIPAL.userId,
      requestedMailboxId: 'm2',
    });
  });

  it('rejects header pointing at unowned mailbox', async () => {
    mailboxes.resolveActiveForRequest.mockResolvedValue({ kind: 'not-owned' });
    const req = makeReq({ user: PRINCIPAL, headerValue: 'm-other' });
    await expect(guard.canActivate(makeCtx(req))).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'MAILBOX_NOT_OWNED' }),
    });
  });

  it('reports NO_ACTIVE_MAILBOX for a stale header when nothing is active', async () => {
    // Disconnecting the last mailbox in another tab leaves this tab's
    // cached `X-Active-Mailbox-Id` on the next request. The user needs the
    // reconnect gate; answering MAILBOX_NOT_OWNED sends them to the wrong
    // screen. Collapsing both service outcomes to `null` made the header's
    // mere PRESENCE decide the code, which is why this is asserted here.
    mailboxes.resolveActiveForRequest.mockResolvedValue({ kind: 'none-active' });
    const req = makeReq({ user: PRINCIPAL, headerValue: 'm-stale' });
    await expect(guard.canActivate(makeCtx(req))).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'NO_ACTIVE_MAILBOX' }),
    });
  });

  it('falls back to single active when preference points at disconnected mailbox', async () => {
    mailboxes.resolveActiveForRequest.mockResolvedValue({ kind: 'resolved', id: 'm1' });
    const req = makeReq({ user: PRINCIPAL });
    await guard.canActivate(makeCtx(req));
    expect(req.mailbox).toEqual({ id: 'm1' });
  });
});
