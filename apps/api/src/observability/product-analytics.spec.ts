import { describe, expect, it, vi } from 'vitest';

import {
  __setClientForTest,
  captureServerEvent,
  UNREMEDIATED_SERVER_EVENTS,
} from './product-analytics.js';

describe('UNREMEDIATED_SERVER_EVENTS — a frozen debt list, not an allowlist', () => {
  it('is exactly the two calls that predate the no-server-emission rule', () => {
    // The rule is that server-side code does not emit to PostHog at all:
    // no server process can read analytics consent (D147 keeps it in
    // browser localStorage, decline by default, deliberately unsynced),
    // and we publish that PostHog runs only after the user accepts.
    // Anonymising does not help — the promise is that PostHog does not RUN.
    //
    // These two ship today and therefore violate that rule. They are not
    // an exception to it. Removing them changes live behaviour on a
    // published-policy question, so F004 holds the decision.
    //
    // This assertion exists so the list can only be changed deliberately.
    // Expect it to shrink to empty; a PR that GROWS it is adding a third
    // violation and should be rejected on that basis alone.
    expect([...UNREMEDIATED_SERVER_EVENTS]).toEqual(['email.delivered', 'email.bounced']);
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
