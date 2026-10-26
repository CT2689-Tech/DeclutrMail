import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { CleanupImpact, CleanupPreview } from './cleanup-preview';

const meta = {
  title: 'Actions/CleanupPreview',
  component: CleanupPreview,
  args: {
    olderThanDays: 180,
    options: [{ days: null }, { days: 30 }, { days: 90 }, { days: 180 }, { days: 365 }],
    onWindowChange: () => undefined,
    showWindow: true,
    children: (
      <CleanupImpact
        action="Delete"
        count={84}
        includesArchived={false}
        olderThanDays={180}
        note="Undo from Activity for 30 days."
      />
    ),
  },
} satisfies Meta<typeof CleanupPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Archived: Story = {
  args: {
    children: (
      <CleanupImpact
        action="Delete"
        count={410}
        includesArchived
        olderThanDays={180}
        note="Undo from Activity for 30 days."
      />
    ),
  },
};
/** The parent owns loading/failure status and blocks confirmation in both states. */
export const Unresolved: Story = {
  args: {
    children: (
      <CleanupImpact
        action="Delete"
        count={null}
        includesArchived={false}
        olderThanDays={180}
        note=""
      />
    ),
  },
};
export const Empty: Story = {
  args: {
    children: (
      <CleanupImpact
        action="Delete"
        count={0}
        includesArchived={false}
        olderThanDays={180}
        note=""
      />
    ),
  },
};
export const MissingAgeBucket: Story = {
  args: { options: [{ days: null }, { days: 180, disabled: true }], children: null },
};

export const VerifiedNoCurrentMail: Story = {
  args: {
    children: (
      <CleanupImpact
        action="Delete"
        count={0}
        includesArchived={false}
        olderThanDays={null}
        emptyContext={{ inboxTotal: 0, allMailTotal: 0 }}
        note=""
      />
    ),
  },
};
export const AgeExcludesMail: Story = {
  args: {
    children: (
      <CleanupImpact
        action="Delete"
        count={0}
        includesArchived={false}
        olderThanDays={180}
        emptyContext={{ inboxTotal: 2, allMailTotal: 5, onAnyAge: () => undefined }}
        note=""
      />
    ),
  },
};
export const ArchivedOutsideScope: Story = {
  args: {
    children: (
      <CleanupImpact
        action="Delete"
        count={0}
        includesArchived={false}
        olderThanDays={null}
        emptyContext={{ inboxTotal: 0, allMailTotal: 5, onIncludeArchived: () => undefined }}
        note=""
      />
    ),
  },
};
