/**
 * The public Senders demo, driven through the product's own UI.
 *
 * Every test here clicks what a visitor clicks: the real rows, the real
 * preview, the real Undo bar. The sample mailbox behind them is
 * `demo-backend.ts`. Three guarantees are checked after EVERY test:
 *
 *   - nothing reached the network (`fetch` was never called),
 *   - nothing opened a window,
 *   - the sample mailbox answered every request the screen made.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as PosthogModule from '@/lib/posthog';

import type * as DemoBackendModule from './demo-backend';
import type { DemoBackend } from './demo-backend';

const h = vi.hoisted(() => ({
  backends: [] as DemoBackend[],
  narrow: false,
  gates: [] as Array<((eventName: string, props: unknown) => boolean) | null>,
}));

vi.mock('next/navigation', async () =>
  (await import('@/test/next-navigation-url')).nextNavigationUrlMock(),
);
// Same backend, shorter jobs, and a handle on it for the guarantees above.
vi.mock('./demo-backend', async (importOriginal) => {
  const actual = await importOriginal<typeof DemoBackendModule>();
  return {
    ...actual,
    createDemoBackend: () => {
      const backend = actual.createDemoBackend({ jobMs: 50 });
      h.backends.push(backend);
      return backend;
    },
  };
});
vi.mock('@/lib/posthog', async (importOriginal) => {
  const actual = await importOriginal<typeof PosthogModule>();
  return {
    ...actual,
    setTrackGate: (gate: ((eventName: string, props: unknown) => boolean) | null) => {
      h.gates.push(gate);
      actual.setTrackGate(gate as Parameters<typeof actual.setTrackGate>[0]);
    },
  };
});

import { testRouter } from '@/test/next-navigation-url';
import { apiGet } from '@/lib/api/client';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';
import { SendersDemo } from './senders-demo';

const WAIT = { timeout: 8_000 };
let fetchSpy: ReturnType<typeof vi.spyOn>;
let openSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  h.backends.length = 0;
  h.gates.length = 0;
  h.narrow = false;
  localStorage.clear();
  sessionStorage.clear();
  window.history.pushState({}, '', '/inbox-simulator?workspace=senders');
  testRouter.push.mockClear();
  testRouter.replace.mockClear();
  fetchSpy = vi.spyOn(globalThis, 'fetch');
  openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: h.narrow && /max-width: 7\d\dpx/.test(query),
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList,
  );
});

afterEach(() => {
  // The demo's standing guarantees — see the file header.
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(openSpy).not.toHaveBeenCalled();
  expect(h.backends.length).toBeGreaterThan(0);
  for (const backend of h.backends) expect(backend.unhandled).toEqual([]);
  // The demo keeps its own cache: sample senders never enter the page's.
  expect(pageClient.getQueryCache().getAll()).toEqual([]);
  expect(pageClient.getMutationCache().getAll()).toEqual([]);
  // Brand logos load as CSS backgrounds from the real API, which no `fetch`
  // spy sees. The sample senders are made up, so none may be requested.
  expect(document.body.innerHTML).not.toContain('/api/icons/');
  vi.restoreAllMocks();
});

/** Stands in for the page's own cache, which the root layout provides. */
let pageClient: QueryClient;

async function renderDemo() {
  pageClient = createTestQueryClient();
  const view = render(
    <QueryWrapper client={pageClient}>
      <SendersDemo />
    </QueryWrapper>,
  );
  await screen.findByText('Northstar Weekly', {}, WAIT);
  return view;
}

/** The list row for one sender: its checkbox's row container. */
function row(name: string): HTMLElement {
  const menu = screen.getByRole('button', { name: `More actions for ${name}` });
  let node: HTMLElement | null = menu;
  while (node && !/in inbox/.test(node.textContent ?? '')) node = node.parentElement;
  if (!node) throw new Error(`No row for ${name}`);
  return node;
}

async function openVerb(name: string, verb: string): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole('button', { name: `More actions for ${name}` }));
  fireEvent.click(await screen.findByRole('menuitem', { name: new RegExp(`^${verb}`) }));
  const dialog = await screen.findByRole('dialog', {}, WAIT);
  // The preview counts arrive after the sheet opens; confirm waits for them.
  await waitFor(() => expect(dialog).not.toHaveTextContent(/Counting|Loading/), WAIT);
  return dialog;
}

describe('SendersDemo', () => {
  it('renders the product list from the sample mailbox', async () => {
    await renderDemo();
    expect(screen.getByRole('heading', { level: 1, name: 'Senders' })).toBeInTheDocument();
    expect(screen.getByTestId('senders-hero')).toHaveTextContent('8 active senders');
    expect(row('Northstar Weekly')).toHaveTextContent('111 in inbox');
    expect(row('Northstar Weekly')).toHaveTextContent('162 archived');
    // Dormant and quiet senders sit behind the product's own default filter.
    expect(screen.queryByText('Catalog Club')).not.toBeInTheDocument();
  });

  it('archives one sender after a preview, and Undo puts the email back', async () => {
    await renderDemo();
    const dialog = await openVerb('Northstar Weekly', 'Archive');
    expect(dialog).toHaveTextContent('111 emails will leave your inbox and stay in Gmail.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Archive' }));

    await waitFor(() => expect(row('Northstar Weekly')).toHaveTextContent('0 in inbox'), WAIT);
    expect(row('Northstar Weekly')).toHaveTextContent('273 archived');

    fireEvent.click(
      await screen.findByRole('button', { name: 'Undo Archive for Northstar Weekly' }, WAIT),
    );
    await waitFor(() => expect(row('Northstar Weekly')).toHaveTextContent('111 in inbox'), WAIT);
    expect(row('Northstar Weekly')).toHaveTextContent('162 archived');
  });

  it('Unsubscribe + Delete counts follow the email age and the archived-email choice', async () => {
    await renderDemo();
    const dialog = await openVerb('Northstar Weekly', 'Unsubscribe');
    fireEvent.click(within(dialog).getByRole('radio', { name: '+ Delete' }));
    const age = within(dialog).getByRole('combobox', { name: 'Email age' });
    fireEvent.change(age, { target: { value: 'all' } });
    await waitFor(() => expect(dialog).toHaveTextContent('111 emails'));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Include archived email' }));
    await waitFor(() => expect(dialog).toHaveTextContent('273 emails'));
    fireEvent.change(age, { target: { value: '180' } });
    await waitFor(() => expect(dialog).toHaveTextContent('155 emails'));

    fireEvent.click(within(dialog).getByRole('button', { name: /^Unsubscribe \+ Delete/ }));
    // 45 of 111 inbox emails and 110 of 162 archived are at least 180 days old.
    await waitFor(() => expect(row('Northstar Weekly')).toHaveTextContent('66 in inbox'), WAIT);
    expect(row('Northstar Weekly')).toHaveTextContent('52 archived');
  });

  it('previews a bulk Archive without the Protected senders, and leaves them alone', async () => {
    await renderDemo();
    fireEvent.click(screen.getByRole('button', { name: 'Select 8 shown' }));
    fireEvent.click(
      await screen.findByRole('button', { name: /^Archive 6 of 8 selected senders/ }),
    );
    const dialog = await screen.findByRole('dialog', {}, WAIT);
    // 467 = every selected sender's inbox email except the two Protected ones.
    await waitFor(() => expect(dialog).toHaveTextContent('467'), WAIT);
    expect(dialog).toHaveTextContent(/Protected/);
    fireEvent.click(within(dialog).getByRole('button', { name: /^Archive/ }));

    await waitFor(() => expect(row('Market Finds')).toHaveTextContent('0 in inbox'), WAIT);
    expect(row('Parcel Receipts')).toHaveTextContent('15 in inbox');
    expect(row('Maya Okafor')).toHaveTextContent('11 in inbox');

    // One Undo for the whole decision.
    fireEvent.click(
      await screen.findByRole('button', { name: 'Undo Archive for Market Finds + 5 others' }, WAIT),
    );
    await waitFor(() => expect(row('Market Finds')).toHaveTextContent('191 in inbox'), WAIT);
    expect(row('Cedar Bank Alerts')).toHaveTextContent('19 in inbox');
  });

  it('asks before acting on a Protected sender', async () => {
    await renderDemo();
    const dialog = await openVerb('Parcel Receipts', 'Delete');
    expect(dialog).toHaveTextContent(/Protected/);
    expect(within(dialog).getByRole('button', { name: /anyway/i })).toBeInTheDocument();
  });

  it('keeps its filters in the page URL beside the simulator’s own param', async () => {
    await renderDemo();
    fireEvent.click(screen.getByRole('button', { name: 'Mail in Inbox' }));
    await waitFor(() => expect(window.location.search).toContain('has_inbox_mail=true'));
    expect(new URLSearchParams(window.location.search).get('workspace')).toBe('senders');
    expect(window.location.pathname).toBe('/inbox-simulator');
  });

  it('searches the whole sample mailbox, past the active-only default', async () => {
    await renderDemo();
    fireEvent.change(screen.getByRole('combobox', { name: /search/i }), {
      target: { value: 'catalog' },
    });
    // The typeahead finds a dormant sender the default list leaves out.
    const option = await screen.findByRole('option', { name: /Catalog Club.*dormant/ }, WAIT);
    // The dropdown's avatar must not ask the real API for this made-up domain's logo.
    expect(option.innerHTML).not.toContain('/api/icons/');
    fireEvent.click(option);
    await waitFor(() => expect(row('Catalog Club')).toHaveTextContent('24 in inbox'), WAIT);
    expect(new URLSearchParams(window.location.search).get('q')).toBe('Catalog Club');
  });

  it('opens a sender beside the list, and Back closes it', async () => {
    await renderDemo();
    fireEvent.click(screen.getByText('Northstar Weekly'));
    expect(await screen.findByTestId('sender-detail-pane', {}, WAIT)).toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get('sender')).toBe('northstar');
    expect(new URLSearchParams(window.location.search).get('workspace')).toBe('senders');

    await act(async () => {
      window.history.back();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    await waitFor(() => expect(screen.queryByTestId('sender-detail-pane')).not.toBeInTheDocument());
  });

  it('opens a sender in place on a narrow screen instead of leaving for /senders/<id>', async () => {
    h.narrow = true;
    await renderDemo();
    fireEvent.click(screen.getByText('Northstar Weekly'));
    // The product's own detail page, on this URL.
    const back = await screen.findByRole('link', { name: /Back to Senders/ }, WAIT);
    expect(window.location.pathname).toBe('/inbox-simulator');
    expect(new URLSearchParams(window.location.search).get('sender')).toBe('northstar');
    expect(testRouter.push).not.toHaveBeenCalled();
    expect(testRouter.replace).not.toHaveBeenCalled();

    // "Back to Senders" points at the signed-in list; here it returns to the demo list.
    expect(fireEvent.click(back)).toBe(false);
    await waitFor(() =>
      expect(new URLSearchParams(window.location.search).has('sender')).toBe(false),
    );
    expect(await screen.findByTestId('senders-hero', {}, WAIT)).toBeInTheDocument();
  });

  it('answers a link to a signed-in page with a note instead of a sign-in wall', async () => {
    await renderDemo();
    fireEvent.click(screen.getByText('Northstar Weekly'));
    const pane = await screen.findByTestId('sender-detail-pane', {}, WAIT);
    const fullPage = within(pane).getByRole('link', { name: 'Open full page' });
    expect(fullPage.getAttribute('href')).toMatch(/^\/senders\/northstar/);
    const before = window.location.href;
    expect(fireEvent.click(fullPage)).toBe(false);
    expect(
      await screen.findByText('This opens in the app after you connect Gmail.'),
    ).toBeInTheDocument();
    expect(window.location.href).toBe(before);
  });

  it('shows the Inbox Report, and Review senders starts a guided review of them', async () => {
    await renderDemo();
    fireEvent.click(await screen.findByRole('button', { name: 'Review senders' }, WAIT));
    // The report names Market Finds; the product's guided card re-reads it.
    expect(await screen.findByText('Selected senders', {}, WAIT)).toBeInTheDocument();
    await waitFor(
      () =>
        expect(document.body).toHaveTextContent(
          /Selected senders.*Market Finds.*191 emails in Inbox/,
        ),
      WAIT,
    );
    fireEvent.click(screen.getByRole('button', { name: /Back to Senders/ }));
    expect(await screen.findByTestId('senders-hero', {}, WAIT)).toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).has('review')).toBe(false);
  });

  it('runs the product’s suggested Guided Review from Start guided review', async () => {
    await renderDemo();
    fireEvent.click(screen.getByRole('button', { name: 'Start guided review' }));
    expect(await screen.findByText('Suggested senders', {}, WAIT)).toBeInTheDocument();
    expect(await screen.findByText(/Now deciding Market Finds/, {}, WAIT)).toBeInTheDocument();
  });

  it('Keep sticks, Later takes email out of the inbox, and a mailto unsubscribe stays manual', async () => {
    await renderDemo();
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Trail Journal' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /^Keep/ }));
    await waitFor(() => expect(row('Trail Journal')).toHaveTextContent('Kept'), WAIT);
    expect(row('Trail Journal')).toHaveTextContent('40 in inbox');

    const later = await openVerb('Loop Fitness', 'Later');
    expect(later).toHaveTextContent('58 emails will move to Gmail’s DeclutrMail/Later label.');
    fireEvent.click(within(later).getByRole('button', { name: 'Later' }));
    await waitFor(() => expect(row('Loop Fitness')).toHaveTextContent('0 in inbox'), WAIT);

    const mailto = await openVerb('Harbor Forum Digest', 'Unsubscribe');
    expect(mailto).toHaveTextContent('we’ll open a prefilled email in Gmail for you to send');
    fireEvent.click(within(mailto).getByRole('radio', { name: 'Unsubscribe only' }));
    fireEvent.click(within(mailto).getByRole('button', { name: /^Unsubscribe/ }));
    const gmail = await screen.findByRole('link', { name: /Open email in Gmail/ }, WAIT);
    // No Gmail behind the sample inbox: the link says so and goes nowhere.
    expect(fireEvent.click(gmail)).toBe(false);
    expect(
      await screen.findByText('Sample inbox: there is no Gmail email to open.'),
    ).toBeInTheDocument();
    expect(row('Harbor Forum Digest')).toHaveTextContent('48 in inbox');
  });

  it('holds back product analytics while mounted and hands requests back on unmount', async () => {
    const view = await renderDemo();
    const gate = h.gates.at(-1);
    expect(gate).toBeTypeOf('function');
    // What the app screens report for a signed-in user: all held back.
    for (const name of [
      'action_confirmed',
      'bulk_action_taken',
      'undo_clicked',
      'sender_detail_opened',
      'unsub_backlog_confirmed',
      'upgrade_prompt_shown',
    ]) {
      expect(gate!(name, {})).toBe(false);
    }
    expect(gate!('page_viewed', { page: 'senders', mailbox_id: null })).toBe(false);
    // The public page's own analytics are untouched.
    expect(gate!('page_viewed', { page: 'inbox_simulator', mailbox_id: null })).toBe(true);
    expect(gate!('landing_cta_clicked', {})).toBe(true);
    expect(gate!('demo_reset', {})).toBe(true);

    view.unmount();
    expect(h.gates.at(-1)).toBeNull();
    // With the demo gone the client talks to the network again.
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ data: null }), { status: 200 }));
    await apiGet('/api/senders/summary');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    fetchSpy.mockClear();
  });
});
