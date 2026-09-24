// packages/shared/src/components/preview-sheet/preview-sheet.stories.tsx
//
// Visual reference for `PreviewSheet` — the one confirmation surface
// (ADR-0042). Per D210 every shared component ships Storybook coverage
// of its states. The stories are the argument for the layout: the count,
// the destination and the way back each appear once, and everything
// else is behind "Details".
//
// Storybook itself is seeded in PR 3 (D210). Until then this file uses
// locally-declared lightweight CSF types so it typechecks without
// `@storybook/react` installed.

import { useState } from 'react';
import { Avatar } from '../avatar';
import { PreviewSheet } from './preview-sheet';
import { SheetFactList, SheetLinks, SheetSegmented, SheetTextAction } from './sheet-parts';

type StoryMeta<C extends (...args: never) => unknown> = {
  title: string;
  component: C;
  parameters?: Record<string, unknown>;
};

type Story = { render: () => React.ReactElement };

const meta: StoryMeta<typeof PreviewSheet> = {
  title: 'Primitives/PreviewSheet',
  component: PreviewSheet,
  parameters: { layout: 'fullscreen' },
};

export default meta;

const noop = () => undefined;

// Details is a fact list: short label left, short value right, links on
// a row of their own. Never a stack of full sentences.
const details = (
  <>
    <SheetFactList
      facts={[
        { label: 'Gmail account', value: 'you@example.com' },
        { label: 'Count', value: 'Inbox now, rechecked when it runs' },
      ]}
    />
    <SheetLinks>
      <SheetTextAction href="https://mail.google.com/">
        Check in Gmail <span aria-hidden="true">↗</span>
      </SheetTextAction>
      <SheetTextAction onClick={() => undefined}>Show 5 of 174</SheetTextAction>
    </SheetLinks>
  </>
);

const deleteDetails = (
  <>
    <SheetFactList
      facts={[
        { label: 'Gmail account', value: 'you@example.com' },
        { label: 'Where it is now', value: '0 in your inbox · 6,728 elsewhere in Gmail' },
        { label: 'Count', value: 'Inbox + archived now, rechecked when it runs' },
        { label: 'Never touched', value: 'Trash, Spam, Drafts, Chat' },
        { label: 'Undo', value: 'Puts each email back where it was' },
        { label: 'Gmail Trash', value: 'Kept up to 30 days, then deleted for good' },
      ]}
    />
    <SheetLinks>
      <SheetTextAction href="https://mail.google.com/">
        Check in Gmail <span aria-hidden="true">↗</span>
      </SheetTextAction>
    </SheetLinks>
  </>
);

/** Archive — the everyday case. Focus lands on the action. */
export const Archive: Story = {
  render: () => (
    <PreviewSheet
      onClose={noop}
      icon={<Avatar name="Macy's" size={64} />}
      title="Archive 174 emails?"
      subtitle="From Macy's. They leave your inbox and stay in Gmail."
      note="Undo from Activity for 30 days."
      details={details}
      primary={{ label: 'Archive 174', onClick: noop }}
      footer="Don't ask again for Archive"
    />
  ),
};

function DeleteWithReach() {
  const [reach, setReach] = useState<'inbox' | 'all'>('all');
  const count = reach === 'inbox' ? 0 : 6728;
  return (
    <PreviewSheet
      onClose={noop}
      icon={<Avatar name="Bank of America" size={64} />}
      title={
        count === 0
          ? 'Nothing in your inbox from Bank of America'
          : `Delete ${count.toLocaleString('en-US')} emails?`
      }
      subtitle={count === 0 ? undefined : 'From Bank of America. They move to Gmail Trash.'}
      note={count === 0 ? undefined : 'Undo from Activity for 30 days. Future email is unchanged.'}
      details={deleteDetails}
      primary={{
        label: count === 0 ? 'Delete' : `Delete ${count.toLocaleString('en-US')}`,
        onClick: noop,
        tone: 'danger',
        disabled: count === 0,
      }}
    >
      <SheetSegmented
        label="Where it applies"
        value={reach}
        onChange={setReach}
        options={[
          { value: 'inbox', label: 'Inbox only', count: 0 },
          { value: 'all', label: 'Inbox + archived', count: 6728 },
        ]}
      />
    </PreviewSheet>
  );
}

/** Delete — destructive, so focus lands on Cancel; the reach chooser
 * shows only because its options give different counts. */
export const Delete: Story = { render: () => <DeleteWithReach /> };

/** Unsubscribe — the one thing that cannot be undone is the note. */
export const Unsubscribe: Story = {
  render: () => (
    <PreviewSheet
      onClose={noop}
      icon={<Avatar name="Robinhood" size={64} />}
      title="Unsubscribe from Robinhood?"
      subtitle="DeclutrMail asks Robinhood to stop emailing you."
      note="A sent unsubscribe can't be recalled."
      details={details}
      primary={{ label: 'Unsubscribe', onClick: noop, tone: 'warn' }}
    />
  ),
};

/** In flight — every way out is locked until the server answers. */
export const Submitting: Story = {
  render: () => (
    <PreviewSheet
      onClose={noop}
      icon={<Avatar name="Macy's" size={64} />}
      title="Archive 174 emails?"
      subtitle="From Macy's. They leave your inbox and stay in Gmail."
      primary={{ label: 'Archive 174', onClick: noop, busyLabel: 'Archiving…' }}
    />
  ),
};

/** Failed — the cause and the next step, in the live region. */
export const Failed: Story = {
  render: () => (
    <PreviewSheet
      onClose={noop}
      icon={<Avatar name="Macy's" size={64} />}
      title="Archive 174 emails?"
      subtitle="From Macy's. They leave your inbox and stay in Gmail."
      primary={{ label: 'Try again', onClick: noop }}
      status="Gmail didn't answer. Nothing moved."
    />
  ),
};
