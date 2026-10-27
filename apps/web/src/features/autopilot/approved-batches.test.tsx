import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApprovedBatches } from './approved-batches';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';
import { installFetchStub, jsonOk, jsonServerError, resetFetchStub } from '@/test/fetch-stub';
import type { BatchStatusResult, InFlightActionGroup } from '@/lib/api/actions';
import { useActionFeedbackStore } from '@/features/undo/feedback-store';
import { undoKeys } from '@/features/undo/query-keys';

const group: InFlightActionGroup = {
  groupId: 'batch',
  verb: 'archive',
  mixedVerbs: false,
  running: true,
  total: 1,
  done: 0,
  failed: 0,
  senderCount: 1,
  leadSenderName: 'Studio Weekly',
  startedAt: new Date().toISOString(),
  autopilot: {
    ruleId: 'rule',
    ruleName: 'Evening cleanup',
    waitingUntil: new Date(Date.now() + 3_600_000).toISOString(),
  },
};
const snapshot: BatchStatusResult = {
  batchId: 'batch',
  status: 'queued',
  total: 1,
  done: 0,
  failed: 0,
  requestedCount: 2,
  affectedCount: 0,
  undoToken: null,
  autopilot: group.autopilot!,
};
const clients: ReturnType<typeof createTestQueryClient>[] = [];
afterEach(() => {
  resetFetchStub();
  clients.splice(0).forEach((client) => client.clear());
  useActionFeedbackStore.setState({ scopes: {} });
});
function setup() {
  const client = createTestQueryClient();
  clients.push(client);
  return {
    client,
    ...render(
      <QueryWrapper client={client}>
        <ApprovedBatches mailboxId="mailbox-a" receipt={null} />
      </QueryWrapper>,
    ),
  };
}

describe('durable approved batches', () => {
  it('hydrates when shared action discovery finishes before the route HTML arrives', async () => {
    const server = createTestQueryClient();
    const browser = createTestQueryClient();
    clients.push(server, browser);
    const tree = (client: typeof server) => (
      <QueryWrapper client={client}>
        <ApprovedBatches mailboxId="mailbox-a" receipt={null} />
      </QueryWrapper>
    );
    const container = document.createElement('div');
    document.body.append(container);
    container.innerHTML = renderToString(tree(server));
    expect(container.textContent).toContain('Checking approved batches…');
    // The global action tray can complete this shared query while the route streams.
    browser.setQueryDefaults(undoKeys.inFlight('mailbox-a'), { staleTime: Infinity });
    browser.setQueryData(undoKeys.inFlight('mailbox-a'), []);
    const recovered = vi.fn();
    let root: Root | undefined;
    try {
      await act(async () => {
        root = hydrateRoot(container, tree(browser), { onRecoverableError: recovered });
      });
      expect(recovered).not.toHaveBeenCalled();
      expect(container.textContent).toContain('Preview a rule and approve a batch.');
    } finally {
      await act(async () => root?.unmount());
      container.remove();
    }
  });

  it('discovers a Schedule wait after remount without a local receipt', async () => {
    installFetchStub([
      { method: 'GET', path: '/api/actions/active', respond: () => jsonOk({ data: [group] }) },
      {
        method: 'GET',
        path: '/api/actions/batch/batch',
        respond: () => jsonOk({ data: snapshot }),
      },
    ]);
    const view = setup();
    await screen.findByText(/Waiting for Schedule/);
    expect(screen.getByText(/2 approved emails/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
    view.unmount();
    setup();
    expect(await screen.findByText(/Waiting for Schedule/)).toBeInTheDocument();
    expect(screen.queryByText(/emails moved/)).not.toBeInTheDocument();
  });

  it('shows actual completion and waits for every Undo member before saying restored', async () => {
    let restored = false;
    let requestedIds: string[] = [];
    installFetchStub([
      {
        method: 'GET',
        path: '/api/actions/active',
        respond: () => jsonOk({ data: [{ ...group, running: false }] }),
      },
      {
        method: 'GET',
        path: '/api/actions/batch/batch',
        respond: () =>
          jsonOk({
            data: {
              ...snapshot,
              status: 'done',
              done: 1,
              affectedCount: 2,
              undoToken: 'undo-token',
              undoExpiresAt: new Date(Date.now() + 60_000).toISOString(),
            },
          }),
      },
      {
        method: 'POST',
        path: '/api/undo/undo-token',
        respond: () =>
          jsonOk({
            data: {
              token: 'undo-token',
              actionId: 'reverse-a',
              actionIds: ['reverse-a', 'reverse-b'],
              reverted: false,
            },
          }),
      },
      {
        method: 'POST',
        path: '/api/actions/undo-status',
        respond: async (request) => {
          requestedIds = ((await request.json()) as { actionIds: string[] }).actionIds;
          return jsonOk({
            data: {
              actionId: 'reverse-a',
              direction: 'reverse',
              verb: 'archive',
              status: restored ? 'done' : 'executing',
              requestedCount: 2,
              affectedCount: restored ? 2 : 1,
            },
          });
        },
      },
    ]);
    const view = setup();
    await screen.findByText('2 emails moved.');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await screen.findByText('Restoring emails…');
    await waitFor(() => expect(requestedIds).toEqual(['reverse-a', 'reverse-b']));
    expect(screen.queryByText('Undo complete. Emails restored.')).not.toBeInTheDocument();
    restored = true;
    await act(async () => {
      await view.client.invalidateQueries({ queryKey: ['undo-status'] });
    });
    expect(await screen.findByText('Undo complete. Emails restored.')).toBeInTheDocument();
  });

  it('keeps partial failure and Protected skips visible, and never invents an outcome after a read fails', async () => {
    let failure = false;
    installFetchStub([
      { method: 'GET', path: '/api/actions/active', respond: () => jsonOk({ data: [group] }) },
      {
        method: 'GET',
        path: '/api/actions/batch/batch',
        respond: () =>
          failure
            ? jsonServerError()
            : jsonOk({
                data: {
                  ...snapshot,
                  status: 'done',
                  done: 1,
                  failed: 1,
                  affectedCount: 1,
                  skippedProtectedSenderIds: ['protected'],
                },
              }),
      },
    ]);
    const view = setup();
    await screen.findByText(/1 emails moved. 1 actions failed/);
    expect(screen.getByText('1 Protected senders skipped.')).toBeInTheDocument();
    failure = true;
    await act(async () => {
      await view.client.invalidateQueries({ queryKey: ['batch-status'] });
    });
    expect(await screen.findByText(/Progress couldn’t be checked/)).toBeInTheDocument();
    expect(screen.queryByText(/emails moved/)).not.toBeInTheDocument();
  });

  it('shows the newest six after discovery and links to the rest', async () => {
    const groups = Array.from({ length: 7 }, (_, i) => ({
      ...group,
      groupId: `batch-${i}`,
      startedAt: new Date(Date.now() - i * 60_000).toISOString(),
      autopilot: { ...group.autopilot!, ruleName: `Rule ${i}` },
    }));
    installFetchStub([
      { method: 'GET', path: '/api/actions/active', respond: () => jsonOk({ data: groups }) },
      ...groups.map((item) => ({
        method: 'GET' as const,
        path: `/api/actions/batch/${item.groupId}`,
        respond: () => jsonOk({ data: { ...snapshot, batchId: item.groupId } }),
      })),
    ]);
    setup();
    await screen.findByText('Rule 0');
    expect(screen.getAllByRole('article').map((node) => node.getAttribute('aria-label'))).toEqual(
      Array.from({ length: 6 }, (_, i) => `Batch progress for Rule ${i}`),
    );
    expect(screen.queryByText('Rule 6')).not.toBeInTheDocument();
    expect(screen.getByText(/Showing the 6 most recent/)).toBeInTheDocument();
  });
});
