import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@tanstack/react-query', () => ({ useQuery: query }));
vi.mock('@/features/auth/auth-provider', () => ({
  useAuth: () => ({ me: { user: { id: 'operator-test' } } }),
}));
import { ApiError } from '@/lib/api/client';
import { AcquisitionReportView, AdminAcquisitionReport } from './acquisition-report';
import { ACQUISITION_REPORT_FIXTURE as report } from './fixtures';
const ready = {
  kind: 'ready',
  report,
  refreshing: false,
  refreshFailed: false,
  onRefresh: vi.fn(),
} as const;

describe('source answer report', () => {
  it('separates answers, skips and unanswered accounts and exposes zero-count channels on request', () => {
    render(<AcquisitionReportView state={ready} />);
    expect(screen.getByText('Accounts').nextElementSibling).toHaveTextContent('24');
    expect(screen.getByText('Answered').nextElementSibling).toHaveTextContent('15');
    expect(screen.getByText('Skipped').nextElementSibling).toHaveTextContent('5');
    expect(screen.getByText('Unanswered').nextElementSibling).toHaveTextContent('4');
    const table = screen.getByRole('table');
    expect(within(table).getByRole('row', { name: 'Google / search 6' })).toBeInTheDocument();
    expect(within(table).queryByText('YouTube')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show unused channels' }));
    expect(within(table).getByRole('row', { name: 'YouTube 0' })).toBeInTheDocument();
    expect(screen.getByText(/include internal and test accounts/)).toBeInTheDocument();
  });
  it('retains a dated successful snapshot when refresh fails', () => {
    render(<AcquisitionReportView state={{ ...ready, refreshFailed: true }} />);
    expect(screen.getByRole('status')).toHaveTextContent('last successful snapshot');
    expect(screen.getByRole('table')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(ready.onRefresh).toHaveBeenCalledOnce();
  });
  it('does not turn an unavailable read into zero accounts', () => {
    const retry = vi.fn();
    render(<AcquisitionReportView state={{ kind: 'error', onRetry: retry }} />);
    expect(screen.queryByText('Accounts')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(retry).toHaveBeenCalledOnce();
  });
  it.each([401, 403, 404])('removes cached aggregates after access is denied (%s)', (status) => {
    query.mockReturnValue({
      data: report,
      error: new ApiError(status, {}, 'not found'),
      isError: true,
    });
    render(<AdminAcquisitionReport />);
    expect(screen.getByText('Not found')).toBeInTheDocument();
    expect(screen.queryByText('Source answers')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(query).toHaveBeenLastCalledWith(
      expect.objectContaining({
        queryKey: ['admin', 'signup-attribution', 'operator-test'],
        gcTime: 0,
      }),
    );
  });
});
