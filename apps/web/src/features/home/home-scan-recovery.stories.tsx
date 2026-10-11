import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { HomeScanRecoveryView } from './home-scan-recovery';
const meta: Meta<typeof HomeScanRecoveryView> = {
  title: 'Home/ScanRecovery',
  component: HomeScanRecoveryView,
  args: {
    error: false,
    pending: false,
    needsReconnect: false,
    now: Date.parse('2026-10-10T10:00:00Z'),
    refresh: () => {},
    retry: () => {},
    reconnect: () => {},
  },
};
export default meta;
type Story = StoryObj<typeof meta>;
const data = {
  readiness_status: 'failed' as const,
  current_stage: 'failed' as const,
  progress_pct: 25,
  is_ready_for_triage: false,
  last_synced_at: null,
  error_code: 'TransientError',
};
export const Retry: Story = { args: { data } };
export const Scheduled: Story = {
  args: { data: { ...data, next_retry_at: '2026-10-10T10:05:00Z' } },
};
export const ManualCooldown: Story = {
  args: { data: { ...data, retry_available_at: '2026-10-10T10:05:00Z' } },
};
export const Reconnect: Story = { args: { data: { ...data, error_code: 'invalid_grant' } } };
export const Starting: Story = { args: { data, pending: true } };
export const Loading: Story = {};
export const Error: Story = { args: { error: true } };
export const Ready: Story = {
  args: { data: { ...data, readiness_status: 'ready', is_ready_for_triage: true } },
};
