import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { installFetchStub, jsonOk, resetFetchStub } from '@/test/fetch-stub';
import { QueryWrapper, createTestQueryClient } from '@/test/query-wrapper';
import { ChangePlanPanel } from './change-plan-panel';

afterEach(() => {
  resetFetchStub();
  vi.restoreAllMocks();
});

describe('deferred plan preview', () => {
  const effectiveAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
  function panel(onConfirm = vi.fn(), currentPeriodEnd: string | null = effectiveAt) {
    render(
      <QueryWrapper client={createTestQueryClient()}>
        <ChangePlanPanel
          target="plus"
          cycle="monthly"
          fromTier="pro"
          fromCycle="monthly"
          currentPeriodEnd={currentPeriodEnd}
          provider="paddle"
          isPending={false}
          errorMessage={null}
          onConfirm={onConfirm}
          onDismiss={vi.fn()}
        />
      </QueryWrapper>,
    );
    return onConfirm;
  }

  it('blocks unsupported deferred changes before confirmation and permits a validated retry', async () => {
    let calls = 0;
    installFetchStub([
      {
        method: 'POST',
        path: '/api/billing/change-plan/preview',
        respond: () => {
          calls++;
          return calls === 1
            ? new Response(JSON.stringify({ error: { code: 'PLAN_CHANGE_UNSUPPORTED' } }), {
                status: 409,
                headers: { 'content-type': 'application/json' },
              })
            : jsonOk({ data: { kind: 'deferred', effectiveAt } });
        },
      },
    ]);
    const confirm = panel();
    const button = screen.getByRole('button', { name: 'Schedule downgrade' });
    expect(button).toBeDisabled();
    await screen.findByRole('button', { name: 'Refresh quote' });
    expect(screen.getByTestId('change-plan-panel')).not.toHaveTextContent('$0 today');
    expect(screen.getByRole('alert')).toHaveTextContent('paid period');
    fireEvent.click(button);
    expect(confirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh quote' }));
    await waitFor(() => expect(button).toBeEnabled());
    expect(screen.getByTestId('change-plan-panel')).toHaveTextContent('$0 today');
    fireEvent.click(button);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(calls).toBe(2);
  });

  it('does not treat an immediate quote as permission to schedule a deferred change', async () => {
    installFetchStub([
      {
        method: 'POST',
        path: '/api/billing/change-plan/preview',
        respond: () =>
          jsonOk({
            data: {
              kind: 'immediate',
              result: { action: 'charge', amount: '0', currencyCode: 'USD' },
              nextBilledAt: effectiveAt,
            },
          }),
      },
    ]);
    const confirm = panel();
    await screen.findByRole('button', { name: 'Refresh quote' });
    expect(screen.getByRole('button', { name: 'Schedule downgrade' })).toBeDisabled();
    expect(screen.getByTestId('change-plan-panel')).not.toHaveTextContent('$0 today');
    expect(confirm).not.toHaveBeenCalled();
  });
  it.each([
    { currentPeriodEnd: null, previewEnd: null },
    {
      currentPeriodEnd: effectiveAt,
      previewEnd: new Date(Date.parse(effectiveAt) + 86_400_000).toISOString(),
    },
  ])(
    'refuses an unknown or changed renewal boundary: %j',
    async ({ currentPeriodEnd, previewEnd }) => {
      installFetchStub([
        {
          method: 'POST',
          path: '/api/billing/change-plan/preview',
          respond: () => jsonOk({ data: { kind: 'deferred', effectiveAt: previewEnd } }),
        },
      ]);
      const confirm = panel(vi.fn(), currentPeriodEnd);
      await screen.findByRole('button', { name: 'Refresh quote' });
      expect(screen.getByRole('button', { name: 'Schedule downgrade' })).toBeDisabled();
      expect(screen.getByTestId('change-plan-panel')).not.toHaveTextContent('$0 today');
      expect(confirm).not.toHaveBeenCalled();
    },
  );
});
