// Storybook CSF3 stories for the Sender Detail action toolbar (D210).
//
// The toolbar is the one surface where the pressed verb BECOMES its own
// status AND stays pressable once it reads "done" — this page has no ⋯
// menu, so a "done" verb that went dead would strand the user.
import type { ReactElement } from 'react';

import { makeSender } from '../testing/make-sender';
import { RowActivityProvider, type SenderRowActivity } from '../row-activity';
import { ActionToolbar } from './action-toolbar';

type StoryMeta<C extends (...args: never) => unknown> = {
  title: string;
  component: C;
  parameters?: Record<string, unknown>;
  tags?: readonly string[];
};

type Story = { render: () => ReactElement };

const meta: StoryMeta<typeof ActionToolbar> = {
  title: 'Senders/Detail/ActionToolbar',
  component: ActionToolbar,
  parameters: { layout: 'padded' },
  tags: ['autodocs'],
};

export default meta;

const sender = makeSender({ id: 'toolbar-1', displayName: 'Robinhood' });

const withActivity = (activity: SenderRowActivity | null): ReactElement => (
  <RowActivityProvider value={new Map(activity ? [[sender.id, activity]] : [])}>
    <ActionToolbar sender={sender} onAction={() => {}} />
  </RowActivityProvider>
);

export const Idle: Story = { render: () => withActivity(null) };

/** The pressed verb is the status; every verb is inert while the job runs. */
export const Working: Story = {
  render: () => withActivity({ phase: 'working', verb: 'archive' }),
};

/** Done: the slot says so — and still works ("Archive again"). */
export const Done: Story = {
  render: () => withActivity({ phase: 'done', verb: 'archive', affectedCount: 12 }),
};

/** Past the deadline or a lost poll: the job may still be running, so it stays locked. */
export const NotConfirmed: Story = {
  render: () => withActivity({ phase: 'unconfirmed', verb: 'delete' }),
};

/** Ended badly: the verb stays live for a retry; the failure sits beside the verbs. */
export const Failed: Story = {
  render: () => withActivity({ phase: 'failed', verb: 'delete' }),
};
