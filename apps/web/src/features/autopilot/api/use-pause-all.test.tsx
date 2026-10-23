import { act, renderHook, waitFor } from '@testing-library/react';
import { useQuery } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';
import { postPauseAll } from '@/lib/api/autopilot';
import { usePauseAll } from './use-pause-all';

vi.mock('@/lib/api/autopilot', () => ({ postPauseAll: vi.fn() }));

it('refreshes an active custom library after a preset pause without replacing its preview', async () => {
  const client = createTestQueryClient();
  const previewKey = ['autopilot-sender-rule-preview', 'mb', 'rule'];
  client.setQueryData(previewKey, { previewId: 'frozen' });
  let serverMode = 'observe';
  vi.mocked(postPauseAll).mockImplementation(async () => {
    serverMode = 'paused';
    return { data: { pausedCount: 1 } };
  });
  const view = renderHook(
    () => ({
      pause: usePauseAll(),
      library: useQuery({
        queryKey: ['autopilot-sender-rules', 'mb'],
        queryFn: async () => ({ mode: serverMode }),
        initialData: { mode: 'observe' },
        staleTime: Infinity,
      }),
    }),
    { wrapper: ({ children }) => <QueryWrapper client={client}>{children}</QueryWrapper> },
  );

  act(() => view.result.current.pause.mutate());

  await waitFor(() => expect(view.result.current.library.data.mode).toBe('paused'));
  expect(client.getQueryData(previewKey)).toEqual({ previewId: 'frozen' });
  expect(client.getQueryState(previewKey)?.isInvalidated).toBe(false);
  view.unmount();
  client.clear();
});
