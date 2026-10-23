import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SenderDetailDto } from '@/lib/api/senders';
import { makeSenderRow } from './testing/make-sender';
import { GuidedSenderCard } from './guided-sender-card';

const query = vi.hoisted(() => ({
  data: undefined as { data: SenderDetailDto } | undefined,
  isPending: false,
  isError: false,
  refetch: vi.fn(),
}));
vi.mock('./api/use-sender-detail', () => ({ useSenderDetail: () => query }));
vi.mock('@/features/auth/api/use-me', () => ({ useUserTimeZone: () => 'UTC' }));
function detail(overrides: Partial<SenderDetailDto> = {}): SenderDetailDto {
  return {
    ...makeSenderRow({
      id: 'selected-sender',
      inboxCount: 12,
      archivedCount: 3,
      unsubscribeMethod: 'one_click',
    }),
    unsubscribeMailtoUrl: null,
    recommendation: null,
    ...overrides,
  };
}
beforeEach(() => {
  query.data = { data: detail() };
  query.isPending = false;
  query.isError = false;
  query.refetch.mockClear();
});
describe('guided sender card current facts', () => {
  it('dispatches the re-read sender to the unchanged Senders action owner', () => {
    const act = vi.fn();
    render(<GuidedSenderCard senderId="selected-sender" onAction={act} />);
    fireEvent.click(screen.getByText('More actions'));
    fireEvent.click(screen.getByRole('button', { name: 'Archive (A)' }));
    expect(act).toHaveBeenCalledWith(
      expect.objectContaining({
        verb: 'Archive',
        senders: [expect.objectContaining({ id: 'selected-sender', inboxCount: 12 })],
      }),
    );
  });
  it('does not offer an outdated Archive suggestion after inbox mail is gone', () => {
    query.data = {
      data: detail({
        inboxCount: 0,
        recommendation: {
          verdict: 'archive',
          confidence: 0.95,
          reasoning: 'An older engine read.',
          generatedBy: 'template',
          scoredAt: '2026-06-01T00:00:00Z',
          stale: true,
        },
      }),
    };
    const act = vi.fn();
    render(<GuidedSenderCard senderId="selected-sender" onAction={act} />);
    expect(screen.getByText(/no current suggestion/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText('More actions'));
    fireEvent.click(screen.getByRole('button', { name: 'Archive (A)' }));
    expect(act).not.toHaveBeenCalled();
  });
  it('requires a successful current read when refresh failed, including cached data', () => {
    query.isError = true;
    render(<GuidedSenderCard senderId="selected-sender" onAction={() => {}} />);
    expect(screen.queryByRole('toolbar')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(query.refetch).toHaveBeenCalledOnce();
  });
});
