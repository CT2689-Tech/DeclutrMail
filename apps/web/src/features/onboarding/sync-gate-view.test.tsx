import { describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
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
});
