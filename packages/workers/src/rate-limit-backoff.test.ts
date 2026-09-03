import { describe, expect, it } from 'vitest';

import {
  backoffJobOptions,
  perMailboxBackoff,
  perMailboxWorkerSettings,
} from './rate-limit-backoff.js';
import { RateLimitError, TransientError, AuthExpiredError } from './worker-errors.js';
import { WORKER_POLICIES } from './worker-policies.js';

const PER_MAILBOX_BACKOFF = WORKER_POLICIES.perMailboxPolicy.backoff;

/**
 * `perMailboxBackoff` (2026-09-02 incident fix).
 *
 * Negative control for the bug this closes: BullMQ's built-in
 * `exponential` strategy computes `2^(attemptsMade-1) * delayMs`
 * regardless of error type. For `perMailboxPolicy` (delayMs=2000) that is
 * 2s/4s/8s/16s — under 30s total across all 5 attempts — which is what a
 * `RateLimitError` got before this fix, guaranteeing exhaustion inside
 * Gmail's 60s quota window. These assertions fail against that old
 * behavior and pass against `perMailboxBackoff`.
 */
describe('perMailboxBackoff', () => {
  it('uses retryAfterMs for a RateLimitError that carries one', () => {
    const err = new RateLimitError('Gmail returned 429', 12_000);
    expect(perMailboxBackoff(1, 'custom', err)).toBe(12_000);
    // Same regardless of attempt number — Gmail's own header is authoritative.
    expect(perMailboxBackoff(4, 'custom', err)).toBe(12_000);
  });

  it('clamps an oversized retryAfterMs to rateLimitMaxDelayMs', () => {
    const err = new RateLimitError('Gmail returned 429', 60 * 60_000);
    expect(perMailboxBackoff(1, 'custom', err)).toBe(PER_MAILBOX_BACKOFF.rateLimitMaxDelayMs);
  });

  it('falls back to rateLimitFallbackMs when Gmail sent no Retry-After', () => {
    // The 403 "quota exceeded" shape from the incident — retryAfterMs undefined.
    const err = new RateLimitError('Gmail 403 — quota exceeded');
    expect(perMailboxBackoff(1, 'custom', err)).toBe(PER_MAILBOX_BACKOFF.rateLimitFallbackMs);
  });

  it('never returns a delay under the 60s Gmail quota window for a header-less RateLimitError', () => {
    // The exact defect: the old exponential schedule's LARGEST delay
    // (attempt 4 → 16s) is still far short of Gmail's 60s window.
    const err = new RateLimitError('Gmail 403 — quota exceeded');
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      expect(perMailboxBackoff(attempt, 'custom', err)).toBeGreaterThanOrEqual(60_000);
    }
  });

  it('treats a zero or negative retryAfterMs as absent (falls back)', () => {
    const err = new RateLimitError('Gmail returned 429', 0);
    expect(perMailboxBackoff(1, 'custom', err)).toBe(PER_MAILBOX_BACKOFF.rateLimitFallbackMs);
  });

  it('reproduces the unchanged exponential schedule for TransientError', () => {
    const delayMs = PER_MAILBOX_BACKOFF.delayMs;
    const err = new TransientError('network blip');
    expect(perMailboxBackoff(1, 'custom', err)).toBe(delayMs); // 2_000
    expect(perMailboxBackoff(2, 'custom', err)).toBe(delayMs * 2); // 4_000
    expect(perMailboxBackoff(3, 'custom', err)).toBe(delayMs * 4); // 8_000
    expect(perMailboxBackoff(4, 'custom', err)).toBe(delayMs * 8); // 16_000
  });

  it('reproduces the unchanged exponential schedule for AuthExpiredError', () => {
    expect(perMailboxBackoff(1, 'custom', new AuthExpiredError('token expired mid-job'))).toBe(
      PER_MAILBOX_BACKOFF.delayMs,
    );
  });

  it('reproduces the unchanged exponential schedule for an untyped error', () => {
    expect(perMailboxBackoff(1, 'custom', new Error('unclassified'))).toBe(
      PER_MAILBOX_BACKOFF.delayMs,
    );
  });
});

/**
 * The producer (job options) and consumer (Worker registration) sides of
 * this fix must never drift independently — see the architecture-
 * guardian review of the 2026-09-02 fix: an unpinned pairing throws
 * inside BullMQ itself if a `type: 'custom'` job reaches a Worker that
 * never registered the strategy (worse than the original incident — the
 * job never reaches `failed`, no dead-letter, no Sentry capture).
 */
describe('backoffJobOptions / perMailboxWorkerSettings pairing', () => {
  it('emits type: "custom" for perMailboxPolicy, sourced from the same policy object perMailboxBackoff reads', () => {
    expect(backoffJobOptions(WORKER_POLICIES.perMailboxPolicy.backoff)).toEqual({
      backoff: { type: 'custom' },
    });
  });

  it('registers the exact perMailboxBackoff function reference as the Worker backoffStrategy', () => {
    expect(perMailboxWorkerSettings().settings.backoffStrategy).toBe(perMailboxBackoff);
  });

  it('emits a plain exponential job option for a non-custom policy (webhookPolicy)', () => {
    expect(backoffJobOptions(WORKER_POLICIES.webhookPolicy.backoff)).toEqual({
      backoff: { type: 'exponential', delay: WORKER_POLICIES.webhookPolicy.backoff.delayMs },
    });
  });

  it('omits backoff entirely for a null policy (adminPolicy)', () => {
    expect(backoffJobOptions(WORKER_POLICIES.adminPolicy.backoff)).toEqual({});
  });
});
