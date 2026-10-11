/**
 * Decision function for one manual initial-scan recovery.
 * The CLI in requeue-scan.ts calls SyncService.retryFailedInitialSync.
 */
import { AUTH_RECOVERY_ERROR_CODES } from '@declutrmail/shared/contracts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type RequeueOutcome = 'requeued' | 'already_running' | 'not_failed' | 'no_state';

export interface StuckScanRow {
  mailboxId: string;
  errorClass: string | null;
}

export interface RequeueDeps {
  load(mailboxId: string): Promise<StuckScanRow | null>;
  retry(mailboxId: string): Promise<RequeueOutcome>;
  audit(input: {
    mailboxId: string;
    errorClass: string | null;
    outcome: 'requeued';
  }): Promise<void>;
  write(line: string): void;
}

export function parseRequeueArgs(argv: readonly string[]): { mailboxId: string; confirm: boolean } {
  let mailboxId = '';
  let confirm = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--confirm') confirm = true;
    else if (arg === '--mailbox') {
      mailboxId = argv[i + 1] ?? '';
      i += 1;
    }
  }
  if (!UUID.test(mailboxId)) throw new Error('requeue-scan: --mailbox must be a uuid');
  return { mailboxId, confirm };
}

export function refusesAuthRecovery(errorClass: string | null): boolean {
  return errorClass !== null && AUTH_RECOVERY_ERROR_CODES.has(errorClass);
}

/**
 * Dry-run prints the row and returns 0 without calling retry or audit.
 * Auth-recovery errors return 2 and do not call retry.
 * An audit row is written only after confirm and outcome requeued.
 */
export async function runRequeue(
  args: { mailboxId: string; confirm: boolean },
  deps: RequeueDeps,
): Promise<number> {
  const row = await deps.load(args.mailboxId);
  if (!row) {
    deps.write(`requeue-scan: no sync state for ${args.mailboxId}`);
    return 1;
  }
  if (!args.confirm) {
    deps.write(
      `dry-run ${row.mailboxId} error=${row.errorClass ?? 'none'} (pass --confirm to requeue)`,
    );
    return 0;
  }
  if (refusesAuthRecovery(row.errorClass)) {
    deps.write(`requeue-scan: refusing ${row.errorClass} for ${row.mailboxId}`);
    return 2;
  }
  const outcome = await deps.retry(args.mailboxId);
  if (outcome === 'requeued') {
    await deps.audit({ mailboxId: row.mailboxId, errorClass: row.errorClass, outcome });
  }
  deps.write(`requeue-scan: ${row.mailboxId} ${outcome}`);
  return outcome === 'requeued' ? 0 : 1;
}
