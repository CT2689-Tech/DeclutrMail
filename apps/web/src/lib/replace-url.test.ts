import { afterEach, describe, expect, it, vi } from 'vitest';

import { replaceUrl } from './replace-url';

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

const here = () => window.location.pathname + window.location.search + window.location.hash;

describe('replaceUrl', () => {
  it('waits until the current effects have run, so Next has patched history', async () => {
    window.history.replaceState(null, '', '/settings?reconnect_result=success');

    replaceUrl((url) => {
      url.searchParams.delete('reconnect_result');
      url.hash = 'mailboxes';
    });

    expect(window.location.search).toBe('?reconnect_result=success');
    await Promise.resolve();
    expect(here()).toBe('/settings#mailboxes');
  });

  it('never hands Next its own history state back, which would skip the router update', async () => {
    // What Next leaves in history.state on every app-router page.
    window.history.replaceState({ __NA: true }, '', '/triage?connect_error=connect_failed');
    const replace = vi.spyOn(window.history, 'replaceState');

    replaceUrl((url) => url.searchParams.delete('connect_error'));
    await Promise.resolve();

    expect(replace).toHaveBeenCalledOnce();
    expect(replace.mock.calls[0]![0]).toBeNull();
  });

  // Settings and the chrome can each clear their own param in one tick.
  // Built from the URL as it was, the later write put back what the
  // earlier one removed, and a reload replayed that result.
  it('applies two edits queued in the same tick to the same URL', async () => {
    window.history.replaceState(
      null,
      '',
      '/settings?reconnect_result=success&connect_error=connect_failed&keep=1',
    );

    replaceUrl((url) => url.searchParams.delete('reconnect_result'));
    replaceUrl((url) => url.searchParams.delete('connect_error'));
    await Promise.resolve();

    expect(here()).toBe('/settings?keep=1');
  });
});
