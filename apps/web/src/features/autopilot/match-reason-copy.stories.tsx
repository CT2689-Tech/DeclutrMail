import { MatchReasonCopy } from './match-reason-copy';
import { tokens } from '@declutrmail/shared';
import { PendingSuggestionRow } from './pending-suggestion-row';
import { RulePreviewSample } from './rule-preview-panel';
import {
  AUTO_ARCHIVE_LOW_ENGAGEMENT,
  NEWSLETTER_GRAVEYARD,
  PENDING_SUGGESTIONS,
  RULE_PREVIEW_RESULT,
  SCREEN_NEW_SENDERS,
} from './fixtures';

export default {
  title: 'Autopilot/MatchReasonCopy',
  component: MatchReasonCopy,
  parameters: { layout: 'padded' },
};

export const Archive = {
  args: { reason: 'Engine verdict=Archive @0.82 above threshold 0.72', prefix: 'Why suggested: ' },
};
export const Unsubscribe = {
  args: { reason: 'Engine verdict=Unsubscribe @0.95 above threshold 0.90' },
};
export const Dormant = {
  args: { reason: 'Read rate 4% across all 25 messages, last seen 105d ago' },
};
export const NewSender = { args: { reason: 'New sender (1d old, 1 msgs)' } };
export const Legacy = { args: { reason: 'monthly_volume=47, read_rate=0.04' } };
export const Unavailable = { args: { reason: '' } };

export const InContext = {
  render: () => (
    <section style={{ fontFamily: tokens.font.sans, color: tokens.color.fg, maxWidth: 900 }}>
      <p>Development preview · fictional sender data</p>
      <h2>Pending suggestions</h2>
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {PENDING_SUGGESTIONS.map((match, index) => (
          <PendingSuggestionRow
            key={match.id}
            match={{
              ...match,
              ruleId: [
                AUTO_ARCHIVE_LOW_ENGAGEMENT.id,
                SCREEN_NEW_SENDERS.id,
                NEWSLETTER_GRAVEYARD.id,
              ][index]!,
              reason: [Archive.args.reason, 'New sender (1d old, 1 msgs)', Dormant.args.reason][
                index
              ]!,
            }}
            rule={[AUTO_ARCHIVE_LOW_ENGAGEMENT, SCREEN_NEW_SENDERS, NEWSLETTER_GRAVEYARD][index]!}
            selected={false}
            onToggleSelect={() => undefined}
            onDismiss={() => undefined}
            isDismissing={false}
          />
        ))}
      </ul>
      <h2>Read-only rule preview</h2>
      <RulePreviewSample
        ruleName="Review low-engagement senders"
        result={{
          ...RULE_PREVIEW_RESULT,
          sample: [{ ...RULE_PREVIEW_RESULT.sample[0]!, reason: Archive.args.reason }],
        }}
      />
    </section>
  ),
};
