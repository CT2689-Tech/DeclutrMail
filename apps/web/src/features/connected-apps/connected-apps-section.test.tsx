import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ConnectedApp } from '@declutrmail/shared/contracts';

import { ApiError } from '@/lib/api/client';
import { installFetchStub, jsonNotFound, jsonOk, jsonServerError } from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';

import { ConnectedAppsGroup, ConnectedAppsSection } from './connected-apps-section';
import { isConnectorUnavailable } from './api/use-connected-apps';
import { SCOPE_LABEL } from './scope-copy';

const h = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('@declutrmail/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  toast: h.toast,
}));
vi.mock('@/features/auth/api/use-me', () => ({ useUserTimeZone: () => 'UTC' }));

const CLAUDE: ConnectedApp = {
  id: '11111111-1111-4111-8111-111111111111',
  appName: 'Claude',
  scopes: ['cleanup', 'read'],
  connectedAt: '2026-11-02T10:00:00.000Z',
  lastUsedAt: '2026-11-16T08:30:00.000Z',
};
const UNNAMED: ConnectedApp = {
  id: '22222222-2222-4222-8222-222222222222',
  appName: null,
  scopes: ['read'],
  connectedAt: '2026-11-10T10:00:00.000Z',
  lastUsedAt: null,
};

function renderSection(handlers: Parameters<typeof installFetchStub>[0]) {
  installFetchStub(handlers);
  return render(
    <QueryWrapper client={createTestQueryClient()}>
      <ConnectedAppsSection />
    </QueryWrapper>,
  );
}

const list = (apps: ConnectedApp[]) => ({
  method: 'GET' as const,
  path: '/api/oauth/grants',
  respond: () => jsonOk({ data: { apps } }),
});

afterEach(() => h.toast.mockClear());

describe('ConnectedAppsGroup', () => {
  const noop = () => {};

  it('names each app, what it may do, when it connected and when it was last used', () => {
    render(
      <ConnectedAppsGroup
        state={{ kind: 'ready', apps: [CLAUDE, UNNAMED] }}
        timeZone="UTC"
        pendingId={null}
        failedAppName={null}
        onDisconnect={noop}
      />,
    );
    const group = screen.getByTestId('settings-connected-apps');
    expect(group.textContent).toContain('Claude');
    // Reading is listed before changing, whatever order the API sent.
    expect(group.textContent).toContain(`${SCOPE_LABEL.read} · ${SCOPE_LABEL.cleanup}`);
    expect(group.textContent).toContain('Connected November 2, 2026');
    expect(group.textContent).toContain('Last used November 16, 2026');
    // An app that registered without a name is not given an invented one.
    expect(group.textContent).toContain('Unnamed app');
    expect(group.textContent).toContain('Not used yet');
    expect(screen.getByRole('button', { name: 'Disconnect Claude' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Disconnect Unnamed app' })).toBeTruthy();
  });

  it('says so when nothing is connected', () => {
    render(
      <ConnectedAppsGroup
        state={{ kind: 'ready', apps: [] }}
        timeZone="UTC"
        pendingId={null}
        failedAppName={null}
        onDisconnect={noop}
      />,
    );
    expect(screen.getByText('No apps connected')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('disables only the row being disconnected', () => {
    render(
      <ConnectedAppsGroup
        state={{ kind: 'ready', apps: [CLAUDE, UNNAMED] }}
        timeZone="UTC"
        pendingId={CLAUDE.id}
        failedAppName={null}
        onDisconnect={noop}
      />,
    );
    const busy = screen.getByRole('button', { name: 'Disconnect Claude' }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    expect(busy.textContent).toBe('Disconnecting…');
    const idle = screen.getByRole('button', {
      name: 'Disconnect Unnamed app',
    }) as HTMLButtonElement;
    expect(idle.disabled).toBe(false);
  });

  it('reports a failed disconnect by name, with the next action', () => {
    render(
      <ConnectedAppsGroup
        state={{ kind: 'ready', apps: [CLAUDE] }}
        timeZone="UTC"
        pendingId={null}
        failedAppName="Claude"
        onDisconnect={noop}
      />,
    );
    expect(screen.getByRole('alert').textContent).toBe('Could not disconnect Claude. Try again.');
  });

  it('offers Retry when the list could not be read', () => {
    const onRetry = vi.fn();
    render(
      <ConnectedAppsGroup
        state={{ kind: 'error', onRetry }}
        timeZone="UTC"
        pendingId={null}
        failedAppName={null}
        onDisconnect={noop}
      />,
    );
    expect(screen.getByText('Could not load connected apps.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

describe('ConnectedAppsSection', () => {
  it('renders nothing while the connector is switched off (404)', async () => {
    let calls = 0;
    const { container } = renderSection([
      {
        method: 'GET',
        path: '/api/oauth/grants',
        respond: () => {
          calls += 1;
          return jsonNotFound('NOT_FOUND');
        },
      },
    ]);
    await waitFor(() => expect(calls).toBe(1));
    // A designed state: never retried, never an error row.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls).toBe(1);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing before the first answer, so the section never flashes', () => {
    const { container } = renderSection([
      { method: 'GET', path: '/api/oauth/grants', respond: () => new Promise<Response>(() => {}) },
    ]);
    expect(container.innerHTML).toBe('');
  });

  it('lists connected apps', async () => {
    renderSection([list([CLAUDE])]);
    expect(await screen.findByRole('button', { name: 'Disconnect Claude' })).toBeTruthy();
  });

  it('shows its own Retry row on a server error instead of disappearing', async () => {
    renderSection([{ method: 'GET', path: '/api/oauth/grants', respond: () => jsonServerError() }]);
    // Two retries with backoff precede the error row.
    expect(
      await screen.findByText('Could not load connected apps.', undefined, { timeout: 8_000 }),
    ).toBeTruthy();
  });

  it('treats a body it cannot read as an error, not as an empty list', async () => {
    renderSection([
      {
        method: 'GET',
        path: '/api/oauth/grants',
        respond: () => jsonOk({ data: { apps: [{ id: 1 }] } }),
      },
    ]);
    expect(await screen.findByText('Could not load connected apps.')).toBeTruthy();
    expect(screen.queryByText('No apps connected')).toBeNull();
  });

  it('Disconnect revokes that grant, removes the row and confirms once', async () => {
    const deleted: string[] = [];
    let remaining = [CLAUDE, UNNAMED];
    renderSection([
      {
        method: 'GET',
        path: '/api/oauth/grants',
        respond: () => jsonOk({ data: { apps: remaining } }),
      },
      {
        method: 'DELETE',
        path: /^\/api\/oauth\/grants\/[^/]+$/,
        respond: (_req, url) => {
          const id = url.pathname.split('/').pop()!;
          deleted.push(id);
          remaining = remaining.filter((app) => app.id !== id);
          return jsonOk({ data: { id } });
        },
      },
    ]);
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect Claude' }));

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Disconnect Claude' })).toBeNull(),
    );
    expect(deleted).toEqual([CLAUDE.id]);
    expect(screen.getByRole('button', { name: 'Disconnect Unnamed app' })).toBeTruthy();
    expect(h.toast).toHaveBeenCalledExactlyOnceWith('Disconnected Claude.', 'success');
  });

  it('keeps the row and says what failed when Disconnect is refused', async () => {
    renderSection([
      list([CLAUDE]),
      {
        method: 'DELETE',
        path: /^\/api\/oauth\/grants\/[^/]+$/,
        respond: () => jsonServerError(),
      },
    ]);
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect Claude' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Could not disconnect Claude. Try again.',
    );
    expect(screen.getByRole('button', { name: 'Disconnect Claude' })).toBeTruthy();
    expect(h.toast).not.toHaveBeenCalled();
  });
});

describe('SCOPE_LABEL', () => {
  it('says reading covers senders and subject lines, and changes need confirmation', () => {
    expect(SCOPE_LABEL.read).toContain('senders');
    expect(SCOPE_LABEL.read).toContain('subject lines');
    for (const verb of ['Archive', 'Unsubscribe', 'Later', 'Delete']) {
      expect(SCOPE_LABEL.cleanup).toContain(verb);
    }
    expect(SCOPE_LABEL.cleanup).toContain('with your confirmation');
  });
});

describe('isConnectorUnavailable', () => {
  it('is true only for a 404', () => {
    expect(isConnectorUnavailable(new ApiError(404, { error: { code: 'NOT_FOUND' } }, 'x'))).toBe(
      true,
    );
    expect(isConnectorUnavailable(new ApiError(500, {}, 'x'))).toBe(false);
    expect(isConnectorUnavailable(new Error('network'))).toBe(false);
  });
});
