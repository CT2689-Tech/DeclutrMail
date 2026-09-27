import { afterEach, describe, expect, it, vi } from 'vitest';

import { replaceUrl } from './replace-url';

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('replaceUrl', () => {
  it('waits until the current effects have run, so Next has patched history', async () => {
    window.history.replaceState(null, '', '/settings?reconnect_result=success');

    replaceUrl('/settings#mailboxes');

    expect(window.location.search).toBe('?reconnect_result=success');
    await Promise.resolve();
    expect(window.location.pathname + window.location.search + window.location.hash).toBe(
      '/settings#mailboxes',
    );
  });

  it('never hands Next its own history state back, which would skip the router update', async () => {
    // What Next leaves in history.state on every app-router page.
    window.history.replaceState({ __NA: true }, '', '/triage?connect_error=connect_failed');
    const replace = vi.spyOn(window.history, 'replaceState');

    replaceUrl('/triage');
    await Promise.resolve();

    expect(replace).toHaveBeenCalledOnce();
    expect(replace.mock.calls[0]![0]).toBeNull();
  });
});
