import { scrubSentryEvent } from '@declutrmail/shared/observability';
import { describe, expect, it } from 'vitest';

const LEAK = 'Your credit balance is too low to access the Anthropic API';

describe('llm.provider_rejected on the Sentry wire', () => {
  it('keeps the breaker trip message, fingerprint, reason and status', () => {
    const out = scrubSentryEvent(
      {
        level: 'error',
        message: 'llm.provider_rejected',
        fingerprint: ['llm.provider_rejected'],
        tags: { reason: 'credit_balance', response_status: '400', request_id: 'req_test_1' },
        exception: {
          values: [{ type: 'Error', value: 'llm.provider_rejected' }],
        },
      },
      'server',
    );
    expect(out).toMatchObject({
      message: 'llm.provider_rejected',
      fingerprint: ['llm.provider_rejected'],
      tags: { reason: 'credit_balance', response_status: '400' },
      exception: { values: [{ type: 'Error', value: 'llm.provider_rejected' }] },
    });
    expect(out?.tags).not.toHaveProperty('request_id');
    expect(JSON.stringify(out)).not.toContain(LEAK);
  });

  it('still drops a message that is not the closed literal', () => {
    const out = scrubSentryEvent(
      {
        level: 'error',
        message: LEAK,
        exception: { values: [{ type: 'Error', value: `${LEAK} — llm.provider_rejected` }] },
      },
      'server',
    );
    expect(out?.message).toBeUndefined();
    const value = (out?.exception as { values: Array<{ value?: string }> } | undefined)?.values[0]
      ?.value;
    expect(value).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain('credit balance');
  });

  it('does not keep the trip message on the browser profile', () => {
    const out = scrubSentryEvent({ level: 'error', message: 'llm.provider_rejected' }, 'browser');
    expect(out?.message).toBeUndefined();
  });
});
