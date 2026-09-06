import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';
import { installFetchStub, jsonOk, resetFetchStub } from '@/test/fetch-stub';
import { useDataExport } from './use-data-export';

vi.mock('@/lib/posthog', () => ({ track: vi.fn() }));
afterEach(() => {
  resetFetchStub();
  vi.restoreAllMocks();
});

it('reauthenticates when the export replay still rejects the refreshed session', async () => {
  let refreshes = 0;
  let exports = 0;
  installFetchStub([
    {
      method: 'GET',
      path: '/api/account/export',
      respond: () => {
        exports += 1;
        return new Response(null, { status: 401 });
      },
    },
    {
      method: 'POST',
      path: '/api/auth/refresh',
      respond: () => {
        refreshes += 1;
        return jsonOk({ data: { ok: true } });
      },
    },
  ]);
  const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);
  const client = createTestQueryClient();
  const { result } = renderHook(() => useDataExport(), {
    wrapper: ({ children }) => <QueryWrapper client={client}>{children}</QueryWrapper>,
  });
  result.current.mutate('decisions-csv');
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(refreshes).toBe(1);
  expect(exports).toBe(2);
  expect(assign).toHaveBeenCalledOnce();
  expect(assign.mock.calls[0]?.[0]).toContain('/api/auth/google/start');
});
