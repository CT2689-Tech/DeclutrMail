import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { SyncStatus } from '@declutrmail/shared/contracts';

const track = vi.hoisted(() => vi.fn());
vi.mock('@/lib/posthog', () => ({ track }));

import { SyncGate } from './sync-gate';

const SYNCING: SyncStatus = {
  readiness_status: 'syncing',
  current_stage: 'building_sender_index',
  progress_pct: 45,
  is_ready_for_triage: false,
  last_synced_at: null,
};

describe('sync_gate_state_viewed', () => {
  it('fires the progress state once for a scanning gate', async () => {
    track.mockClear();
    render(<SyncGate status={SYNCING} />);
    await waitFor(() =>
      expect(track).toHaveBeenCalledWith('sync_gate_state_viewed', { state: 'progress' }),
    );
    expect(track).toHaveBeenCalledTimes(1);
  });

  it('keeps the reported count between its progress bar and the privacy line', () => {
    render(
      <SyncGate
        status={{
          ...SYNCING,
          current_stage: 'fetching_metadata',
          message_progress: { processed: 12_400, total: 40_898, age_ms: 0 },
        }}
      />,
    );

    const bar = screen.getByRole('progressbar', { name: 'Scan progress' });
    const count = screen.getByTestId('sync-count');
    const privacy = screen.getByText('We never fetch or store full email contents.');
    expect(count).toHaveTextContent('12,400 of 40,898');
    expect(bar.compareDocumentPosition(count) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(count.compareDocumentPosition(privacy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
