// Tests for the Unprotect control's FAILURE and IN-FLIGHT branches.
//
// Every prior unprotect test in the repo stubbed a 200. D245 makes a
// manual Unprotect a sticky, undo-less override — so a failure that
// reads as success is the worst direction for this control to be wrong
// in, and it was the one direction nothing exercised (flow audit
// 2026-08-10).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const h = vi.hoisted(() => ({ toast: vi.fn(), capture: vi.fn(), track: vi.fn() }));

vi.mock('@declutrmail/shared', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, toast: h.toast };
});
vi.mock('@/lib/sentry', () => ({ captureFeatureException: h.capture }));
vi.mock('@/lib/posthog', () => ({ track: h.track }));

import { QueryWrapper, createTestQueryClient } from '@/test/query-wrapper';
import { installFetchStub, resetFetchStub } from '@/test/fetch-stub';
import { TRIAGE_QUEUE } from './data';
import { UnprotectButton } from './unprotect-button';

function protectedRow() {
  const row = TRIAGE_QUEUE.find((r) => r.protectionReason !== null);
  if (!row) throw new Error('fixture needs a protected row');
  return row;
}

function renderButton(onUnprotected?: () => void) {
  return render(
    <QueryWrapper client={createTestQueryClient()}>
      <UnprotectButton
        row={protectedRow()}
        surface="onboarding-review"
        onUnprotected={onUnprotected}
      />
    </QueryWrapper>,
  );
}

describe('UnprotectButton — failure is a failure, not a quiet success', () => {
  beforeEach(() => {
    h.toast.mockClear();
    h.capture.mockClear();
    h.track.mockClear();
  });
  afterEach(() => resetFetchStub());

  it('warns, reports, keeps the control re-usable, and advances NOTHING on a 500', async () => {
    installFetchStub([
      {
        method: 'PATCH',
        path: /\/api\/senders\/[^/]+\/policy/,
        respond: () =>
          new Response(JSON.stringify({ error: { code: 'internal' } }), {
            status: 500,
            headers: { 'content-type': 'application/json' },
          }),
      },
    ]);
    const onUnprotected = vi.fn();
    renderButton(onUnprotected);

    await userEvent.click(screen.getByRole('button', { name: /^Unprotect$/i }));

    await waitFor(() =>
      expect(h.toast).toHaveBeenCalledWith("Couldn't remove protection — try again.", 'warn'),
    );
    expect(h.capture).toHaveBeenCalledWith(expect.anything(), {
      surface: 'triage',
      reason: 'unprotect',
    });
    // The caller's advance hook must NOT fire — on the sheet it closes
    // the pending action, so firing it on failure would dismiss the
    // preview of an action that never resolved.
    expect(onUnprotected).not.toHaveBeenCalled();
    // No success telemetry for a failure.
    expect(h.track).not.toHaveBeenCalled();
    // Re-usable, not latched.
    await waitFor(() => expect(screen.getByRole('button', { name: /^Unprotect$/i })).toBeEnabled());
  });

  it('disables and says "Removing protection…" while the PATCH is in flight', async () => {
    let release: (() => void) | undefined;
    installFetchStub([
      {
        method: 'PATCH',
        path: /\/api\/senders\/[^/]+\/policy/,
        respond: () =>
          new Promise<Response>((resolve) => {
            release = () =>
              resolve(
                new Response(
                  JSON.stringify({
                    data: {
                      senderId: 's1',
                      policyType: null,
                      isProtected: false,
                      protectionReason: null,
                    },
                    meta: {},
                  }),
                  { status: 200, headers: { 'content-type': 'application/json' } },
                ),
              );
          }),
      },
    ]);
    renderButton();

    await userEvent.click(screen.getByRole('button', { name: /^Unprotect$/i }));

    const inFlight = await screen.findByRole('button', { name: /Removing protection…/i });
    expect(inFlight).toBeDisabled();

    release?.();
    await waitFor(() =>
      expect(h.toast).toHaveBeenCalledWith(expect.stringMatching(/no longer Protected/), 'success'),
    );
  });
});
