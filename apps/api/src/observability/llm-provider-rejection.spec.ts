import { afterEach, describe, expect, it, vi } from 'vitest';

import { captureLlmProviderRejection } from './llm-provider-rejection.js';

const sentryHarness = vi.hoisted(() => ({
  messages: [] as string[],
  tags: [] as Array<Record<string, string>>,
  fingerprints: [] as string[][],
}));

vi.mock('@sentry/node', () => ({
  withScope(
    callback: (scope: {
      setTag(key: string, value: string): void;
      setFingerprint(parts: string[]): void;
    }) => void,
  ) {
    const tags: Record<string, string> = {};
    callback({
      setTag(key, value) {
        tags[key] = value;
      },
      setFingerprint(parts) {
        sentryHarness.fingerprints.push(parts);
      },
    });
    sentryHarness.tags.push(tags);
  },
  captureMessage(message: string) {
    sentryHarness.messages.push(message);
  },
}));

const CREDIT = {
  reason: 'credit_balance' as const,
  status: 400,
  type: 'invalid_request_error',
  errorCode: null,
  requestId: 'req_test_1',
};

describe('captureLlmProviderRejection', () => {
  afterEach(() => {
    sentryHarness.messages.length = 0;
    sentryHarness.tags.length = 0;
    sentryHarness.fingerprints.length = 0;
    vi.unstubAllEnvs();
  });

  it('sends one fingerprinted captureMessage tagged with reason and status', async () => {
    vi.stubEnv('SENTRY_DSN', 'https://stub@sentry.io/1');
    vi.stubEnv('WORKER_SENTRY_ENABLED', 'true');
    captureLlmProviderRejection(CREDIT);
    await vi.waitFor(() => expect(sentryHarness.messages).toEqual(['llm.provider_rejected']));
    expect(sentryHarness.fingerprints).toEqual([['llm.provider_rejected']]);
    expect(sentryHarness.tags).toEqual([{ reason: 'credit_balance', response_status: '400' }]);
    expect(JSON.stringify(sentryHarness)).not.toContain('req_test_1');
  });

  it('does not capture when the worker Sentry client is not installed', async () => {
    captureLlmProviderRejection(CREDIT);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sentryHarness.messages).toEqual([]);
  });
});
