import { useEffect, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, userEvent, within } from 'storybook/test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { installFetchStub, jsonOk, jsonServerError, resetFetchStub } from '@/test/fetch-stub';
import { ApprovedBatches } from './approved-batches';

type Scenario =
  | 'empty'
  | 'loading'
  | 'waiting'
  | 'completed'
  | 'partial'
  | 'unavailable'
  | 'undoing'
  | 'restored';
function ApprovalStory({ scenario }: { scenario: Scenario }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      }),
  );
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const waiting = scenario === 'waiting';
    const partial = scenario === 'partial';
    const autopilot = {
      ruleId: 'story-rule',
      ruleName: 'Evening cleanup',
      waitingUntil: waiting ? new Date(Date.now() + 3_600_000).toISOString() : null,
    };
    installFetchStub([
      {
        method: 'GET',
        path: '/api/actions/active',
        respond: () =>
          scenario === 'loading'
            ? new Promise<Response>(() => {})
            : scenario === 'empty'
              ? jsonOk({ data: [] })
              : scenario === 'unavailable'
                ? jsonServerError()
                : jsonOk({
                    data: [
                      {
                        groupId: 'story-batch',
                        verb: 'archive',
                        mixedVerbs: false,
                        running: waiting,
                        total: 1,
                        done: waiting ? 0 : 1,
                        failed: partial ? 1 : 0,
                        senderCount: 1,
                        leadSenderName: 'Studio Weekly',
                        startedAt: new Date().toISOString(),
                        autopilot,
                      },
                    ],
                  }),
      },
      {
        method: 'GET',
        path: '/api/actions/batch/story-batch',
        respond: () =>
          scenario === 'unavailable'
            ? jsonServerError()
            : jsonOk({
                data: {
                  batchId: 'story-batch',
                  status: waiting ? 'queued' : 'done',
                  total: 1,
                  done: waiting ? 0 : 1,
                  failed: partial ? 1 : 0,
                  requestedCount: 2,
                  affectedCount: waiting ? 0 : partial ? 1 : 2,
                  autopilot,
                  undoToken: waiting ? null : 'story-undo',
                  undoExpiresAt: waiting ? null : new Date(Date.now() + 3_600_000).toISOString(),
                  undoRevertedAt: scenario === 'restored' ? new Date().toISOString() : null,
                  skippedProtectedSenderIds: partial ? ['story-protected'] : [],
                },
              }),
      },
      {
        method: 'POST',
        path: '/api/undo/story-undo',
        respond: () =>
          jsonOk({
            data: {
              token: 'story-undo',
              actionId: 'story-reverse',
              actionIds: ['story-reverse'],
              reverted: false,
            },
          }),
      },
      {
        method: 'POST',
        path: '/api/actions/undo-status',
        respond: () =>
          jsonOk({
            data: {
              actionId: 'story-reverse',
              status: 'executing',
              requestedCount: 2,
              affectedCount: 0,
            },
          }),
      },
    ]);
    setReady(true);
    return () => {
      resetFetchStub();
      client.clear();
    };
  }, [client, scenario]);
  return ready ? (
    <QueryClientProvider client={client}>
      <div style={{ maxWidth: 760, padding: 24 }}>
        <ApprovedBatches
          mailboxId="story-mailbox"
          receipt={
            scenario === 'unavailable'
              ? {
                  batchId: 'story-batch',
                  previewId: 'story-preview',
                  actionIds: ['story-action'],
                  requestedCount: 2,
                  enqueueFailedCount: 0,
                  ruleName: 'Evening cleanup',
                }
              : null
          }
        />
      </div>
    </QueryClientProvider>
  ) : (
    <p>Preparing story…</p>
  );
}
const meta = {
  title: 'Autopilot/ApprovedBatches',
  component: ApprovalStory,
  args: { scenario: 'waiting' },
  tags: ['!autodocs'],
  parameters: { controls: { disable: true } },
} satisfies Meta<typeof ApprovalStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const WaitingForSchedule: Story = {};
export const Empty: Story = { args: { scenario: 'empty' } };
export const Loading: Story = { args: { scenario: 'loading' } };
export const Completed: Story = { args: { scenario: 'completed' } };
export const PartialFailure: Story = { args: { scenario: 'partial' } };
export const StatusUnavailable: Story = { args: { scenario: 'unavailable' } };
export const UndoInProgress: Story = {
  args: { scenario: 'undoing' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Undo' }));
    await expect(await canvas.findByText('Restoring emails…')).toBeVisible();
  },
};
export const Restored: Story = { args: { scenario: 'restored' } };
