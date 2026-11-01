// Storybook CSF3 stories for the Settings group grammar: one raised
// surface of rows, a DrillRow that navigates (href) or opens something in
// place (onClick), and a footer under the rows. Same lightweight local CSF
// shims as the sibling settings stories.

import { Button } from '@declutrmail/shared';

import { DrillRow, SettingsGroup, SettingsRow } from './settings-list';

type StoryMeta<C extends (...args: never) => unknown> = {
  title: string;
  component: C;
  parameters?: Record<string, unknown>;
};

type Story = { render: () => React.ReactElement };

const meta: StoryMeta<typeof SettingsGroup> = {
  title: 'Settings/SettingsGroup',
  component: SettingsGroup,
  parameters: { layout: 'padded' },
};
export default meta;

const noop = () => {};

/** A plan row with its action, then a row that opens a preview in place. */
export const RowsWithButtonDrill: Story = {
  render: () => (
    <SettingsGroup title="Current plan">
      <SettingsRow label="Plus" detail="$59/yr · Renews Dec 1, 2026">
        <Button tone="default" onClick={noop}>
          Change plan
        </Button>
      </SettingsRow>
      <DrillRow onClick={noop} label="Review cancellation" />
    </SettingsGroup>
  ),
};

/** Rows that navigate, with a value beside one of them. */
export const LinkDrills: Story = {
  render: () => (
    <SettingsGroup title="Help">
      <DrillRow href="/settings#mailboxes" label="Gmail accounts" value="1 of 2 connected" />
      <DrillRow href="/refunds" label="Refund policy" />
    </SettingsGroup>
  ),
};

/** A footer sits under the rows, outside the raised surface. */
export const WithFooter: Story = {
  render: () => (
    <SettingsGroup
      title="Your plan includes"
      footer={
        <p style={{ margin: '10px 0 0' }}>
          Your connected Gmail accounts keep working. You can add another once you’re under this
          plan’s limit.
        </p>
      }
    >
      <DrillRow href="/settings#mailboxes" label="Gmail accounts" value="2 of 1 connected" />
    </SettingsGroup>
  ),
};
