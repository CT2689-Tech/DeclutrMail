import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { AcquisitionReportView } from './acquisition-report';
import { ACQUISITION_REPORT_FIXTURE } from './fixtures';

const meta = {
  title: 'Admin/SourceAnswers',
  component: AcquisitionReportView,
  parameters: { layout: 'fullscreen' },
  render: (args) => (
    <>
      <span id="dm-app-theme" hidden />
      <AcquisitionReportView {...args} />
    </>
  ),
} satisfies Meta<typeof AcquisitionReportView>;
export default meta;
type Story = StoryObj<typeof meta>;
const ready = {
  kind: 'ready',
  report: ACQUISITION_REPORT_FIXTURE,
  refreshing: false,
  refreshFailed: false,
  onRefresh: () => {},
} as const;
export const Answers: Story = { args: { state: ready } };
export const Empty: Story = {
  args: {
    state: {
      ...ready,
      report: {
        ...ACQUISITION_REPORT_FIXTURE,
        totalAccounts: 0,
        answered: 0,
        skipped: 0,
        unanswered: 0,
        channels: ACQUISITION_REPORT_FIXTURE.channels.map((row) => ({ ...row, count: 0 })),
      },
    },
  },
};
export const Loading: Story = { args: { state: { kind: 'loading' } } };
export const Unavailable: Story = { args: { state: { kind: 'error', onRetry: () => {} } } };
export const NotFound: Story = { args: { state: { kind: 'not-found' } } };
export const RefreshFailed: Story = { args: { state: { ...ready, refreshFailed: true } } };
export const Unrecognized: Story = {
  args: {
    state: {
      ...ready,
      report: { ...ACQUISITION_REPORT_FIXTURE, totalAccounts: 26, answered: 17, unrecognized: 2 },
    },
  },
};
