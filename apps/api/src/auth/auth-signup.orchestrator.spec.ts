import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthSignupOrchestrator } from './auth-signup.orchestrator.js';
import type { DrizzleDb } from '../db/db.module.js';
import type { UsersService } from '../users/users.service.js';
import type { GmailWatchService } from '../mailboxes/gmail-watch.service.js';
import type { MailboxAccountsService } from '../mailboxes/mailbox-accounts.service.js';
import type { SyncService } from '../sync/sync.service.js';
import type { TokenCryptoService } from './token-crypto.service.js';
import type { SessionsService } from './sessions.service.js';
import type { CsrfService } from './csrf.service.js';

/**
 * AuthSignupOrchestrator.connect — identity resolution (Option 1,
 * "login follows mailbox").
 *
 * Three branches:
 *   1. email already owned by a user → reuse that workspace
 *   2. no user, but the email's mailbox lives in a workspace
 *      (connected as a secondary) → resolve into that home workspace,
 *      do NOT bootstrap a new one
 *   3. neither → bootstrap a fresh workspace + user (new signup)
 *
 * Every path sets the just-connected mailbox as the active preference.
 */
describe('AuthSignupOrchestrator.connect — identity resolution', () => {
  let users: {
    findByEmail: ReturnType<typeof vi.fn>;
    insertWorkspaceAndUser: ReturnType<typeof vi.fn>;
    patchPreferences: ReturnType<typeof vi.fn>;
  };
  let mailboxes: {
    findByProviderEmail: ReturnType<typeof vi.fn>;
    upsertConnect: ReturnType<typeof vi.fn>;
  };
  let sync: { markQueued: ReturnType<typeof vi.fn>; schedule: ReturnType<typeof vi.fn> };
  let gmailWatch: { watchMailbox: ReturnType<typeof vi.fn> };
  let tokenCrypto: { encrypt: ReturnType<typeof vi.fn> };
  let sessions: { issue: ReturnType<typeof vi.fn> };
  let csrf: { issue: ReturnType<typeof vi.fn> };
  let db: { transaction: ReturnType<typeof vi.fn>; select: ReturnType<typeof vi.fn> };
  let orchestrator: AuthSignupOrchestrator;

  beforeEach(() => {
    users = {
      findByEmail: vi.fn(),
      insertWorkspaceAndUser: vi.fn(),
      patchPreferences: vi.fn().mockResolvedValue(undefined),
    };
    mailboxes = {
      findByProviderEmail: vi.fn(),
      upsertConnect: vi.fn().mockResolvedValue({ id: 'mailbox-new' }),
    };
    sync = {
      markQueued: vi.fn().mockResolvedValue(undefined),
      schedule: vi.fn().mockResolvedValue(undefined),
    };
    gmailWatch = { watchMailbox: vi.fn().mockResolvedValue('watched') };
    tokenCrypto = {
      encrypt: vi.fn().mockResolvedValue({
        ciphertext: Buffer.from('c'),
        wrappedDek: Buffer.from('d'),
        keyVersion: 1,
      }),
    };
    sessions = {
      issue: vi.fn().mockResolvedValue({ tokens: { accessToken: 'a' }, sessionId: 's' }),
    };
    csrf = { issue: vi.fn().mockReturnValue('csrf-token') };
    // `transaction(cb)` just runs the callback with a stub tx. `select`
    // backs addMailbox's cross-workspace ownership probe — defaults to
    // "no existing row" (no conflict); individual tests override it.
    db = {
      transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb({})),
      select: vi.fn(() => ({
        from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
      })),
    };

    orchestrator = new AuthSignupOrchestrator(
      db as unknown as DrizzleDb,
      users as unknown as UsersService,
      mailboxes as unknown as MailboxAccountsService,
      sync as unknown as SyncService,
      gmailWatch as unknown as GmailWatchService,
      tokenCrypto as unknown as TokenCryptoService,
      sessions as unknown as SessionsService,
      csrf as unknown as CsrfService,
    );
  });

  const INPUT = {
    email: 'me@example.com',
    refreshToken: 'rt',
    ipAddress: null,
    userAgent: null,
  };

  it('reuses the workspace when a user already owns the email (returning primary)', async () => {
    users.findByEmail.mockResolvedValue({ userId: 'u1', workspaceId: 'w1' });

    const result = await orchestrator.connect(INPUT);

    expect(result.isNewSignup).toBe(false);
    expect(result.user).toMatchObject({ id: 'u1', workspaceId: 'w1' });
    expect(mailboxes.findByProviderEmail).not.toHaveBeenCalled();
    expect(users.insertWorkspaceAndUser).not.toHaveBeenCalled();
    expect(mailboxes.upsertConnect).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ workspaceId: 'w1', userId: 'u1' }),
    );
    // Active mailbox set to the just-connected mailbox.
    expect(users.patchPreferences).toHaveBeenCalledWith('u1', { activeMailboxId: 'mailbox-new' });
    // `users.watch` fires on connect/reconnect (D8/D225/D229).
    expect(gmailWatch.watchMailbox).toHaveBeenCalledWith('mailbox-new');
  });

  it('resolves into the home workspace when the email was connected as a secondary mailbox', async () => {
    users.findByEmail.mockResolvedValue(null);
    mailboxes.findByProviderEmail.mockResolvedValue({
      mailboxId: 'mailbox-b',
      workspaceId: 'w-home',
      userId: 'u-owner',
    });

    const result = await orchestrator.connect(INPUT);

    expect(result.isNewSignup).toBe(false);
    expect(result.user).toMatchObject({ id: 'u-owner', workspaceId: 'w-home' });
    // Must NOT bootstrap an orphan workspace.
    expect(users.insertWorkspaceAndUser).not.toHaveBeenCalled();
    expect(mailboxes.upsertConnect).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ workspaceId: 'w-home', userId: 'u-owner' }),
    );
    expect(sessions.issue).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u-owner', workspaceId: 'w-home' }),
    );
    expect(users.patchPreferences).toHaveBeenCalledWith('u-owner', {
      activeMailboxId: 'mailbox-new',
    });
  });

  it('bootstraps a fresh workspace + user for a brand-new email', async () => {
    users.findByEmail.mockResolvedValue(null);
    mailboxes.findByProviderEmail.mockResolvedValue(null);
    users.insertWorkspaceAndUser.mockResolvedValue({ userId: 'u-new', workspaceId: 'w-new' });

    const result = await orchestrator.connect(INPUT);

    expect(result.isNewSignup).toBe(true);
    expect(result.user).toMatchObject({ id: 'u-new', workspaceId: 'w-new' });
    expect(users.insertWorkspaceAndUser).toHaveBeenCalled();
    expect(mailboxes.upsertConnect).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ workspaceId: 'w-new', userId: 'u-new' }),
    );
  });

  describe('addMailbox — connect a secondary mailbox to the current workspace', () => {
    const ADD_INPUT = {
      currentUserId: 'u-owner',
      currentWorkspaceId: 'w-home',
      email: 'second@example.com',
      refreshToken: 'rt2',
    };

    it('sets the just-connected mailbox active so reads stop 409ing SELECT_MAILBOX', async () => {
      const result = await orchestrator.addMailbox(ADD_INPUT);

      expect(result).toEqual({ mailboxId: 'mailbox-new' });
      expect(mailboxes.upsertConnect).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ workspaceId: 'w-home', userId: 'u-owner' }),
      );
      expect(sync.markQueued).toHaveBeenCalledWith(expect.anything(), 'mailbox-new');
      // force-replace any stale pre-reconnect job (fresh token just stored).
      expect(sync.schedule).toHaveBeenCalledWith('mailbox-new', { force: true });
      // The keystone fix: the new mailbox becomes the active preference,
      // mirroring `connect`. Without it a second active mailbox with no
      // preference makes CurrentMailboxGuard throw 409 SELECT_MAILBOX on
      // every read.
      expect(users.patchPreferences).toHaveBeenCalledWith('u-owner', {
        activeMailboxId: 'mailbox-new',
      });
      // `users.watch` fires for the added mailbox too (D8/D225/D229).
      expect(gmailWatch.watchMailbox).toHaveBeenCalledWith('mailbox-new');
    });

    it('rejects a Gmail already owned by a different workspace without touching preferences', async () => {
      db.select.mockReturnValueOnce({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([{ id: 'mailbox-x', workspaceId: 'w-other' }]),
          }),
        }),
      });

      await expect(orchestrator.addMailbox(ADD_INPUT)).rejects.toThrow();
      expect(mailboxes.upsertConnect).not.toHaveBeenCalled();
      expect(users.patchPreferences).not.toHaveBeenCalled();
    });
  });
});
