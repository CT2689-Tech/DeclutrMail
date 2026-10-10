import { act, fireEvent, render, screen } from '@testing-library/react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { installFetchStub, resetFetchStub } from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';
import type { SnoozedSenderRow } from '@/lib/api/snoozed';
import { AuthProvider } from '@/features/auth/auth-provider';
import { ME_QUERY_KEY } from '@/features/auth/api/use-me';
import { snoozedKeys } from './api/query-keys';
import { SnoozedScreen } from './snoozed-screen';

vi.mock('@/features/auth/api/use-me', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useUserTimeZone: () => 'America/Los_Angeles',
}));

const BEFORE_MIDNIGHT = Date.parse('2026-10-04T06:59:40Z');
const ROW: SnoozedSenderRow = {
  senderId: '6f1f2f3a-0000-4000-8000-000000000001',
  displayName: 'Synthetic Digest',
  email: 'digest@synthetic.test',
  domain: 'synthetic.test',
  laterCount: 12,
  snoozedUntil: '2026-10-04T16:00:00Z',
  snoozedAt: '2026-10-03T16:00:00Z',
  reason: null,
  returnStatus: 'scheduled',
  lastReturnAttemptAt: null,
  returnFailureKind: null,
};

function cachedClient() {
  const client = createTestQueryClient();
  client.setDefaultOptions({ queries: { retry: false, staleTime: Infinity, gcTime: Infinity } });
  client.setQueryData(snoozedKeys.list(), { data: [ROW] });
  return client;
}

afterEach(() => {
  resetFetchStub();
  vi.useRealTimers();
});

describe('Later account calendar clock', () => {
  it('updates both the bucket and return label with unchanged cached rows', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(BEFORE_MIDNIGHT);
    // Leave the existing refresh pending: a calendar change must not need new data.
    installFetchStub([
      { method: 'GET', path: '/api/snoozed', respond: () => new Promise<Response>(() => {}) },
    ]);
    const client = cachedClient();
    const original = client.getQueryData(snoozedKeys.list());
    const view = render(
      <QueryWrapper client={client}>
        <SnoozedScreen />
      </QueryWrapper>,
    );
    try {
      expect(screen.getByRole('heading', { name: /Tomorrow/ })).toBeInTheDocument();
      expect(screen.getByText(/Returns Tomorrow/)).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(screen.getByRole('heading', { name: /Later today/ })).toBeInTheDocument();
      expect(screen.getByText(/Returns Today/)).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: /Tomorrow/ })).not.toBeInTheDocument();
      expect(client.getQueryData(snoozedKeys.list())).toBe(original);
    } finally {
      view.unmount();
      client.clear();
    }
  });

  it('keeps server markup consistent when hydration crosses account midnight', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(BEFORE_MIDNIGHT);
    installFetchStub([]);
    const client = cachedClient();
    const tree = (
      <QueryWrapper client={client}>
        <SnoozedScreen {...{ initialNow: BEFORE_MIDNIGHT }} />
      </QueryWrapper>
    );
    const container = document.createElement('div');
    container.innerHTML = renderToString(tree);
    expect(container.textContent).toContain('Returns Tomorrow');
    vi.setSystemTime(BEFORE_MIDNIGHT + 60_000);
    const errors: unknown[] = [];
    let root: Root | undefined;
    try {
      await act(async () => {
        root = hydrateRoot(container, tree, { onRecoverableError: (error) => errors.push(error) });
      });
      expect(errors).toEqual([]);
      expect(container.textContent).toContain('Returns Today');
      expect(container.textContent).toContain('Later today');
    } finally {
      await act(async () => root?.unmount());
      client.clear();
    }
  });

  it('refreshes Tomorrow in an already open return-time menu', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(BEFORE_MIDNIGHT);
    let submittedUntil: unknown;
    installFetchStub([
      { method: 'GET', path: '/api/snoozed', respond: () => new Promise<Response>(() => {}) },
      {
        method: 'PATCH',
        path: `/api/snoozed/${ROW.senderId}`,
        respond: async (request) => {
          submittedUntil = ((await request.json()) as { until: string }).until;
          return new Response(JSON.stringify({ data: {} }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        },
      },
    ]);
    const client = cachedClient();
    const view = render(
      <QueryWrapper client={client}>
        <SnoozedScreen />
      </QueryWrapper>,
    );
    try {
      fireEvent.click(screen.getByRole('button', { name: /Change return time/ }));
      const note = screen.getByPlaceholderText('Note (optional)');
      const custom = screen.getByLabelText('Custom · America/Los Angeles');
      fireEvent.change(note, { target: { value: 'read after the weekend' } });
      fireEvent.change(custom, { target: { value: '2026-10-05T10:00' } });
      note.focus();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(screen.getByPlaceholderText('Note (optional)')).toBe(note);
      expect(note).toHaveValue('read after the weekend');
      expect(custom).toHaveValue('2026-10-05T10:00');
      expect(note).toHaveFocus();
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Tomorrow/ }));
      });
      expect(submittedUntil).toBe('2026-10-05T16:00:00.000Z');
    } finally {
      view.unmount();
      client.clear();
    }
  });
  it('retains the pending save and its failure after regrouping', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(BEFORE_MIDNIGHT);
    let finish: (response: Response) => void = () => {
      throw new Error('Save not started');
    };
    const pending = new Promise<Response>((resolve) => {
      finish = resolve;
    });
    installFetchStub([
      {
        method: 'GET',
        path: '/api/snoozed',
        respond: () =>
          new Response(JSON.stringify({ data: [ROW] }), {
            headers: { 'content-type': 'application/json' },
          }),
      },
      { method: 'PATCH', path: `/api/snoozed/${ROW.senderId}`, respond: () => pending },
    ]);
    const client = cachedClient();
    const view = render(
      <QueryWrapper client={client}>
        <SnoozedScreen />
      </QueryWrapper>,
    );
    try {
      fireEvent.click(screen.getByRole('button', { name: /Change return time/ }));
      const note = screen.getByPlaceholderText('Note (optional)');
      fireEvent.change(note, { target: { value: 'keep this draft' } });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Tomorrow/ }));
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(screen.getByRole('button', { name: /Tomorrow/ })).toBeDisabled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(screen.getByRole('heading', { name: /Later today/ })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Tomorrow/ })).toBeDisabled();
      await act(async () => {
        finish(
          new Response(JSON.stringify({ message: 'unavailable' }), {
            status: 503,
            headers: { 'content-type': 'application/json' },
          }),
        );
        await vi.advanceTimersByTimeAsync(1);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      expect(screen.getByRole('alert')).toHaveTextContent(/update the return time/);
      expect(screen.getByPlaceholderText('Note (optional)')).toBe(note);
      expect(note).toHaveValue('keep this draft');
      expect(screen.getByRole('button', { name: /Tomorrow/ })).toBeEnabled();
    } finally {
      view.unmount();
      client.clear();
    }
  });

  it('retains an in-flight wake callback when its row moves buckets', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(BEFORE_MIDNIGHT);
    let finish: (response: Response) => void = () => {
      throw new Error('Wake not started');
    };
    const pending = new Promise<Response>((resolve) => {
      finish = resolve;
    });
    installFetchStub([
      {
        method: 'GET',
        path: '/api/snoozed',
        respond: () =>
          new Response(JSON.stringify({ data: [ROW] }), {
            headers: { 'content-type': 'application/json' },
          }),
      },
      { method: 'POST', path: `/api/snoozed/${ROW.senderId}/wake`, respond: () => pending },
    ]);
    const client = cachedClient();
    const view = render(
      <QueryWrapper client={client}>
        <SnoozedScreen />
      </QueryWrapper>,
    );
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Bring back now' }));
      await act(async () => {
        fireEvent.click(screen.getAllByRole('button', { name: 'Bring back now' }).at(-1)!);
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(screen.getByRole('button', { name: 'Starting…' })).toBeDisabled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(screen.getByRole('button', { name: 'Starting…' })).toBeDisabled();
      await act(async () => {
        finish(
          new Response(JSON.stringify({ data: { senderId: ROW.senderId, status: 'queued' } }), {
            status: 201,
            headers: { 'content-type': 'application/json' },
          }),
        );
        await vi.advanceTimersByTimeAsync(1);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      expect(screen.getByText('Bringing back…')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Starting…' })).not.toBeInTheDocument();
    } finally {
      view.unmount();
      client.clear();
    }
  });
  it('discards an open draft when the active account switches', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(BEFORE_MIDNIGHT);
    const client = cachedClient();
    const me = {
      user: {
        id: 'u1',
        email: 'user@synthetic.test',
        workspaceId: 'w1',
        timezone: 'America/Los_Angeles',
      },
      mailboxes: [],
      activeMailboxId: 'mailbox-a',
      tier: 'pro',
      cleanupRemaining: 42,
    };
    client.setQueryData(ME_QUERY_KEY, me);
    installFetchStub([]);
    const view = render(
      <QueryWrapper client={client}>
        <AuthProvider>
          <SnoozedScreen />
        </AuthProvider>
      </QueryWrapper>,
    );
    try {
      fireEvent.click(screen.getByRole('button', { name: /Change return time/ }));
      fireEvent.change(screen.getByPlaceholderText('Note (optional)'), {
        target: { value: 'account A draft' },
      });
      await act(async () => {
        client.setQueryData(ME_QUERY_KEY, { ...me, activeMailboxId: 'mailbox-b' });
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(screen.queryByPlaceholderText('Note (optional)')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /Change return time/ }));
      expect(screen.getByPlaceholderText('Note (optional)')).toHaveValue('');
    } finally {
      view.unmount();
      client.clear();
    }
  });
  it('resolves Tomorrow at the click time before the next minute tick', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(BEFORE_MIDNIGHT);
    let until: unknown;
    installFetchStub([
      {
        method: 'PATCH',
        path: `/api/snoozed/${ROW.senderId}`,
        respond: async (request) => {
          until = ((await request.json()) as { until: string }).until;
          return new Response(JSON.stringify({ data: {} }), {
            headers: { 'content-type': 'application/json' },
          });
        },
      },
    ]);
    const client = cachedClient();
    const view = render(
      <QueryWrapper client={client}>
        <SnoozedScreen />
      </QueryWrapper>,
    );
    try {
      fireEvent.click(screen.getByRole('button', { name: /Change return time/ }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Tomorrow/ }));
      });
      expect(until).toBe('2026-10-05T16:00:00.000Z');
    } finally {
      view.unmount();
      client.clear();
    }
  });

  it('rejects an expired Later today preset before the next clock tick', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-10-03T23:59:40Z'));
    const mutation = vi.fn(
      () =>
        new Response(JSON.stringify({ data: {} }), {
          headers: { 'content-type': 'application/json' },
        }),
    );
    installFetchStub([
      { method: 'PATCH', path: `/api/snoozed/${ROW.senderId}`, respond: mutation },
    ]);
    const client = cachedClient();
    const view = render(
      <QueryWrapper client={client}>
        <SnoozedScreen />
      </QueryWrapper>,
    );
    try {
      fireEvent.click(screen.getByRole('button', { name: /Change return time/ }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Later today/ }));
      });
      expect(mutation).not.toHaveBeenCalled();
      expect(screen.getByRole('alert')).toHaveTextContent(/Choose another/);
    } finally {
      view.unmount();
      client.clear();
    }
  });
  it.each([
    {
      wallTime: '2026-10-04T00:00',
      expectedUntil: '2026-10-04T07:00:00.000Z',
      expiresBeforeNextTick: true,
    },
    {
      wallTime: '2026-10-04T01:00',
      expectedUntil: '2026-10-04T08:00:00.000Z',
      expiresBeforeNextTick: false,
    },
  ])(
    'validates account custom time at submission ($wallTime)',
    async ({ wallTime, expectedUntil, expiresBeforeNextTick }) => {
      vi.useFakeTimers();
      vi.setSystemTime(BEFORE_MIDNIGHT);
      let submittedUntil: unknown;
      const mutation = vi.fn(async (request: Request) => {
        submittedUntil = ((await request.json()) as { until: string }).until;
        return new Response(JSON.stringify({ data: {} }), {
          headers: { 'content-type': 'application/json' },
        });
      });
      installFetchStub([
        { method: 'PATCH', path: `/api/snoozed/${ROW.senderId}`, respond: mutation },
      ]);
      const client = cachedClient();
      const view = render(
        <QueryWrapper client={client}>
          <SnoozedScreen />
        </QueryWrapper>,
      );
      try {
        fireEvent.click(screen.getByRole('button', { name: /Change return time/ }));
        fireEvent.change(screen.getByLabelText('Custom · America/Los Angeles'), {
          target: { value: wallTime },
        });
        expect(screen.getByRole('button', { name: 'Set' })).toBeEnabled();
        await act(async () => {
          await vi.advanceTimersByTimeAsync(30_000);
        });
        await act(async () => {
          fireEvent.click(screen.getByRole('button', { name: 'Set' }));
        });
        if (expiresBeforeNextTick) {
          expect(mutation).not.toHaveBeenCalled();
          expect(screen.getByRole('alert')).toHaveTextContent(/Choose another/);
        } else {
          expect(mutation).toHaveBeenCalledTimes(1);
          expect(submittedUntil).toBe(expectedUntil);
        }
      } finally {
        view.unmount();
        client.clear();
      }
    },
  );
});
