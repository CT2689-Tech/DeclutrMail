/**
 * Production-parity guard for the Senders workspace of the public demo.
 *
 * `production-parity.test.tsx` holds this line for Triage. Senders lost it
 * once: the workspace was a 950-line hand-built imitation of the product
 * screen, and it drifted on layout, filters, navigation and the review
 * flow while every test stayed green.
 *
 * Each mock below stands in for a product component the demo must MOUNT.
 * Replace one with a local copy and its spy stops being called, and this
 * file fails by name. It asserts mounting, not appearance: what those
 * components render is covered by their own tests and by
 * `senders-demo.test.tsx`, which drives them for real.
 */
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const spies = vi.hoisted(() => ({
  sendersScreen: vi.fn(),
  undoTray: vi.fn(),
  senderDetail: vi.fn(),
  narrow: false,
}));

vi.mock('@/lib/posthog', () => ({
  track: vi.fn(async () => undefined),
  setTrackGate: vi.fn(),
}));
vi.mock('next/navigation', async () =>
  (await import('@/test/next-navigation-url')).nextNavigationUrlMock(),
);

vi.mock('@/features/senders/senders-screen', () => ({
  SendersScreen: (props: unknown) => {
    spies.sendersScreen(props);
    return null;
  },
}));
vi.mock('@/features/triage/triage-undo-tray', () => ({
  ProductUndoTray: (props: unknown) => {
    spies.undoTray(props);
    return null;
  },
}));
vi.mock('@/features/senders/detail/sender-detail-page', () => ({
  SenderDetailRoute: (props: unknown) => {
    spies.senderDetail(props);
    return null;
  },
}));

import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';

import { InboxSimulatorScreen } from './inbox-simulator-screen';

/** The root layout provides the page's query cache; the demo requires one. */
function renderPage() {
  return render(
    <QueryWrapper client={createTestQueryClient()}>
      <InboxSimulatorScreen />
    </QueryWrapper>,
  );
}

beforeEach(() => {
  localStorage.clear();
  spies.narrow = false;
  for (const spy of [spies.sendersScreen, spies.undoTray, spies.senderDetail]) spy.mockClear();
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: spies.narrow,
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList,
  );
});

describe('inbox simulator — Senders production parity', () => {
  it('mounts the product’s SendersScreen, never a demo copy of it', async () => {
    window.history.pushState({}, '', '/inbox-simulator?workspace=senders');
    renderPage();
    await waitFor(() => expect(spies.sendersScreen).toHaveBeenCalled(), { timeout: 8_000 });
  });

  it('mounts the product’s Undo bar beside it', async () => {
    window.history.pushState({}, '', '/inbox-simulator?workspace=senders');
    renderPage();
    await waitFor(() => expect(spies.undoTray).toHaveBeenCalled(), { timeout: 8_000 });
  });

  it('opens a sender on a narrow screen with the product’s detail page', async () => {
    spies.narrow = true;
    window.history.pushState({}, '', '/inbox-simulator?workspace=senders&sender=northstar');
    renderPage();
    await waitFor(
      () =>
        expect(spies.senderDetail).toHaveBeenCalledWith(
          expect.objectContaining({ id: 'northstar' }),
        ),
      { timeout: 8_000 },
    );
  });

  it('does not mount the Senders screen in the Triage workspace', async () => {
    window.history.pushState({}, '', '/inbox-simulator?workspace=triage');
    renderPage();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(spies.sendersScreen).not.toHaveBeenCalled();
  });
});
