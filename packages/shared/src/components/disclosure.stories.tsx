import { Disclosure } from './disclosure';
import { SheetFactList } from './preview-sheet/sheet-parts';

export default {
  title: 'Primitives/Disclosure',
  component: Disclosure,
  tags: ['autodocs'],
};

const facts = (
  <SheetFactList
    facts={[
      { label: 'Where it applies', value: 'Inbox + archived · older than 180 days' },
      { label: 'Account', value: 'avery-long-mailbox-name.for-phone-layout@example.test' },
      { label: 'Never touched', value: 'Trash, Spam, Drafts and Chat' },
    ]}
  />
);

export const Collapsed = { args: { children: facts } };
export const Expanded = { args: { children: facts, defaultOpen: true } };
export const Contextual = {
  args: {
    summary: 'Saved data kept after disconnecting this Gmail account',
    children: <p style={{ margin: 0 }}>Email metadata, Activity history and your settings.</p>,
    defaultOpen: true,
  },
};
export const Dark = {
  render: () => (
    <div data-theme="dark">
      <Disclosure defaultOpen>{facts}</Disclosure>
    </div>
  ),
};
