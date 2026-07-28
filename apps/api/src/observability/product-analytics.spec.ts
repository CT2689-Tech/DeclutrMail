import { describe, expect, it, vi } from 'vitest';

import { __setClientForTest, captureServerEvent } from './product-analytics.js';

describe('captureServerEvent', () => {
  it('no-ops without a configured client', () => {
    __setClientForTest(null);
    expect(() => captureServerEvent('email.delivered', { kind: 'sync-complete' })).not.toThrow();
  });

  it('forwards event and properties when configured', () => {
    const capture = vi.fn();
    __setClientForTest({ capture } as never);
    captureServerEvent('email.delivered', { kind: 'sync-complete' });
    expect(capture).toHaveBeenCalledWith(expect.objectContaining({ event: 'email.delivered' }));
  });

  it('swallows client errors — analytics must never break a request', () => {
    __setClientForTest({
      capture: () => {
        throw new Error('posthog down');
      },
    } as never);
    expect(() => captureServerEvent('email.delivered', {})).not.toThrow();
  });
});
