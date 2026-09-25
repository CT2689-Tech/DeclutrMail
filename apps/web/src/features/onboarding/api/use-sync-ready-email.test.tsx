import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

import { useSyncReadyEmail } from './use-sync-ready-email';
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
  return renderHook(() => useSyncReadyEmail(), {
    wrapper: ({ children }) => <QueryWrapper client={client}>{children}</QueryWrapper>,
  });
}

describe('useSyncReadyEmail (D109)', () => {
  beforeEach(() => installFetchStub([]));
  afterEach(() => resetFetchStub());

  it('is true when the sync-complete email is switched on', async () => {
    installFetchStub([
      { method: 'GET', path: '/api/me/settings', respond: () => jsonOk(settingsWith(true)) },
    ]);
    const { result } = renderReadyEmail();
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('is false when the user turned it off (or unsubscribed from all mail)', async () => {
    let served = false;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/me/settings',
        respond: () => {
          served = true;
          return jsonOk(settingsWith(false));
        },
      },
    ]);
    const { result } = renderReadyEmail();
    await waitFor(() => expect(served).toBe(true));
    expect(result.current).toBe(false);
  });

  it('is false while unknown — before settings load and when they fail', async () => {
    let served = false;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/me/settings',
        respond: () => {
          served = true;
          return new Response('{}', { status: 500 });
        },
      },
    ]);
    const { result } = renderReadyEmail();
    expect(result.current).toBe(false);
    await waitFor(() => expect(served).toBe(true));
    expect(result.current).toBe(false);
  });
});
