import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessionPrincipal } from '../../auth/sessions.service.js';
import { AppException } from '../app-exception.js';
import type { EntitlementsService } from './entitlements.service.js';
import { InboxLimitGuard } from './inbox-limit.guard.js';

const PRINCIPAL: SessionPrincipal = {
  userId: 'user-1',
  workspaceId: 'workspace-1',
  sessionId: 'session-1',
  jti: 'jti-1',
};

function contextFor(input: {
  user?: SessionPrincipal;
  query?: Record<string, unknown>;
}): ExecutionContext {
  const req = { user: input.user, query: input.query ?? {} };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('InboxLimitGuard — connect versus targeted reconnect', () => {
  let assertCanConnectMailbox: ReturnType<typeof vi.fn>;
  let guard: InboxLimitGuard;

  beforeEach(() => {
    assertCanConnectMailbox = vi.fn();
    guard = new InboxLimitGuard({ assertCanConnectMailbox } as unknown as EntitlementsService);
  });

  it('keeps a normal at-limit connect behind the canonical 402 fast-fail', async () => {
    const atLimit = new AppException({ code: 'INBOX_LIMIT_REACHED' });
    assertCanConnectMailbox.mockRejectedValueOnce(atLimit);

    await expect(guard.canActivate(contextFor({ user: PRINCIPAL }))).rejects.toBe(atLimit);
    expect(atLimit.getStatus()).toBe(402);
    expect(atLimit.code).toBe('INBOX_LIMIT_REACHED');
    expect(assertCanConnectMailbox).toHaveBeenCalledWith(PRINCIPAL.workspaceId);
  });

  it('defers a non-empty targeted reconnect so the controller can validate it', async () => {
    const allowed = await guard.canActivate(
      contextFor({
        user: PRINCIPAL,
        query: { reconnectMailboxId: '11111111-1111-4111-8111-111111111111' },
      }),
    );

    expect(allowed).toBe(true);
    expect(assertCanConnectMailbox).not.toHaveBeenCalled();
  });

  it('does not let an empty reconnect hint bypass the normal limit check', async () => {
    await guard.canActivate(contextFor({ user: PRINCIPAL, query: { reconnectMailboxId: '   ' } }));

    expect(assertCanConnectMailbox).toHaveBeenCalledWith(PRINCIPAL.workspaceId);
  });

  it('keeps a disconnected-row reactivation behind the normal limit check', async () => {
    const atLimit = new AppException({ code: 'INBOX_LIMIT_REACHED' });
    assertCanConnectMailbox.mockRejectedValueOnce(atLimit);

    await expect(
      guard.canActivate(
        contextFor({
          user: PRINCIPAL,
          query: { reactivateMailboxId: '22222222-2222-4222-8222-222222222222' },
        }),
      ),
    ).rejects.toBe(atLimit);

    expect(assertCanConnectMailbox).toHaveBeenCalledWith(PRINCIPAL.workspaceId);
  });

  it('still requires JwtGuard to have populated the principal first', async () => {
    await expect(guard.canActivate(contextFor({}))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(assertCanConnectMailbox).not.toHaveBeenCalled();
  });
});
