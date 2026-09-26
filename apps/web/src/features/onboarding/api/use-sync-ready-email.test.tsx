import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

import { useSyncReadyEmail } from './use-sync-ready-email';
import { ME_SETTINGS_QUERY_KEY } from '@/features/settings/api/query-options';
import { installFetchStub, jsonOk, resetFetchStub } from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';

function settingsWith(syncComplete: boolean) {
  return {
    data: {
      emailPrefs: { syncComplete, reminders: true, weeklyReceipt: false },
    },
  };
}

function renderReadyEmail() {
  const client = createTestQueryClient();
  const hook = renderHook(() => useSyncReadyEmail(), {
    wrapper: ({ children }) => <QueryWrapper client={client}>{children}</QueryWrapper>,
  });
  // Assert only once the query has SETTLED — asserting as soon as the
  // request is served races the response, and a hook that returned true
  // for any loaded settings would pass (design-system review).
  const settled = (status: 'success' | 'error') =>
    waitFor(() => expect(client.getQueryState(ME_SETTINGS_QUERY_KEY)?.status).toBe(status));
  return { ...hook, settled };
}

describe('useSyncReadyEmail (D109)', () => {
  beforeEach(() => installFetchStub([]));
  afterEach(() => resetFetchStub());

  it('is true when the sync-complete email is switched on', async () => {
    installFetchStub([
      { method: 'GET', path: '/api/me/settings', respond: () => jsonOk(settingsWith(true)) },
    ]);
    const { result, settled } = renderReadyEmail();
    await settled('success');
    expect(result.current).toBe(true);
  });

  it('is false when the user turned it off (or unsubscribed from all mail)', async () => {
    installFetchStub([
      { method: 'GET', path: '/api/me/settings', respond: () => jsonOk(settingsWith(false)) },
    ]);
    const { result, settled } = renderReadyEmail();
    await settled('success');
    expect(result.current).toBe(false);
  });

  it('is false while unknown — before settings load and when they fail', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/me/settings',
        respond: () => new Response('{}', { status: 500 }),
      },
    ]);
    const { result, settled } = renderReadyEmail();
    expect(result.current).toBe(false);
    await settled('error');
    expect(result.current).toBe(false);
  });
});
