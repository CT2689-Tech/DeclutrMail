import { PresetRuleEditor } from './preset-rule-editor';
import { AUTO_ARCHIVE_LOW_ENGAGEMENT, NEWSLETTER_GRAVEYARD } from './fixtures';

export default {
  title: 'Autopilot/PresetRuleEditor',
  component: PresetRuleEditor,
  parameters: { layout: 'padded' },
};
const args = {
  rule: NEWSLETTER_GRAVEYARD,
  saving: false,
  onSave: async () => null,
  onCancel: () => undefined,
};
export const Dormancy = { args };
export const Recommendation = { args: { ...args, rule: AUTO_ARCHIVE_LOW_ENGAGEMENT } };
export const Saving = { args: { ...args, saving: true } };
export const ReadUnavailable = { args: { ...args, disabled: true } };
export const ApprovedWorkConflict = {
  args: {
    ...args,
    onSave: async () =>
      'This rule has approved work waiting or running. Review the approved batch, then save your changes.',
  },
};
export const Paused = { args: { ...args, rule: { ...NEWSLETTER_GRAVEYARD, mode: 'paused' } } };
