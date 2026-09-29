import { describe, expect, it } from 'vitest';

import {
  createRequestPerformance,
  measureRequestOperation,
  withRequestPerformance,
} from './request-performance.js';

describe('sampled request performance', () => {
  it('isolates concurrent requests and preserves successful results', async () => {
    const first = createRequestPerformance('1')!;
    const second = createRequestPerformance('1')!;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = withRequestPerformance(first, () =>
      measureRequestOperation('triage.enrichment', async () => {
        await gate;
        return 42;
      }),
    );
    expect(
      await withRequestPerformance(second, () =>
        measureRequestOperation('auth.sync-state', () => 'ready'),
      ),
    ).toBe('ready');
    release();
    expect(await pending).toBe(42);
    expect(Object.keys(first.operations)).toEqual(['triage.enrichment']);
    expect(Object.keys(second.operations)).toEqual(['auth.sync-state']);
    expect(first.operations['triage.enrichment']).toMatchObject({ count: 1, failures: 0 });
    expect(first.operations['triage.enrichment']!.durationMs).toBeGreaterThan(0);
  });

  it('keeps only aggregate failure counts and rethrows the original error', async () => {
    const context = createRequestPerformance('1')!;
    const secret = new Error('private@example.test');
    await expect(
      withRequestPerformance(context, () =>
        measureRequestOperation('activity.lineages', () => {
          throw secret;
        }),
      ),
    ).rejects.toBe(secret);
    expect(context.operations['activity.lineages']).toMatchObject({ count: 1, failures: 1 });
    expect(JSON.stringify(context)).not.toContain(secret.message);
  });

  it('does not append work after the response closes', async () => {
    const context = createRequestPerformance('1')!;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = withRequestPerformance(context, () =>
      measureRequestOperation('followups.scan', () => gate),
    );
    context.closed = true;
    release();
    await pending;
    expect(context.operations).toEqual({});
  });

  it('can be disabled without changing operation behavior and handles invalid configuration', async () => {
    expect(createRequestPerformance('0', () => 0)).toBeUndefined();
    expect(createRequestPerformance('invalid', () => 0.5)).toBeUndefined();
    expect(createRequestPerformance('invalid', () => 0.01)).toBeDefined();
    expect(await measureRequestOperation('autopilot.observe', () => 7)).toBe(7);
  });
});
