import { useState } from 'react';
import { type Meta, type StoryObj } from '@storybook/nextjs-vite';
import { GuidedReviewFrame } from './guided-review-frame';
import { ActionToolbar } from './detail/action-toolbar';
import { makeSender } from './testing/make-sender';
import styles from './sender-workspace.module.css';

const senders = [
  makeSender({ id: 'first', name: 'Weekend Edit', inboxCount: 24, unsubscribeMethod: 'one_click' }),
  makeSender({
    id: 'second',
    name: 'Community Digest',
    inboxCount: 6,
    unsubscribeMethod: 'mailto',
  }),
];
function Review({ busy = false }: { busy?: boolean }) {
  const [index, setIndex] = useState(0);
  const sender = senders[index] ?? senders[0]!;
  return (
    <GuidedReviewFrame
      senders={senders}
      index={index}
      label="Selected senders"
      onNavigate={setIndex}
      onExit={() => {}}
      navigationDisabled={busy}
    >
      <section className={styles.guidedCard}>
        <h2>{sender.name}</h2>
        <p>{sender.inboxCount} emails in Inbox</p>
        <p>Suggested: Archive</p>
        <ActionToolbar sender={sender} onAction={() => {}} guided suggestedVerb="Archive" />
      </section>
    </GuidedReviewFrame>
  );
}
const meta = {
  title: 'Senders/Guided Review',
  component: Review,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Review>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Selected: Story = {};
export const PreviewOwnsSender: Story = { args: { busy: true } };
export const Phone: Story = { parameters: { viewport: { defaultViewport: 'mobile1' } } };
