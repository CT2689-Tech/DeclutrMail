import { describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

import { ERROR_CODES } from '@declutrmail/shared/contracts';

import { ApiError } from '@/lib/api/client';
import { installFetchStub, jsonOk, resetFetchStub } from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';
import { deletionSubmitError } from './account-deletion-section';
import { useAccountDeletionStatus, useRequestAccountDeletion } from './api/use-account-deletion';

function conflict(code: string): ApiError {
  return new ApiError(409, { error: { code } }, 'conflict');
}

describe('deletionSubmitError', () => {
  it('says a deletion is already scheduled instead of "try again"', () => {
    // DELETION_ALREADY_PENDING repeats on every attempt: another tab or
    // device already scheduled it.
    const message = deletionSubmitError(conflict('DELETION_ALREADY_PENDING'));
    expect(message).toBe(ERROR_CODES.DELETION_ALREADY_PENDING.message);
    expect(message).not.toMatch(/try again/i);
  });

  it('keeps the phrase and retry messages for their own causes', () => {
    expect(deletionSubmitError(new ApiError(400, {}, 'bad'))).toMatch(/phrase did not match/);
    expect(deletionSubmitError(new ApiError(500, {}, 'boom'))).toMatch(/try again/i);
    expect(deletionSubmitError(null)).toBeNull();
  });
});

describe('useRequestAccountDeletion', () => {
  it('re-reads the status after DELETION_ALREADY_PENDING so the pending row renders', async () => {
    let statusReads = 0;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/account/deletion',
        respond: () => {
          statusReads += 1;
          return jsonOk({ data: { status: 'none' } });
        },
      },
      {
        method: 'POST',
        path: '/api/account/deletion',
        respond: () =>
          new Response(JSON.stringify({ error: { code: 'DELETION_ALREADY_PENDING' } }), {
            status: 409,
            headers: { 'content-type': 'application/json' },
          }),
      },
    ]);
    try {
      const client = createTestQueryClient();
      const { result } = renderHook(
        () => ({ status: useAccountDeletionStatus(), request: useRequestAccountDeletion() }),
        { wrapper: ({ children }) => <QueryWrapper client={client}>{children}</QueryWrapper> },
      );
      await waitFor(() => expect(statusReads).toBe(1));
      act(() => result.current.request.mutate({ confirmPhrase: 'DELETE' } as never));
      await waitFor(() => expect(result.current.request.isError).toBe(true));
      await waitFor(() => expect(statusReads).toBe(2));
    } finally {
      resetFetchStub();
    }
  });
});
