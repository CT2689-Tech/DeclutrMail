import { StrictMode, type ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useActionPreviewAnalytics } from './use-action-preview-analytics';
import type { Verb } from '@declutrmail/shared/observability';
const { track } = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock('./posthog', () => ({ track }));
beforeEach(() => track.mockClear());
it('counts loaded previews once, including reopening and another verb, without sending scope IDs', () => {
  const { rerender } = renderHook(
    ({ key, ready, verb }: { key: string | null; ready: boolean; verb: Verb }) =>
      useActionPreviewAnalytics(key, verb, ready),
    {
      initialProps: { key: 'private-sender-id', ready: false, verb: 'archive' },
      wrapper: ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>,
    },
  );
  expect(track).not.toHaveBeenCalled();
  rerender({ key: 'private-sender-id', ready: true, verb: 'archive' });
  rerender({ key: 'private-sender-id', ready: true, verb: 'archive' });
  expect(track).toHaveBeenCalledExactlyOnceWith('action_preview_viewed', {
    journey: 'daily',
    verb: 'archive',
  });
  rerender({ key: null, ready: false, verb: 'archive' });
  rerender({ key: 'private-sender-id', ready: true, verb: 'archive' });
  rerender({ key: 'private-sender-id', ready: true, verb: 'delete' });
  expect(track).toHaveBeenCalledTimes(3);
  expect(JSON.stringify(track.mock.calls)).not.toContain('private-sender-id');
});
