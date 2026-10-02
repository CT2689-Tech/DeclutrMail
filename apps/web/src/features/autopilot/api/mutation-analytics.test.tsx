import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';
import type { ReactNode } from 'react';
import { usePatchRule } from './use-patch-rule';
import { useDismissMatch } from './use-dismiss-match';
import { useApproveMatches } from './use-approve-matches';
import { useApproveAllForRule } from './use-approve-all-for-rule';
const h = vi.hoisted(() => ({
  patch: vi.fn(),
  dismiss: vi.fn(),
  approve: vi.fn(),
  approveAll: vi.fn(),
  track: vi.fn(),
}));
vi.mock('@/lib/api/autopilot', () => ({
  patchAutopilotRule: h.patch,
  postDismissMatch: h.dismiss,
  postApproveMatches: h.approve,
  postApproveAllForRule: h.approveAll,
}));
vi.mock('@/lib/posthog', () => ({ track: h.track }));
function wrapper() {
  const client = createTestQueryClient();
  return ({ children }: { children: ReactNode }) => (
    <QueryWrapper client={client}>{children}</QueryWrapper>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
});
it.each([
  [{ enabled: false }, 'autopilot_preset_changed', { preset_id: 'rule', action: 'disabled' }],
  [
    { enabled: true, mode: 'observe' },
    'autopilot_preset_changed',
    { preset_id: 'rule', action: 'enabled' },
  ],
  [{ mode: 'active' }, 'autopilot_preset_changed', { preset_id: 'rule', action: 'activated' }],
  [{ mode: 'observe' }, 'autopilot_resumed', { trigger: 'manual' }],
  [
    { confidenceThreshold: 0.8 },
    'autopilot_preset_changed',
    { preset_id: 'rule', action: 'parameter_changed' },
  ],
  [
    { observePromptDismissed: true },
    'autopilot_suggestion_decided',
    { decision: 'rejected', suggestion_kind: 'preset_change', count: 1 },
  ],
] as const)('records only a committed rule patch %j', async (patch, event, props) => {
  const { result } = renderHook(() => usePatchRule(), { wrapper: wrapper() });
  h.patch.mockRejectedValueOnce(new Error('save failed'));
  await act(async () => {
    await result.current.mutateAsync({ ruleId: 'rule', patch }).catch(() => {});
  });
  expect(h.track).not.toHaveBeenCalled();
  h.patch.mockResolvedValueOnce({ data: {} });
  await act(async () => {
    await result.current.mutateAsync({ ruleId: 'rule', patch });
  });
  expect(h.track).toHaveBeenCalledExactlyOnceWith(event, props);
});
it('does not count a rejected skip as a resolved suggestion', async () => {
  const { result } = renderHook(() => useDismissMatch(), { wrapper: wrapper() });
  h.dismiss.mockRejectedValueOnce(new Error('save failed'));
  await act(async () => {
    await result.current.mutateAsync('match').catch(() => {});
  });
  expect(h.track).not.toHaveBeenCalled();
  h.dismiss.mockResolvedValueOnce({ data: {} });
  await act(async () => {
    await result.current.mutateAsync('match');
  });
  expect(h.track).toHaveBeenCalledExactlyOnceWith('autopilot_suggestion_decided', {
    decision: 'rejected',
    suggestion_kind: 'preset_rule',
    count: 1,
  });
});

it.each(['selected', 'all'] as const)(
  'keeps the server approved count after the %s observer unmounts',
  async (kind) => {
    const api = kind === 'selected' ? h.approve : h.approveAll;
    let resolve!: (value: unknown) => void;
    api.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const { result, unmount } = renderHook(
      () => ({ selected: useApproveMatches(), all: useApproveAllForRule() }),
      { wrapper: wrapper() },
    );
    let pending!: Promise<unknown>;
    act(() => {
      pending =
        kind === 'selected'
          ? result.current.selected.mutateAsync(['a', 'b'])
          : result.current.all.mutateAsync({ ruleId: 'rule', scope: { matchIds: ['a', 'b'] } });
    });
    await act(async () => {
      await Promise.resolve();
    });
    unmount();
    await act(async () => {
      resolve({ data: { approvedCount: 1 } });
      await pending;
    });
    expect(h.track).toHaveBeenCalledExactlyOnceWith('autopilot_suggestion_decided', {
      decision: 'accepted',
      suggestion_kind: 'preset_rule',
      count: 1,
    });
  },
);
