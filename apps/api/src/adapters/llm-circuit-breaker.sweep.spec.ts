import Anthropic from '@anthropic-ai/sdk';
import { mailboxAccounts, senders, users, workspaces } from '@declutrmail/db';
import { freshTestDb } from '@declutrmail/db/testing';
import { ScoreWorker, type ScoreWorkerDeps } from '@declutrmail/workers';
import { describe, expect, it, vi } from 'vitest';

import { AnthropicHaikuAdapter } from './anthropic-haiku.adapter.js';
import { LlmCircuitBreaker } from './llm-circuit-breaker.js';

/**
 * The breaker as a score sweep actually drives it: the real adapter, the
 * real ScoreWorker with four explain() calls in flight, a PGlite database.
 *
 * Found by smoke, not by the unit tests: with a single exclusive probe
 * after the cool-down, every sender queued behind that one in-flight
 * probe read "blocked" and finished instantly, so the first sweep after
 * credits came back wrote 1 LLM reason and 199 templates.
 */

async function seedMailbox(
  count: number,
): Promise<{ db: ScoreWorkerDeps['db']; mailboxAccountId: string }> {
  const db = (await freshTestDb()) as unknown as ScoreWorkerDeps['db'];
  const [ws] = await db
    .insert(workspaces)
    .values({ name: 'Sweep' })
    .returning({ id: workspaces.id });
  const [user] = await db
    .insert(users)
    .values({ workspaceId: ws!.id, email: 'sweep@example.com' })
    .returning({ id: users.id });
  const [mb] = await db
    .insert(mailboxAccounts)
    .values({
      workspaceId: ws!.id,
      userId: user!.id,
      provider: 'gmail',
      providerAccountId: 'sweep@example.com',
    })
    .returning({ id: mailboxAccounts.id });
  await db.insert(senders).values(
    Array.from({ length: count }, (_, i) => ({
      mailboxAccountId: mb!.id,
      senderKey: `sender-${i}`,
      displayName: `Sender ${i}`,
      email: `s${i}@sweep.example`,
      domain: 'sweep.example',
      gmailCategory: 'promotions' as const,
      firstSeenAt: new Date('2024-01-01T00:00:00Z'),
      lastSeenAt: new Date('2026-09-20T00:00:00Z'),
    })),
  );
  return { db, mailboxAccountId: mb!.id };
}

const creditBalance = () =>
  Anthropic.APIError.generate(
    400,
    {
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message: 'Your credit balance is too low to access the Anthropic API',
      },
      request_id: 'req_sweep',
    },
    undefined,
    new Headers({ 'request-id': 'req_sweep' }),
  );

describe('LlmCircuitBreaker under a real score sweep', () => {
  it('after the cool-down, the next sweep gets LLM prose again — not one probe and templates', async () => {
    const { db, mailboxAccountId } = await seedMailbox(20);
    let now = Date.parse('2026-09-24T08:15:00Z');
    const breaker = new LlmCircuitBreaker({ cooldownMs: 60_000, now: () => now });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      breaker.recordFailure(creditBalance(), { adapter: 'test', model: 'test' });
    } finally {
      errorSpy.mockRestore();
    }
    now += 60_000; // credits restored; the pause has run out

    // A real call takes time, so the other three sit behind it.
    const create = vi.fn(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                stop_reason: 'end_turn',
                content: [{ type: 'text', text: 'Rarely marked read, so archiving fits.' }],
              }),
            15,
          ),
        ),
    );
    const llm = new AnthropicHaikuAdapter({
      client: { messages: { create } } as unknown as Anthropic,
      breaker,
    });
    const worker = new ScoreWorker({
      db,
      llm,
      now: () => new Date(now),
      reasoningConcurrency: 4,
      explainTimeoutMs: 10_000,
    });

    const result = await worker.processJob(
      { mailboxAccountId, trigger: 'sync_complete', producedAtMs: now },
      {
        jobId: 'sweep',
        workerName: 'ScoreWorker',
        attempt: 1,
        maxAttempts: 5,
        startedAt: new Date(),
        policy: 'perMailboxPolicy',
      },
    );

    expect(result).toMatchObject({ llmExplanations: 20, llmBlocked: 0, templateExplanations: 0 });
    expect(create).toHaveBeenCalledTimes(20);
  });
});
