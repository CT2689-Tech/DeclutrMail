import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast, ToastHost } from '@declutrmail/shared';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';
import { installFetchStub, jsonOk, jsonServerError, resetFetchStub } from '@/test/fetch-stub';
import { useUndoSenderKeep } from './use-sender-policy';

function KeptResult({ restored }: { restored: () => void }) {
  const undo = useUndoSenderKeep(restored);
  return (
    <button
      onClick={() =>
        toast('Kept Acme', 'success', {
          label: 'Undo',
          onClick: () => undo.mutate({ senderId: 'acme' }),
        })
      }
    >
      Show Keep result
    </button>
  );
}

afterEach(() => {
  cleanup();
  resetFetchStub();
});

describe('Keep Undo recovery through the real notification host', () => {
  it('offers a working Retry after the first request fails', async () => {
    let attempts = 0;
    const restored = vi.fn();
    installFetchStub([
      {
        method: 'POST',
        path: '/api/senders/acme/keep/undo',
        respond: () =>
          ++attempts === 1
            ? jsonServerError()
            : jsonOk({
                data: {
                  senderId: 'acme',
                  policyType: null,
                  isProtected: false,
                  protectionReason: null,
                  protectionSetAt: null,
                  changed: true,
                },
              }),
      },
    ]);
    render(
      <QueryWrapper client={createTestQueryClient()}>
        <KeptResult restored={restored} />
        <ToastHost />
      </QueryWrapper>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show Keep result' }));
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(restored).toHaveBeenCalledOnce());
    expect(attempts).toBe(2);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });
  it('preserves the Protected conflict recovery and does not offer a blind retry', async () => {
    const restored = vi.fn();
    installFetchStub([
      {
        method: 'POST',
        path: '/api/senders/acme/keep/undo',
        respond: () =>
          new Response(
            JSON.stringify({
              error: {
                code: 'PROTECTED_SENDER',
                message: 'Unprotect this sender before undoing Keep.',
              },
            }),
            { status: 409, headers: { 'Content-Type': 'application/json' } },
          ),
      },
    ]);
    render(
      <QueryWrapper client={createTestQueryClient()}>
        <KeptResult restored={restored} />
        <ToastHost />
      </QueryWrapper>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show Keep result' }));
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await screen.findByText('Unprotect this sender before undoing Keep.');
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(restored).not.toHaveBeenCalled();
  });
});
