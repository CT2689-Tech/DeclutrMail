import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFetchStub, jsonOk, resetFetchStub } from '@/test/fetch-stub';
import { useExplainReasons, type ExplainableRead } from './use-explain-reasons';

/**
 * Explanations are bought on demand (D24, founder decision 2026-09-25): a
 * reason is the deterministic template until someone is about to read it.
 * A surface that shows template reasons asks for their sentences, shows
 * the template meanwhile, and picks the sentences up when they land.
 */
const KEY = ['triage', 'queue'] as const;

function Harness({
  reads,
  showing,
  enabled,
  exact,
  settleMs = [10, 30],
}: {
  reads: ExplainableRead[];
  showing?: ExplainableRead[];
  enabled?: boolean;
  exact?: boolean;
  settleMs?: number[];
}) {
  useExplainReasons(reads, {
    invalidate: KEY,
    settleMs,
    ...(showing === undefined ? {} : { showing }),
    ...(enabled === undefined ? {} : { enabled }),
    ...(exact === undefined ? {} : { exact }),
  });
  return null;
}

/** A second look far enough out that a test can act between the two. */
const WIDE = [10, 250];

function renderHarness(reads: ExplainableRead[], enabled?: boolean, settleMs?: number[]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidated = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const view = render(
    <Harness
      reads={reads}
      {...(enabled === undefined ? {} : { enabled })}
      {...(settleMs ? { settleMs } : {})}
    />,
    { wrapper },
  );
  return { ...view, invalidated };
}

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

function renderHarness2(props: { reads: ExplainableRead[]; showing: ExplainableRead[] }) {
  const client = new QueryClient();
  const invalidated = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { ...render(<Harness {...props} />, { wrapper }), invalidated };
}

const template = (senderId: string, scoredAt = '2026-09-25T08:30:00.000Z'): ExplainableRead => ({
  senderId,
  generatedBy: 'template',
  scoredAt,
});

let posted: Array<{ senderIds: string[] }>;

beforeEach(() => {
  posted = [];
  installFetchStub([
    {
      method: 'POST',
      path: '/api/triage/explain',
      respond: async (req: Request) => {
        const body = (await req.json()) as { senderIds: string[] };
        posted.push(body);
        return jsonOk({ data: { queued: body.senderIds } });
      },
    },
  ]);
});

afterEach(() => {
  resetFetchStub();
  vi.restoreAllMocks();
});

describe('useExplainReasons', () => {
  it('asks once, in one request, for every reason still on the template', async () => {
    renderHarness([
      template('s-template'),
      { senderId: 's-prose', generatedBy: 'llm_haiku', scoredAt: 't' },
      // An API that predates the field says nothing about provenance —
      // no claim, so no ask.
      { senderId: 's-unknown', scoredAt: 't' },
      template('s-template-2'),
    ]);

    await waitFor(() => expect(posted).toHaveLength(1));
    expect([...posted[0]!.senderIds].sort()).toEqual(['s-template', 's-template-2']);
  });

  it('asks again after a failed ask, once the rows it is given change', async () => {
    let fail = true;
    installFetchStub([
      {
        method: 'POST',
        path: '/api/triage/explain',
        respond: async (req: Request) => {
          const body = (await req.json()) as { senderIds: string[] };
          posted.push(body);
          if (fail) {
            return new Response(JSON.stringify({ error: { code: 'INTERNAL' } }), {
              status: 500,
              headers: { 'content-type': 'application/json' },
            });
          }
          return jsonOk({ data: { queued: body.senderIds } });
        },
      },
    ]);
    const { rerender } = renderHarness([template('s-1')]);
    await waitFor(() => expect(posted).toHaveLength(1));
    await tick(20);
    fail = false;

    rerender(<Harness reads={[template('s-1'), template('s-2')]} />);

    await waitFor(() => expect(posted).toHaveLength(2));
    expect([...posted[1]!.senderIds].sort()).toEqual(['s-1', 's-2']);
  });

  it('re-reads only the exact query when told to — not its children', async () => {
    const client = new QueryClient();
    const invalidated = vi.spyOn(client, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    render(<Harness reads={[template('s-1')]} exact />, { wrapper });

    await waitFor(() => expect(invalidated).toHaveBeenCalled());
    expect(invalidated).toHaveBeenCalledWith({ queryKey: KEY, exact: true });
  });

  it('does not ask twice for the same row version — re-render, remount or another surface', async () => {
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const first = render(<Harness reads={[template('s-1')]} />, { wrapper });
    await waitFor(() => expect(posted).toHaveLength(1));
    first.rerender(<Harness reads={[template('s-1')]} />);
    first.unmount();
    // Same tab (same client): the Triage row and its action sheet, or a
    // sender reopened from the list, are one ask.
    render(<Harness reads={[template('s-1')]} />, { wrapper });

    await tick(40);
    expect(posted).toHaveLength(1);
  });

  it('asks again once the row has been re-scored — a new version needs its own sentence', async () => {
    const view = renderHarness([template('s-1', '2026-09-25T08:30:00.000Z')]);
    await waitFor(() => expect(posted).toHaveLength(1));

    view.rerender(<Harness reads={[template('s-1', '2026-09-26T09:00:00.000Z')]} />);

    await waitFor(() => expect(posted).toHaveLength(2));
    expect(posted[1]!.senderIds).toEqual(['s-1']);
  });

  it('looks again while an asked-for reason is still the template, then stops', async () => {
    const { invalidated } = renderHarness([template('s-1')]);

    // Two looks on the settle schedule — and no polling beyond it: a row
    // whose sentence never comes keeps its template, which is a correct
    // explanation.
    await waitFor(() => expect(invalidated).toHaveBeenCalledTimes(2));
    await tick(60);
    expect(invalidated).toHaveBeenCalledTimes(2);
    expect(invalidated).toHaveBeenCalledWith({ queryKey: KEY });
  });

  it('stops looking once the sentence has landed', async () => {
    const { invalidated, rerender } = renderHarness([template('s-1')], undefined, WIDE);
    await waitFor(() => expect(invalidated).toHaveBeenCalledTimes(1));

    rerender(
      <Harness
        reads={[{ senderId: 's-1', generatedBy: 'llm_haiku', scoredAt: 't' }]}
        settleMs={WIDE}
      />,
    );

    await tick(350);
    expect(invalidated).toHaveBeenCalledTimes(1);
  });

  it('keeps looking for the reasons still pending when only some have landed', async () => {
    const { invalidated, rerender } = renderHarness(
      [template('s-1'), template('s-2')],
      undefined,
      WIDE,
    );
    await waitFor(() => expect(invalidated).toHaveBeenCalledTimes(1));

    rerender(
      <Harness
        reads={[{ senderId: 's-1', generatedBy: 'llm_haiku', scoredAt: 't' }, template('s-2')]}
        settleMs={WIDE}
      />,
    );

    // The pending set changed, so the schedule restarts for what remains.
    await waitFor(() => expect(invalidated.mock.calls.length).toBeGreaterThanOrEqual(3));
    expect(posted).toHaveLength(1);
  });

  /**
   * Triage asks for its whole queue but shows one reason at a time. Only
   * what is on screen is worth a refetch; the rest is picked up by the
   * reads the queue already makes after every decision.
   */
  it('asks for rows it is not showing, without looking again for them', async () => {
    const { invalidated } = renderHarness2({ reads: [template('s-1')], showing: [] });

    await waitFor(() => expect(posted).toHaveLength(1));
    await tick(60);
    expect(invalidated).not.toHaveBeenCalled();
  });

  it('looks at once when a row asked about earlier is opened — its sentence has likely landed', async () => {
    const { invalidated, rerender } = renderHarness2({ reads: [template('s-1')], showing: [] });
    await waitFor(() => expect(posted).toHaveLength(1));
    // Both looks on the schedule are already overdue by the time it opens.
    await tick(50);

    rerender(<Harness reads={[template('s-1')]} showing={[template('s-1')]} />);

    await waitFor(() => expect(invalidated).toHaveBeenCalledTimes(1));
    await tick(60);
    expect(invalidated).toHaveBeenCalledTimes(1);
    expect(posted).toHaveLength(1);
  });

  it('splits a long list into requests the endpoint accepts', async () => {
    renderHarness(Array.from({ length: 13 }, (_, i) => template(`s-${i}`)));

    await waitFor(() => expect(posted).toHaveLength(2));
    expect(posted.map((p) => p.senderIds.length).sort((a, b) => a - b)).toEqual([1, 12]);
  });

  it('asks for nothing while disabled', async () => {
    renderHarness([template('s-1')], false);

    await tick(40);
    expect(posted).toHaveLength(0);
  });

  /**
   * "Silent" is checked where it can fail: the request must actually have
   * been made and refused — otherwise nothing here exercised the failure —
   * and vitest itself fails the run on an unhandled rejection, which a
   * missing `.catch` would produce. (A `window` `unhandledrejection`
   * listener cannot: jsdom does not fire it for native promises.)
   */
  it('stays silent when the request fails — the template still reads correctly', async () => {
    let refused = 0;
    installFetchStub([
      {
        method: 'POST',
        path: '/api/triage/explain',
        respond: () => {
          refused += 1;
          return new Response(JSON.stringify({ error: { code: 'RATE_LIMITED' } }), {
            status: 429,
            headers: { 'content-type': 'application/json' },
          });
        },
      },
    ]);

    expect(() => renderHarness([template('s-1')])).not.toThrow();

    await waitFor(() => expect(refused).toBe(1));
    await tick(40);
  });
});
