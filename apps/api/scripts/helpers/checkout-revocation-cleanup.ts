import type {
  PaddleAdapter,
  SandboxCheckoutFacts,
  SandboxCheckoutIdentity,
} from '../../src/billing/paddle.adapter.js';

export type CleanupAttempt = SandboxCheckoutIdentity & {
  attempted: boolean;
  bound?: string;
  createdAt: string;
  legacy: boolean;
};
/** Unknown creates never disappear into a vacuously successful empty scan. */
export async function collectSandboxAttemptCleanup(
  attempts: CleanupAttempt[],
  adapter: Pick<PaddleAdapter, 'readSandboxCheckout' | 'recoverSandboxCheckout'>,
): Promise<{
  complete: boolean;
  records: Array<{ identity: SandboxCheckoutIdentity; facts: SandboxCheckoutFacts }>;
}> {
  let complete = true;
  const records: Array<{ identity: SandboxCheckoutIdentity; facts: SandboxCheckoutFacts }> = [];
  for (const attempt of attempts) {
    if (!attempt.attempted || attempt.legacy) continue;
    try {
      const facts = attempt.bound
        ? await adapter.readSandboxCheckout(attempt, attempt.bound)
        : await adapter.recoverSandboxCheckout(attempt, attempt.createdAt);
      records.push({ identity: attempt, facts });
    } catch {
      complete = false;
    }
  }
  return { complete, records };
}
