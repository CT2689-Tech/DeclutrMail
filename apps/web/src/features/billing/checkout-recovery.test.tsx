import type * as CheckoutModule from './checkout';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('./checkout', async (importOriginal) => ({
  ...(await importOriginal<typeof CheckoutModule>()),
  launchCheckout: vi.fn(),
}));
import { CheckoutLaunchError, launchCheckout } from './checkout';
import { CheckoutRecovery, type HeldCheckout } from './checkout-recovery';
import {
  clearPendingCheckout,
  readPendingCheckout,
  writePendingCheckout,
} from './pending-checkout';
const session: HeldCheckout['session'] = {
  provider: 'paddle',
  kind: 'overlay',
  clientToken: 'test-token',
  environment: 'sandbox',
  priceId: 'pri_test',
  customData: { workspace_id: 'recovery-fixture', sig: 'synthetic' },
};
let held: HeldCheckout;
beforeEach(() => {
  vi.mocked(launchCheckout).mockReset();
  const record = writePendingCheckout(
    'recovery-fixture',
    'checkout_intent',
    'free',
    null,
    'pro',
    'annual',
    'own-id',
  );
  held = {
    workspaceId: 'recovery-fixture',
    session,
    target: 'pro',
    cycle: 'annual',
    attemptId: 'own-id',
    expiresAt: record.at + 30 * 60 * 1000,
  };
});
afterEach(() => {
  clearPendingCheckout('recovery-fixture');
  vi.useRealTimers();
});
it('one repeated click opens the exact held session, retaining its reservation until provider confirmation', async () => {
  let resolve!: () => void;
  vi.mocked(launchCheckout).mockImplementation(
    () =>
      new Promise<void>((r) => {
        resolve = r;
      }),
  );
  const onOpened = vi.fn();
  const onCompleted = vi.fn();
  render(
    <CheckoutRecovery
      held={held}
      mayOpen={() => true}
      onOpened={onOpened}
      onClosed={vi.fn()}
      onCompleted={onCompleted}
    />,
  );
  const retry = screen.getByRole('button', { name: 'Retry checkout window' });
  fireEvent.click(retry);
  fireEvent.click(retry);
  expect(launchCheckout).toHaveBeenCalledTimes(1);
  expect(vi.mocked(launchCheckout).mock.calls[0]?.[0]).toBe(session);
  expect(screen.getByRole('button', { name: 'Opening checkout…' })).toBeDisabled();
  expect(onCompleted).not.toHaveBeenCalled();
  await act(async () => {
    resolve();
  });
  expect(onOpened).toHaveBeenCalledTimes(1);
  expect(readPendingCheckout(held.workspaceId)?.attemptId).toBe('own-id');
});
it('a rejected loader allows retry without releasing or replacing the attempt', async () => {
  vi.mocked(launchCheckout).mockRejectedValue(new CheckoutLaunchError(true));
  const onClosed = vi.fn();
  render(
    <CheckoutRecovery
      held={held}
      mayOpen={() => true}
      onOpened={vi.fn()}
      onClosed={onClosed}
      onCompleted={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Retry checkout window' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('button', { name: 'Retry checkout window' })).toBeEnabled();
  expect(onClosed).not.toHaveBeenCalled();
  expect(readPendingCheckout(held.workspaceId)?.attemptId).toBe('own-id');
});
it.each(['unmount', 'replace', 'expire'])(
  'fences a loader that finishes after %s',
  async (kind) => {
    let finish!: () => void;
    let guard: (() => boolean) | undefined;
    vi.mocked(launchCheckout).mockImplementation(async (_session, _events, mayOpen) => {
      guard = mayOpen;
      await new Promise<void>((r) => {
        finish = r;
      });
      if (!mayOpen?.()) throw new CheckoutLaunchError(false);
    });
    const onClosed = vi.fn();
    const onOpened = vi.fn();
    const rendered = render(
      <CheckoutRecovery
        held={held}
        mayOpen={() => true}
        onOpened={onOpened}
        onClosed={onClosed}
        onCompleted={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry checkout window' }));
    await waitFor(() => expect(guard).toBeTypeOf('function'));
    if (kind === 'unmount') rendered.unmount();
    else if (kind === 'replace')
      writePendingCheckout(
        held.workspaceId,
        'checkout_intent',
        'free',
        null,
        'pro',
        'annual',
        'other-id',
      );
    else vi.spyOn(Date, 'now').mockReturnValue(held.expiresAt);
    expect(guard?.()).toBe(false);
    await act(async () => {
      finish();
    });
    expect(onOpened).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  },
);
