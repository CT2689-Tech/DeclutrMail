import { tokens } from '@declutrmail/shared';

import { BannerSlot } from './banner-slot';

const { color, font, text } = tokens;

function DemoBanner({ children }: { children: string }) {
  return (
    <div
      role="alert"
      style={{
        padding: '10px 20px',
        background: color.dangerBg,
        borderBottom: `1px solid ${color.dangerBorder}`,
        color: color.danger,
        fontFamily: font.sans,
        fontSize: text.md,
        fontWeight: 600,
      }}
    >
      {children}
    </div>
  );
}

const Quiet = () => null;

// Locally-declared CSF shims, as in the sibling feature stories — the
// app typechecks without the Storybook framework types.
type StoryMeta<C extends (...args: never) => unknown> = {
  title: string;
  component: C;
  parameters?: Record<string, unknown>;
};

type Story = {
  render?: () => unknown;
};

const meta: StoryMeta<typeof BannerSlot> = {
  title: 'Shell/BannerSlot',
  component: BannerSlot,
  parameters: { layout: 'fullscreen' },
};

export default meta;

/** Nothing active — the slot takes no space. */
export const Empty: Story = {
  render: () => (
    <BannerSlot>
      <Quiet />
      <Quiet />
    </BannerSlot>
  ),
};

export const One: Story = {
  render: () => (
    <BannerSlot>
      <Quiet />
      <DemoBanner>New email isn&apos;t syncing — the last attempt failed.</DemoBanner>
    </BannerSlot>
  ),
};

/** Children are in priority order: the first active one holds the slot. */
export const Several: Story = {
  render: () => (
    <BannerSlot>
      <DemoBanner>Account deletion is in progress.</DemoBanner>
      <DemoBanner>New email isn&apos;t syncing — the last attempt failed.</DemoBanner>
      <Quiet />
      <DemoBanner>Gmail access expired for a second mailbox.</DemoBanner>
    </BannerSlot>
  ),
};
