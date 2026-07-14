import { TechnicalDetails } from './technical-details';

type StoryMeta<C extends (...args: never) => unknown> = {
  title: string;
  component: C;
  tags?: readonly string[];
};

type Story<C extends (props: never) => unknown> = {
  args: Parameters<C>[0];
};

const meta: StoryMeta<typeof TechnicalDetails> = {
  title: 'Components/TechnicalDetails',
  component: TechnicalDetails,
  tags: ['autodocs'],
};

export default meta;

export const GooglePermissionDetails: Story<typeof TechnicalDetails> = {
  args: {
    summary: 'Show Google permission details',
    children: <code>https://www.googleapis.com/auth/gmail.modify</code>,
  },
};

export const SupportReference: Story<typeof TechnicalDetails> = {
  args: {
    summary: 'Show support reference',
    children: <code>Reference: 7f2a9100</code>,
    defaultOpen: true,
  },
};
