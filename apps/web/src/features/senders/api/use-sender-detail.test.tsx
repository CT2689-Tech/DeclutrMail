/**
 * Tests for `useSenderDetail`.
 *
 * Two paths matter: the happy-path GET that returns the detail row,
 * and the 404 path that the page consumes to render its not-found
 * branch. We also verify the hook does NOT retry on 404 — otherwise
 * the not-found UI would lag by the default retry window.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useSenderDetail } from './use-sender-detail';
import { ApiError } from '@/lib/api/client';
import { installFetchStub, jsonNotFound, jsonOk, resetFetchStub } from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';

const DETAIL = {
  id: 'linkedin',
  displayName: 'LinkedIn',
  email: 'noreply@linkedin.com',
  domain: 'linkedin.com',
  gmailCategory: 'social' as const,
  lastSeenAt: '2026-05-23T00:00:00.000Z',
  firstSeenAt: '2023-05-23T00:00:00.000Z',
  monthlyVolume: 64,
  readRate: 0,
  unsubscribeMethod: 'mailto' as const,
  protectionFlags: { vip: false, protect: false },
};

describe('useSenderDetail', () => {
  beforeEach(() => installFetchStub([]));
  afterEach(() => resetFetchStub());

  it('returns the detail envelope on success', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: /^\/api\/senders\/[^/]+$/,
        respond: () => jsonOk({ data: DETAIL }),
      },
    ]);

    const client = createTestQueryClient();
    const { result } = renderHook(() => useSenderDetail('linkedin'), {
      wrapper: ({ children }) => <QueryWrapper client={client}>{children}</QueryWrapper>,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data.id).toBe('linkedin');
  });

  it('surfaces a 404 as an ApiError without retrying', async () => {
    let calls = 0;
    installFetchStub([
      {
        method: 'GET',
        path: /^\/api\/senders\/[^/]+$/,
        respond: () => {
          calls += 1;
          return jsonNotFound('sender_not_found');
        },
      },
    ]);

    const client = createTestQueryClient();
    const { result } = renderHook(() => useSenderDetail('ghost'), {
      wrapper: ({ children }) => <QueryWrapper client={client}>{children}</QueryWrapper>,
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
    expect((result.current.error as ApiError).status).toBe(404);
    // The retry-on-404 short-circuit should keep this to a single call.
    expect(calls).toBe(1);
  });
});
