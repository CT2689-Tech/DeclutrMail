import { describe, expect, it, vi } from 'vitest';

import {
  __setClientForTest,
  captureServerEvent,
  SERVER_EMITTABLE_EVENTS,
} from './product-analytics.js';

describe('SERVER_EMITTABLE_EVENTS — the consent gate in the type system', () => {
  it('is exactly the two events that ship today, and growing it must be deliberate', () => {
    // No server process can read analytics consent (D147 stores it in
    // browser localStorage, decline by default, deliberately unsynced), and
    // we publish that PostHog runs only after the user accepts. So anything
    // emitted server-side reaches people who refused it, and anonymising
    // does not help — the promise is that PostHog does not RUN.
    //
    // The union alone stops a stray call; this assertion is what puts a
    // human in front of the decision, because adding a name must fail
    // something rather than pass quietly. A server-side sync event was
    // written and removed for exactly this reason. F004 asks whether even
    // these two should stay — they are listed because they ship, not
    // because they were cleared.
    expect([...SERVER_EMITTABLE_EVENTS]).toEqual(['email.delivered', 'email.bounced']);
  });
});

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
