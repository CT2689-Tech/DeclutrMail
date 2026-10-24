import type { ComponentProps } from 'react';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { FIXTURE_RULES } from './sender-rule-browser-data.fixture';
import { SenderRuleEditor } from './sender-rule-editor';
import { SenderRuleStoryFrame, type SenderRuleStoryScenario } from './sender-rule-library.stories';
import styles from './sender-rule-library.module.css';

type EditorStoryArgs = ComponentProps<typeof SenderRuleEditor> & {
  scenario: SenderRuleStoryScenario;
};
const selectedRule = FIXTURE_RULES[0]!;
const meta = {
  title: 'Autopilot/SenderRuleEditor',
  component: SenderRuleEditor,
  args: {
    scenario: 'growing',
    rule: null,
    mailboxId: 'story-autopilot-mailbox',
    saving: false,
    error: null,
    onSave: fn(),
    onCancel: fn(),
  },
  // Each canvas temporarily owns fetch; avoid concurrent fixtures in autodocs.
  tags: ['!autodocs'],
  parameters: { layout: 'fullscreen', controls: { disable: true } },
  render: ({ scenario, ...props }) => (
    <SenderRuleStoryFrame key={scenario} scenario={scenario}>
      <section className={styles.card} style={{ maxWidth: 650, margin: '0 auto' }}>
        <SenderRuleEditor {...props} />
      </section>
    </SenderRuleStoryFrame>
  ),
} satisfies Meta<EditorStoryArgs>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Create: Story = {};
export const EditSelectedSenders: Story = { args: { rule: selectedRule } };
export const DeleteInboxAndArchived: Story = {
  args: { rule: { ...selectedRule, action: 'delete', reach: 'all_mail', olderThanDays: 180 } },
};
export const ArchiveInboxOnly: Story = {
  args: { rule: { ...selectedRule, action: 'archive', reach: 'inbox_only', olderThanDays: 90 } },
};
export const SenderSearchLoading: Story = {
  args: { scenario: 'sender-loading', rule: selectedRule },
};
export const SenderSearchUnavailable: Story = {
  args: { scenario: 'sender-error', rule: selectedRule },
};
export const Saving: Story = { args: { rule: selectedRule, saving: true } };
export const SaveFailed: Story = {
  args: { rule: selectedRule, error: 'Save couldn’t be verified. Try again.' },
};
export const ProtectedSender: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('checkbox', { name: /Family Book Club/ })).toBeDisabled();
  },
};
export const SearchKeepsSelection: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(
      await canvas.findByRole('textbox', { name: 'Rule name' }),
      'Senders I chose',
    );
    await userEvent.click(await canvas.findByRole('checkbox', { name: /Studio Weekly/ }));
    await userEvent.type(canvas.getByRole('searchbox', { name: 'Search name or email' }), 'Market');
    await waitFor(() => {
      expect(canvas.queryByRole('checkbox', { name: /Studio Weekly/ })).not.toBeInTheDocument();
      expect(canvas.getByRole('checkbox', { name: /Market Notes/ })).toBeVisible();
    });
    await userEvent.click(canvas.getByRole('checkbox', { name: /Market Notes/ }));
    await expect(canvas.getByRole('button', { name: 'Remove Studio Weekly' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Remove Market Notes' })).toBeVisible();
  },
};
export const NoSearchMatches: Story = {
  args: { rule: selectedRule },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(
      await canvas.findByRole('searchbox', { name: 'Search name or email' }),
      'No matching sender',
    );
    await expect(
      await canvas.findByText('No matching senders. Your selections are kept.'),
    ).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Remove Studio Weekly' })).toBeVisible();
  },
};
export const MissingSelection: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Save rule' }));
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'Add a rule name and choose at least one sender.',
    );
    await expect(args.onSave).not.toHaveBeenCalled();
  },
};
