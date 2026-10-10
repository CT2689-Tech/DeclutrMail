import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { accountDeletionQueryOptions } from './api/query-options';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';

import { ERROR_CODES } from '@declutrmail/shared/contracts';

import { ApiError } from '@/lib/api/client';
import { installFetchStub, jsonOk, resetFetchStub } from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';
import { AccountDeletionSection, deletionSubmitError } from './account-deletion-section';
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

describe('AccountDeletionSection', () => {
  it('blocks deletion and provides Billing and support routes when billing is unresolved', async () => {
    const client = createTestQueryClient();
    client.setQueryData(
      accountDeletionQueryOptions(async () => {
        throw new Error('unexpected');
      }).queryKey,
      {
        request: null,
        billingBlockReason: 'verification',
        projection: {
          flatGraceAt: '2026-10-17T00:00:00Z',
          latestUndoExpiresAt: null,
          activeUndoCount: 0,
          projectedEffectiveAt: '2026-10-17T00:00:00Z',
          projectedBasis: 'flat-grace',
        },
      },
    );
    render(
      <QueryWrapper client={client}>
        <AccountDeletionSection />
      </QueryWrapper>,
    );
    expect(await screen.findByRole('button', { name: 'Delete account' })).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Open Billing' })).toHaveAttribute('href', '/billing');
    expect(screen.getByRole('link', { name: 'contact support' })).toHaveAttribute(
      'href',
      'mailto:support@declutrmail.com',
    );
  });

  it('hydrates safely when the shell populated deletion status after SSR', async () => {
    const client = createTestQueryClient();
    const status = {
      request: null,
      projection: {
        flatGraceAt: '2026-10-08T00:00:00Z',
        latestUndoExpiresAt: null,
        activeUndoCount: 0,
        projectedEffectiveAt: '2026-10-08T00:00:00Z',
        projectedBasis: 'flat-grace' as const,
      },
    };
    const node = (
      <QueryWrapper client={client}>
        <AccountDeletionSection />
      </QueryWrapper>
    );
    const container = document.createElement('div');
    container.innerHTML = renderToString(node);
    document.body.appendChild(container);
    client.setQueryData(accountDeletionQueryOptions(async () => status).queryKey, status);
    const onRecoverableError = vi.fn();
    let root!: ReturnType<typeof hydrateRoot>;
    try {
      await act(async () => {
        root = hydrateRoot(container, node, { onRecoverableError });
      });
      expect(onRecoverableError).not.toHaveBeenCalled();
      expect(container.textContent).toContain('Delete account and data');
    } finally {
      act(() => root?.unmount());
      container.remove();
      client.clear();
    }
  });

  it('loads the dialog on demand and retains both confirmation steps', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/account/deletion',
        respond: () =>
          jsonOk({
            data: {
              request: null,
              projection: {
                flatGraceAt: '2026-10-08T00:00:00Z',
                latestUndoExpiresAt: null,
                activeUndoCount: 0,
                projectedEffectiveAt: '2026-10-08T00:00:00Z',
                projectedBasis: 'flat-grace',
              },
            },
          }),
      },
    ]);
    try {
      render(
        <QueryWrapper client={createTestQueryClient()}>
          <AccountDeletionSection />
        </QueryWrapper>,
      );
      fireEvent.click(await screen.findByRole('button', { name: 'Delete account' }));
      expect(await screen.findByRole('dialog')).toBeInTheDocument();
      const continueButton = screen.getByRole('button', { name: /review deletion timing/i });
      expect(continueButton).toBeDisabled();
      fireEvent.click(screen.getByRole('checkbox'));
      fireEvent.click(continueButton);
      expect(screen.getByRole('textbox')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /schedule deletion/i })).toBeDisabled();
    } finally {
      resetFetchStub();
    }
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
