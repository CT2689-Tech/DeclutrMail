import { readFileSync } from 'node:fs';

import { mailboxAccounts, providerSyncState, users, workspaces } from '@declutrmail/db';
import { freshTestDb } from '@declutrmail/db/testing';
import { describe, expect, it, vi } from 'vitest';

import { assertLocalOpsDsn } from '../../../../scripts/local-dsn';
import { parseRequeueArgs, runRequeue } from './requeue-scan-core.js';
import { stuckScansSql } from '../../../../scripts/stuck-scans-report';

describe('stuck initial scans', () => {
  it('lists failed initial scans without an email address', async () => {
    const db = await freshTestDb();
    const [ws] = await db
      .insert(workspaces)
      .values({ name: 'stuck' })
      .returning({ id: workspaces.id });
    const [user] = await db
      .insert(users)
      .values({ workspaceId: ws!.id, email: 'owner@example.com' })
      .returning({ id: users.id });
    const [mailbox] = await db
      .insert(mailboxAccounts)
      .values({
        workspaceId: ws!.id,
        userId: user!.id,
        provider: 'gmail',
        providerAccountId: 'owner@example.com',
      })
      .returning({ id: mailboxAccounts.id });
    await db.insert(providerSyncState).values({
      mailboxAccountId: mailbox!.id,
      readinessStatus: 'failed',
      currentStage: 'failed',
      errorCode: 'RateLimitError',
      initialRecoveryAttempts: 3,
      initialRetryAt: new Date('2026-08-26T00:00:00.000Z'),
    });
    const readyMailbox = await db
      .insert(mailboxAccounts)
      .values({
        workspaceId: ws!.id,
        userId: user!.id,
        provider: 'gmail',
        providerAccountId: 'other@example.com',
      })
      .returning({ id: mailboxAccounts.id });
    await db.insert(providerSyncState).values({
      mailboxAccountId: readyMailbox[0]!.id,
      readinessStatus: 'ready',
      currentStage: 'ready',
      errorCode: 'TransientError',
    });

    const result = await db.execute(stuckScansSql());
    const rows = Array.isArray(result) ? result : (result as { rows: unknown[] }).rows;
    expect(rows).toHaveLength(1);
    const row = rows[0] as Record<string, unknown>;
    expect(JSON.stringify(row)).not.toContain('@');
    expect(row.mailbox_account_id).toBe(mailbox!.id);
    expect(row.error_class).toBe('RateLimitError');
    expect(Number(row.recovery_attempts)).toBe(3);
    expect(row.owner_onboarded).toBe(false);
    expect(row.next_deadline).toBeTruthy();
  });

  it('refuses a remote database', () => {
    expect(() =>
      assertLocalOpsDsn('postgresql://db.supabase.co/postgres', 'stuck-scans-report'),
    ).toThrow(/refuses non-local/);
  });
});

describe('requeue-scan', () => {
  const mailboxId = '11111111-1111-4111-8111-111111111111';

  function deps(errorClass: string | null) {
    return {
      load: vi.fn().mockResolvedValue({ mailboxId, errorClass }),
      retry: vi.fn().mockResolvedValue('requeued'),
      audit: vi.fn().mockResolvedValue(undefined),
      write: vi.fn(),
    };
  }

  it('refuses to run without --confirm and writes nothing', async () => {
    expect(() => parseRequeueArgs(['--mailbox', mailboxId])).not.toThrow();
    const calls = deps('RateLimitError');
    const code = await runRequeue({ mailboxId, confirm: false }, calls);
    expect(code).toBe(0);
    expect(calls.retry).not.toHaveBeenCalled();
    expect(calls.audit).not.toHaveBeenCalled();
  });

  it('refuses an invalid grant before the recovery call', async () => {
    const calls = deps('InvalidGrantError');
    const code = await runRequeue({ mailboxId, confirm: true }, calls);
    expect(code).toBe(2);
    expect(calls.retry).not.toHaveBeenCalled();
    expect(calls.audit).not.toHaveBeenCalled();
  });

  it('writes an audit row only after a confirmed requeue', async () => {
    const calls = deps('RateLimitError');
    const code = await runRequeue({ mailboxId, confirm: true }, calls);
    expect(code).toBe(0);
    expect(calls.retry).toHaveBeenCalledWith(mailboxId);
    expect(calls.audit).toHaveBeenCalledWith({
      mailboxId,
      errorClass: 'RateLimitError',
      outcome: 'requeued',
    });
    expect(JSON.stringify(calls.audit.mock.calls)).not.toContain('@');
  });

  it('goes through retryFailedInitialSync in the CLI', () => {
    const source = readFileSync(
      new URL('../../../../scripts/requeue-scan.ts', import.meta.url),
      'utf8',
    );
    expect(source).toContain('retryFailedInitialSync');
    expect(source).toContain('sync.manual_requeue');
  });
});
