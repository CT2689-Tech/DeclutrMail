/**
 * `useDataExport` — the 401 path (audit 2026-08-21).
 *
 * The export streams a FILE, so it goes through raw `fetch` and skips
 * `apiRequest` entirely. That made it the one surface in the app where
 * an expired session did not refresh and did not route to re-auth — it
 * surfaced as the generic export failure, whose copy blames the export
 * rate limit and tells the user to wait. Waiting never recovers a dead
 * session, so the user was stuck on a wrong diagnosis.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';
import { installFetchStub, resetFetchStub } from '@/test/fetch-stub';

import { useDataExport } from './use-data-export';

vi.mock('@/lib/posthog', () => ({ track: vi.fn() }));

function csvOk(): Response {
  return new Response('a,b\n1,2\n', {
    status: 200,
    headers: {
      'content-type': 'text/csv',
      'Content-Disposition': 'attachment; filename="declutrmail-export.csv"',
    },
  });
}

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED' } }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  });
}

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryWrapper client={createTestQueryClient()}>{children}</QueryWrapper>;
}

let clickSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // jsdom has neither of these; the download path uses both.
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:stub');
  globalThis.URL.revokeObjectURL = vi.fn();
  clickSpy = vi
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(() => undefined) as never;
});

afterEach(() => {
  resetFetchStub();
  clickSpy.mockRestore();
  vi.restoreAllMocks();
});

describe('useDataExport — expired session', () => {
  it('refreshes once and replays the download instead of reporting a failure', async () => {
    let exportCalls = 0;
    let refreshCalls = 0;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/account/export',
        respond: () => {
          exportCalls += 1;
          return exportCalls === 1 ? unauthorized() : csvOk();
        },
      },
      {
        method: 'POST',
        path: '/api/auth/refresh',
        respond: () => {
          refreshCalls += 1;
          return new Response(null, { status: 204 });
        },
      },
    ]);

    const { result } = renderHook(() => useDataExport(), { wrapper });
    result.current.mutate('decisions-csv');

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(refreshCalls).toBe(1);
    expect(exportCalls).toBe(2);
    // The user sees their file, not the rate-limit banner.
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('routes a dead session to re-auth rather than leaving the rate-limit banner up', async () => {
    const assignSpy = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);
    installFetchStub([
      { method: 'GET', path: '/api/account/export', respond: () => unauthorized() },
      {
        method: 'POST',
        path: '/api/auth/refresh',
        respond: () => new Response(null, { status: 401 }),
      },
    ]);

    const { result } = renderHook(() => useDataExport(), { wrapper });
    result.current.mutate('decisions-csv');

    await waitFor(() => expect(assignSpy).toHaveBeenCalledTimes(1));
    expect(String(assignSpy.mock.calls[0]?.[0])).toContain('/api/auth/google/start');
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(clickSpy).not.toHaveBeenCalled();
  });
});
