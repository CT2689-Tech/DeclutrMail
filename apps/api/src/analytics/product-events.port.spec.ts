import { describe, expect, it, vi } from 'vitest';

import type { ProductEventsPort } from '@declutrmail/shared/analytics/product-events';

import { recordProductEvent } from './product-events.port.js';

describe('recordProductEvent', () => {
  it('swallows a recorder that throws', () => {
    const port: ProductEventsPort = {
      record: () => {
        throw new Error('analytics down');
      },
    };
    expect(() => recordProductEvent(port, 'free_cap_hit', { requested_bucket: '1' })).not.toThrow();
  });

  it('records when the port is present', () => {
    const record = vi.fn();
    recordProductEvent({ record }, 'checkout_created', { plan: 'plus' }, 'user-1');
    expect(record).toHaveBeenCalledWith('checkout_created', { plan: 'plus' }, 'user-1');
  });
});
