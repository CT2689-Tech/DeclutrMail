import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, userEvent, within } from 'storybook/test';
import { AutopilotScreen } from './autopilot-screen';
import { PENDING_SUGGESTIONS, PRESET_RULES_ALL_FIVE } from './fixtures';
import { SenderRuleLibraryScope } from './sender-rule-library';
import { SenderRuleStoryFrame, type SenderRuleStoryScenario } from './sender-rule-library.stories';

function Workspace({ scenario }: { scenario: SenderRuleStoryScenario }) {
  return (
    <SenderRuleStoryFrame scenario={scenario}>
      <AutopilotScreen
        embedded
        state={{
          kind: 'ready',
          rules: PRESET_RULES_ALL_FIVE,
          suggestions:
            scenario === 'empty'
              ? []
              : PENDING_SUGGESTIONS.map((match) => ({
                  match,
                  rule: PRESET_RULES_ALL_FIVE.find((rule) => rule.id === match.ruleId) ?? null,
                })),
        }}
        renderLibrary={(renderPresetRule, workspace, renderReview) => (
          <SenderRuleLibraryScope
            mailboxId="story-autopilot-mailbox"
            presetRules={PRESET_RULES_ALL_FIVE}
            presetsAvailable
            renderPresetRule={renderPresetRule}
            workspace={workspace}
            renderReview={renderReview}
          />
        )}
      />
    </SenderRuleStoryFrame>
  );
}

const meta = {
  title: 'Autopilot/Workspace',
  component: Workspace,
  args: { scenario: 'growing' },
  tags: ['!autodocs'],
  parameters: { layout: 'fullscreen', controls: { disable: true } },
} satisfies Meta<typeof Workspace>;
export default meta;
type Story = StoryObj<typeof meta>;
export const NeedsReview: Story = {};
export const EmptyReview: Story = { args: { scenario: 'empty' } };
export const LoadingSavedMatches: Story = { args: { scenario: 'loading' } };
export const FailedSavedMatches: Story = { args: { scenario: 'error' } };
export const RuleCustomization: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: /^Your rules/ }));
    await userEvent.click(canvas.getByRole('button', { name: 'Edit rule Newsletter graveyard' }));
    await expect(
      canvas.getByRole('form', { name: 'Customize Newsletter graveyard' }),
    ).toBeVisible();
    await expect(
      canvas.getByRole('spinbutton', { name: 'Last email more than (days ago)' }),
    ).toHaveValue(90);
    await expect(canvas.queryByRole('heading', { name: 'Needs review' })).not.toBeInTheDocument();
  },
};
