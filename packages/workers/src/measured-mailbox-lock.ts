import type { MailboxActionLock } from './label-action.worker.js';
/** Low-volume timings, no mailbox identifier. Includes pool reservation in lock wait. */
export function measuredMailboxLock(
  lock: MailboxActionLock,
  emit: (values: { lockWaitMs: number; lockHoldMs: number }) => void,
): MailboxActionLock {
  return {
    async run<T>(mailboxId: string, fn: () => Promise<T>): Promise<T> {
      const started = Date.now();
      let entered: number | undefined;
      let finished: number | undefined;
      try {
        return await lock.run(mailboxId, async () => {
          entered = Date.now();
          try {
            return await fn();
          } finally {
            finished = Date.now();
          }
        });
      } finally {
        const lockWaitMs = (entered ?? Date.now()) - started;
        const lockHoldMs = entered === undefined ? 0 : (finished ?? Date.now()) - entered;
        if (lockWaitMs >= 1000 || lockHoldMs >= 1000) {
          try {
            emit({ lockWaitMs, lockHoldMs });
          } catch {
            /* telemetry cannot change job outcome */
          }
        }
      }
    },
  };
}
