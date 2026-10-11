import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { HomeArrivalsView } from './home-arrivals';
const meta: Meta<typeof HomeArrivalsView> = {
  title: 'Home/VisitSummary',
  component: HomeArrivalsView,
  args: { error: false, retry: () => {} },
};
export default meta;
type Story = StoryObj<typeof meta>;
const data = {
  visitId: '10000000-0000-4000-8000-000000000001',
  since: '2026-10-09T10:00:00Z',
  until: '2026-10-10T10:00:00Z',
  indexedEmails: 142,
  indexedSenders: 3,
};
export const Arrivals: Story = { args: { data } };
export const Zero: Story = { args: { data: { ...data, indexedEmails: 0, indexedSenders: 0 } } };
export const FirstVisit: Story = {
  args: { data: { ...data, since: null, indexedEmails: null, indexedSenders: null } },
};
export const Loading: Story = {};
export const Error: Story = { args: { error: true } };
