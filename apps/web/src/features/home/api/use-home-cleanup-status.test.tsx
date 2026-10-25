import { act, renderHook } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { useActionFeedbackStore, acceptActionFeedback } from '@/features/undo/feedback-store';
import { undoKeys } from '@/features/undo/query-keys';
import { createTestQueryClient } from '@/test/query-wrapper';
import { useHomeCleanupStatus } from './use-home-cleanup-status';

afterEach(() => useActionFeedbackStore.setState({ scopes: {} }));

describe('Home observes the shared cleanup owner', () => {
  it('isolates mailboxes and ignores finished grace groups', () => {
    const client = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    client.setQueryData(undoKeys.inFlight('a'), [{ running: true }]);
    client.setQueryData(undoKeys.inFlight('b'), [{ running: false }]);
    const hook = renderHook(({ id }) => useHomeCleanupStatus(id), {
      initialProps: { id: 'a' },
      wrapper,
    });
    expect(hook.result.current).toBe('running');
    hook.rerender({ id: 'b' });
    expect(hook.result.current).toBe('idle');
    act(() => client.removeQueries({ queryKey: undoKeys.inFlight('b') }));
    expect(hook.result.current).toBeNull();
  });
  it('keeps accepted work uncertain until the shared owner confirms an outcome', () => {
    const client = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    client.setQueryData(undoKeys.inFlight('a'), []);
    const hook = renderHook(() => useHomeCleanupStatus('a'), { wrapper });
    act(() =>
      acceptActionFeedback('a', {
        groupId: 'job',
        verb: 'archive',
        mixedVerbs: false,
        senderCount: 1,
        startedAt: '2026-10-25T10:00:00Z',
      }),
    );
    expect(hook.result.current).toBe('unknown');
    act(() => useActionFeedbackStore.setState({ scopes: {} }));
    expect(hook.result.current).toBe('idle');
  });
  it('does not turn a failed discovery read into an idle result or issue its own request', async () => {
    const client = createTestQueryClient();
    await client
      .fetchQuery({
        queryKey: undoKeys.inFlight('a'),
        queryFn: () => Promise.reject(new Error('offline')),
        retry: false,
      })
      .catch(() => undefined);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const hook = renderHook(() => useHomeCleanupStatus('a'), { wrapper });
    expect(hook.result.current).toBe('unknown');
    expect(client.isFetching()).toBe(0);
  });
});
