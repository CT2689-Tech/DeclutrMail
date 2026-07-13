import { ConflictException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthSignupOrchestrator } from './auth-signup.orchestrator.js';
import { BetaGateDeniedError } from './beta-gate.js';
import type { DrizzleDb } from '../db/db.module.js';
import type { UsersService } from '../users/users.service.js';
import type { GmailWatchService } from '../mailboxes/gmail-watch.service.js';
import type { MailboxAccountsService } from '../mailboxes/mailbox-accounts.service.js';
import type { SyncService } from '../sync/sync.service.js';
import type { TokenCryptoService } from './token-crypto.service.js';
import type { SessionsService } from './sessions.service.js';
import type { CsrfService } from './csrf.service.js';
import type { EntitlementsService } from '../common/entitlements/entitlements.service.js';
import { EmailRaceLostError } from '../users/users.service.js';

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
  let entitlements: { assertCanConnectMailbox: ReturnType<typeof vi.fn> };
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
    entitlements = { assertCanConnectMailbox: vi.fn().mockResolvedValue(undefined) };
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
      entitlements as unknown as EntitlementsService,
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
    expect(sync.markQueued).toHaveBeenCalledWith(expect.anything(), 'mailbox-new', {
      freshCredentials: true,
    });
    // Active mailbox set to the just-connected mailbox.
    expect(users.patchPreferences).toHaveBeenCalledWith('u1', { activeMailboxId: 'mailbox-new' });
    // `users.watch` fires on connect/reconnect (D8/D225/D229).
    expect(gmailWatch.watchMailbox).toHaveBeenCalledWith('mailbox-new');
  });

  it('canonicalizes the Gmail identity before any connect lookup or persistence', async () => {
    users.findByEmail.mockResolvedValue({ userId: 'u1', workspaceId: 'w1' });

    const result = await orchestrator.connect({
      ...INPUT,
      email: '  Me@Example.COM  ',
    });

    expect(users.findByEmail).toHaveBeenCalledWith('me@example.com');
    expect(mailboxes.upsertConnect).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ email: 'me@example.com' }),
    );
    expect(result.user.email).toBe('me@example.com');
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

  it('rolls back a losing bootstrap with its mailbox write and follows the provider winner', async () => {
    const bootstrapTx = { name: 'bootstrap-tx' };
    const winnerTx = { name: 'winner-tx' };
    users.findByEmail.mockResolvedValue(null);
    mailboxes.findByProviderEmail.mockResolvedValueOnce(null).mockResolvedValueOnce({
      mailboxId: 'mailbox-winner',
      workspaceId: 'w-winner',
      userId: 'u-winner',
    });
    users.insertWorkspaceAndUser.mockResolvedValue({
      userId: 'u-provisional',
      workspaceId: 'w-provisional',
    });
    db.transaction
      .mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(bootstrapTx))
      .mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(winnerTx));
    mailboxes.upsertConnect
      .mockRejectedValueOnce(new ConflictException({ code: 'MAILBOX_OWNED_BY_OTHER_WORKSPACE' }))
      .mockResolvedValueOnce({ id: 'mailbox-winner' });

    const result = await orchestrator.connect(INPUT);

    // The provisional workspace/user and its mailbox attempt share one
    // transaction. A provider-identity loss therefore rolls all three
    // records back instead of committing an orphan login workspace.
    expect(users.insertWorkspaceAndUser).toHaveBeenCalledWith(bootstrapTx, INPUT.email);
    expect(mailboxes.upsertConnect).toHaveBeenNthCalledWith(
      1,
      bootstrapTx,
      expect.objectContaining({
        workspaceId: 'w-provisional',
        userId: 'u-provisional',
      }),
    );
    expect(mailboxes.upsertConnect).toHaveBeenNthCalledWith(
      2,
      winnerTx,
      expect.objectContaining({ workspaceId: 'w-winner', userId: 'u-winner' }),
    );
    expect(result).toMatchObject({
      isNewSignup: false,
      user: { id: 'u-winner', workspaceId: 'w-winner' },
      mailbox: { id: 'mailbox-winner' },
    });
    expect(users.patchPreferences).toHaveBeenCalledWith('u-winner', {
      activeMailboxId: 'mailbox-winner',
    });
    expect(sessions.issue).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u-winner', workspaceId: 'w-winner' }),
    );
  });

  it('keeps users.email race recovery atomic and persists into the winning signup', async () => {
    const losingTx = { name: 'losing-user-tx' };
    const winnerTx = { name: 'winning-user-tx' };
    users.findByEmail.mockResolvedValueOnce(null);
    mailboxes.findByProviderEmail.mockResolvedValueOnce(null).mockResolvedValueOnce({
      mailboxId: 'mailbox-winner',
      workspaceId: 'w-winner',
      userId: 'u-winner',
    });
    users.insertWorkspaceAndUser.mockRejectedValueOnce(new EmailRaceLostError());
    db.transaction
      .mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(losingTx))
      .mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(winnerTx));

    const result = await orchestrator.connect(INPUT);

    expect(users.insertWorkspaceAndUser).toHaveBeenCalledWith(losingTx, INPUT.email);
    expect(mailboxes.upsertConnect).toHaveBeenCalledWith(
      winnerTx,
      expect.objectContaining({ workspaceId: 'w-winner', userId: 'u-winner' }),
    );
    expect(result).toMatchObject({
      isNewSignup: true,
      user: { id: 'u-winner', workspaceId: 'w-winner' },
    });
  });

  it('recovers a historical orphan user by following the provider-owned workspace on login', async () => {
    users.findByEmail.mockResolvedValue({ userId: 'u-orphan', workspaceId: 'w-orphan' });
    mailboxes.findByProviderEmail.mockResolvedValue({
      mailboxId: 'mailbox-winner',
      workspaceId: 'w-winner',
      userId: 'u-winner',
    });
    mailboxes.upsertConnect
      .mockRejectedValueOnce(new ConflictException({ code: 'MAILBOX_OWNED_BY_OTHER_WORKSPACE' }))
      .mockResolvedValueOnce({ id: 'mailbox-winner' });

    const result = await orchestrator.connect(INPUT);

    expect(mailboxes.findByProviderEmail).toHaveBeenCalledWith(INPUT.email);
    expect(mailboxes.upsertConnect).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ workspaceId: 'w-winner', userId: 'u-winner' }),
    );
    expect(result).toMatchObject({
      isNewSignup: false,
      user: { id: 'u-winner', workspaceId: 'w-winner' },
    });
    expect(sessions.issue).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u-winner', workspaceId: 'w-winner' }),
    );
  });

  describe('private-beta invite gate (F7)', () => {
    const ORIGINAL_ENV = { ...process.env };

    afterEach(() => {
      process.env = { ...ORIGINAL_ENV };
    });

    it('denies a brand-new uninvited signup with ZERO side effects', async () => {
      process.env.BETA_GATE_ENABLED = 'true';
      process.env.BETA_INVITE_EMAILS = 'someone-else@example.com';
      users.findByEmail.mockResolvedValue(null);
      mailboxes.findByProviderEmail.mockResolvedValue(null);

      await expect(orchestrator.connect(INPUT)).rejects.toBeInstanceOf(BetaGateDeniedError);

      // The deny fires BEFORE any write: no user/workspace bootstrap,
      // no token encryption, no mailbox row, no sync, no session.
      expect(users.insertWorkspaceAndUser).not.toHaveBeenCalled();
      expect(tokenCrypto.encrypt).not.toHaveBeenCalled();
      expect(mailboxes.upsertConnect).not.toHaveBeenCalled();
      expect(sync.schedule).not.toHaveBeenCalled();
      expect(sessions.issue).not.toHaveBeenCalled();
      expect(users.patchPreferences).not.toHaveBeenCalled();
    });

    it('lets an EXISTING user log in with the gate enabled and an empty invite list', async () => {
      process.env.BETA_GATE_ENABLED = 'true';
      process.env.BETA_INVITE_EMAILS = '';
      users.findByEmail.mockResolvedValue({ userId: 'u1', workspaceId: 'w1' });

      const result = await orchestrator.connect(INPUT);

      expect(result.isNewSignup).toBe(false);
      expect(sessions.issue).toHaveBeenCalled();
    });

    it('lets a secondary-mailbox email resolve into its home workspace with the gate enabled', async () => {
      process.env.BETA_GATE_ENABLED = 'true';
      process.env.BETA_INVITE_EMAILS = '';
      users.findByEmail.mockResolvedValue(null);
      mailboxes.findByProviderEmail.mockResolvedValue({
        mailboxId: 'mailbox-b',
        workspaceId: 'w-home',
        userId: 'u-owner',
      });

      const result = await orchestrator.connect(INPUT);

      expect(result.isNewSignup).toBe(false);
      expect(result.user).toMatchObject({ id: 'u-owner', workspaceId: 'w-home' });
    });

    it('bootstraps an INVITED new signup (case-insensitive match)', async () => {
      process.env.BETA_GATE_ENABLED = 'true';
      process.env.BETA_INVITE_EMAILS = 'ME@Example.com';
      users.findByEmail.mockResolvedValue(null);
      mailboxes.findByProviderEmail.mockResolvedValue(null);
      users.insertWorkspaceAndUser.mockResolvedValue({ userId: 'u-new', workspaceId: 'w-new' });

      const result = await orchestrator.connect(INPUT);

      expect(result.isNewSignup).toBe(true);
      expect(users.insertWorkspaceAndUser).toHaveBeenCalled();
    });

    it('is a no-op with BETA_GATE_ENABLED unset (default open signup)', async () => {
      delete process.env.BETA_GATE_ENABLED;
      delete process.env.BETA_INVITE_EMAILS;
      users.findByEmail.mockResolvedValue(null);
      mailboxes.findByProviderEmail.mockResolvedValue(null);
      users.insertWorkspaceAndUser.mockResolvedValue({ userId: 'u-new', workspaceId: 'w-new' });

      const result = await orchestrator.connect(INPUT);

      expect(result.isNewSignup).toBe(true);
    });
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
      expect(sync.markQueued).toHaveBeenCalledWith(expect.anything(), 'mailbox-new', {
        freshCredentials: true,
      });
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

    it('canonicalizes the Gmail identity before add-mailbox lookup and persistence', async () => {
      await orchestrator.addMailbox({ ...ADD_INPUT, email: '  Second@Example.COM  ' });

      expect(mailboxes.upsertConnect).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ email: 'second@example.com' }),
      );
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

    it('enforces the inbox limit at the activation boundary for a NEW connection', async () => {
      // Default select → no existing row → a brand-new account that
      // transitions a row to active, so the limit MUST be checked.
      await orchestrator.addMailbox(ADD_INPUT);
      expect(entitlements.assertCanConnectMailbox).toHaveBeenCalledWith('w-home');
    });

    it('402s at the limit — no token encryption, no upsert, no preference write', async () => {
      entitlements.assertCanConnectMailbox.mockRejectedValueOnce(new Error('INBOX_LIMIT_REACHED'));
      await expect(orchestrator.addMailbox(ADD_INPUT)).rejects.toThrow('INBOX_LIMIT_REACHED');
      expect(tokenCrypto.encrypt).not.toHaveBeenCalled();
      expect(mailboxes.upsertConnect).not.toHaveBeenCalled();
      expect(users.patchPreferences).not.toHaveBeenCalled();
    });

    it('skips the limit check for an already-active reconnect (no new slot consumed)', async () => {
      db.select.mockReturnValueOnce({
        from: () => ({
          where: () => ({
            limit: () =>
              Promise.resolve([{ id: 'mailbox-b', workspaceId: 'w-home', status: 'active' }]),
          }),
        }),
      });
      const result = await orchestrator.addMailbox(ADD_INPUT);
      expect(result).toEqual({ mailboxId: 'mailbox-new' });
      expect(entitlements.assertCanConnectMailbox).not.toHaveBeenCalled();
      expect(mailboxes.upsertConnect).toHaveBeenCalled();
    });

    it('enforces the activation-boundary limit for an existing disconnected row', async () => {
      db.select.mockReturnValueOnce({
        from: () => ({
          where: () => ({
            limit: () =>
              Promise.resolve([{ id: 'mailbox-b', workspaceId: 'w-home', status: 'disconnected' }]),
          }),
        }),
      });

      await orchestrator.addMailbox(ADD_INPUT);

      expect(entitlements.assertCanConnectMailbox).toHaveBeenCalledWith('w-home');
      expect(mailboxes.upsertConnect).toHaveBeenCalled();
    });

    it('does not reactivate a disconnected row after the activation-boundary limit fails', async () => {
      db.select.mockReturnValueOnce({
        from: () => ({
          where: () => ({
            limit: () =>
              Promise.resolve([{ id: 'mailbox-b', workspaceId: 'w-home', status: 'disconnected' }]),
          }),
        }),
      });
      entitlements.assertCanConnectMailbox.mockRejectedValueOnce(new Error('INBOX_LIMIT_REACHED'));

      await expect(orchestrator.addMailbox(ADD_INPUT)).rejects.toThrow('INBOX_LIMIT_REACHED');

      expect(tokenCrypto.encrypt).not.toHaveBeenCalled();
      expect(mailboxes.upsertConnect).not.toHaveBeenCalled();
      expect(users.patchPreferences).not.toHaveBeenCalled();
    });
  });
});
