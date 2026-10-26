import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { StepPromise } from './step-promise';
import { StepConnect } from './step-connect';

const meta = {
  title: 'Onboarding/Entry',
  component: StepPromise,
  parameters: { layout: 'fullscreen' },
  args: { onConnect: () => undefined },
} satisfies Meta<typeof StepPromise>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Presentation fixtures; no Google consent or connection is started. */
export const PromiseStep: Story = {};
export const Connect: Story = { render: () => <StepConnect /> };
export const Reconnect: Story = { render: () => <StepConnect variant="reconnect" /> };
