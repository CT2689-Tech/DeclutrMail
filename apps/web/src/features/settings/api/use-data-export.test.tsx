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

import { ApiError } from '@/lib/api/client';
import { track } from '@/lib/posthog';
import { dataExportFailure, useDataExport } from './use-data-export';

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
  vi.mocked(track).mockClear();
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
    // The completed blob reaches the browser download mechanism.
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('routes a dead session to re-auth rather than leaving the rate-limit banner up', async () => {
    window.history.replaceState(null, '', '/settings/privacy');
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
    expect(String(assignSpy.mock.calls[0]?.[0])).toBe(
      '/sign-in?returning=1&returnTo=%2Fsettings%2Fprivacy',
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(clickSpy).not.toHaveBeenCalled();
  });
});

describe('useDataExport — preparation and feedback', () => {
  it('waits for the complete blob before browser handoff and one success event', async () => {
    let finishBlob!: (blob: Blob) => void;
    const response = csvOk();
    vi.spyOn(response, 'blob').mockImplementation(
      () =>
        new Promise<Blob>((resolve) => {
          finishBlob = resolve;
        }),
    );
    installFetchStub([{ method: 'GET', path: '/api/account/export', respond: () => response }]);
    const { result } = renderHook(() => useDataExport(), { wrapper });
    result.current.mutate('senders-csv');
    await waitFor(() => expect(response.blob).toHaveBeenCalledTimes(1));
    expect(result.current.isPending).toBe(true);
    expect(clickSpy).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalled();
    finishBlob(new Blob(['sender,count\nexample.invalid,1\n']));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:stub');
    expect(track).toHaveBeenCalledExactlyOnceWith('data_export_requested', {
      format: 'senders-csv',
      outcome: 'success',
    });
  });

  it.each([
    ['rate limit', () => new Response(null, { status: 429 }), 'rate_limited'],
    ['server failure', () => new Response(null, { status: 500 }), 'unavailable'],
    [
      'network failure',
      () => {
        throw new TypeError('Failed to fetch');
      },
      'unavailable',
    ],
    [
      'stream failure',
      () => {
        const response = csvOk();
        vi.spyOn(response, 'blob').mockRejectedValue(new TypeError('Stream failed'));
        return response;
      },
      'unavailable',
    ],
  ] as const)('reports %s without a download handoff', async (_name, respond, failure) => {
    installFetchStub([{ method: 'GET', path: '/api/account/export', respond }]);
    const { result } = renderHook(() => useDataExport(), { wrapper });
    result.current.mutate('csv');
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(dataExportFailure(result.current.error)).toBe(failure);
    expect(clickSpy).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledExactlyOnceWith('data_export_requested', {
      format: 'csv',
      outcome: 'failed',
    });
  });

  it.each([
    ['senders-csv', 'senders'],
    ['decisions-csv', 'decisions'],
  ] as const)(
    'names the %s dataset when the filename header is unavailable',
    async (format, dataset) => {
      installFetchStub([
        {
          method: 'GET',
          path: '/api/account/export',
          respond: () => new Response('synthetic', { status: 200 }),
        },
      ]);
      const { result } = renderHook(() => useDataExport(), { wrapper });
      result.current.mutate(format);
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      const anchor = clickSpy.mock.contexts[0] as HTMLAnchorElement;
      expect(anchor.download).toMatch(
        new RegExp(`^declutrmail-${dataset}-[0-9]{4}-[0-9]{2}-[0-9]{2}\\.csv$`),
      );
    },
  );

  it('preserves an available server filename instead of replacing it with a fallback', async () => {
    installFetchStub([{ method: 'GET', path: '/api/account/export', respond: () => csvOk() }]);
    const { result } = renderHook(() => useDataExport(), { wrapper });
    result.current.mutate('senders-csv');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect((clickSpy.mock.contexts[0] as HTMLAnchorElement).download).toBe(
      'declutrmail-export.csv',
    );
  });

  it('does not infer rate limits from arbitrary error messages or object fields', () => {
    expect(dataExportFailure(new Error('429 rate limit'))).toBe('unavailable');
    expect(dataExportFailure({ status: 429 })).toBe('unavailable');
    expect(dataExportFailure(new ApiError(401, null, 'Unauthorized'))).toBe('unauthenticated');
  });
});
