import { afterEach, describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

import { briefKeys } from '@/features/brief/api/query-keys';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';
import { installFetchStub, jsonOk, resetFetchStub } from '@/test/fetch-stub';

import { useHomeWorkflows } from './use-home-workflows';

afterEach(() => resetFetchStub());

describe('Home Brief signal when today has no edition', () => {
  it.each([
    [
      '404',
      () => new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } }),
    ],
    ['204', () => new Response(null, { status: 204 })],
    ['null data', () => jsonOk({ data: null })],
  ])('stays empty on %s', async (_label, respond) => {
    installFetchStub([
      { method: 'GET', path: '/api/briefs/today', respond },
      { method: 'GET', path: '/api/followups', respond: () => jsonOk({ data: [] }) },
      {
        method: 'GET',
        path: '/api/autopilot/pending-suggestions',
        respond: () => jsonOk({ data: [] }),
      },
    ]);
    const client = createTestQueryClient();
    const { result, unmount } = renderHook(() => useHomeWorkflows('pro', true), {
      wrapper: ({ children }) => <QueryWrapper client={client}>{children}</QueryWrapper>,
    });
    try {
      await waitFor(() => expect(client.getQueryState(briefKeys.today())?.status).toBe('success'));
      expect(client.getQueryState(briefKeys.today())?.error).toBeNull();
      expect(result.current.brief).toBeNull();
    } finally {
      unmount();
      client.clear();
    }
  });
});
