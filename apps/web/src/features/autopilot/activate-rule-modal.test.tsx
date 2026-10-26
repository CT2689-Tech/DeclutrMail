import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ActivateRuleModal } from './activate-rule-modal';
import {
  AUTO_ARCHIVE_LOW_ENGAGEMENT,
  AUTO_UNSUBSCRIBE_NOISY,
  RULE_PREVIEW_RESULT,
  SCREEN_NEW_SENDERS,
} from './fixtures';

describe('ActivateRuleModal review-only presets', () => {
  it.each([AUTO_ARCHIVE_LOW_ENGAGEMENT, SCREEN_NEW_SENDERS])(
    'withholds Act now for $presetKey even when unattended capability is true',
    (rule) => {
      const onConfirm = vi.fn();
      const onWatchFirst = vi.fn();
      render(
        <ActivateRuleModal
          rule={{ ...rule, enabled: false }}
          intent="enable"
          canRunUnattended
          pendingCount={2}
          pendingApproximate={false}
          undoWindowDays={30}
          preview={{ status: 'ready', result: RULE_PREVIEW_RESULT }}
          onRetryPreview={vi.fn()}
          onWatchFirst={onWatchFirst}
          isActivating={false}
          error={null}
          onCancel={vi.fn()}
          onConfirm={onConfirm}
        />,
      );

      expect(screen.queryByRole('radio', { name: 'Act now' })).not.toBeInTheDocument();
      expect(
        screen.queryByText('Acts on matching email now and as it arrives.'),
      ).not.toBeInTheDocument();
      expect(screen.getByText(/No mail moves until you approve a suggestion/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));
      expect(onConfirm).toHaveBeenCalledOnce();
      expect(onWatchFirst).not.toHaveBeenCalled();
    },
  );

  it('retains both execution choices for a preset that can act unattended', () => {
    render(
      <ActivateRuleModal
        rule={{ ...AUTO_UNSUBSCRIBE_NOISY, enabled: false }}
        intent="enable"
        canRunUnattended
        pendingCount={2}
        pendingApproximate={false}
        undoWindowDays={30}
        preview={{ status: 'ready', result: RULE_PREVIEW_RESULT }}
        onRetryPreview={vi.fn()}
        onWatchFirst={vi.fn()}
        isActivating={false}
        error={null}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByRole('radio', { name: 'Act now' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Watch first' })).toBeInTheDocument();
  });
});

function previewProps(rule = AUTO_ARCHIVE_LOW_ENGAGEMENT) {
  return {
    rule: { ...rule, enabled: false },
    intent: 'enable' as const,
    canRunUnattended: true,
    pendingCount: 0,
    pendingApproximate: false,
    undoWindowDays: 30,
    isActivating: false,
    error: null,
    onRetryPreview: vi.fn(),
    onCancel: vi.fn(),
    onConfirm: vi.fn(),
    onWatchFirst: vi.fn(),
    preview: {
      status: 'ready' as const,
      result: {
        ...RULE_PREVIEW_RESULT,
        dailyActionCap: rule.actionKind === 'unsubscribe' ? 25 : 100,
        wouldMatchCount: 1,
        actionableSenderCount: 0,
        actionableMessageCount: 0,
        protectedWouldMatchCount: 0,
        sample: [{ ...RULE_PREVIEW_RESULT.sample[0]!, inboxCount: 0 }],
      },
    },
  };
}

it.each([
  [AUTO_ARCHIVE_LOW_ENGAGEMENT, 'with Inbox email to Archive', 'no Inbox email to Archive'],
  [SCREEN_NEW_SENDERS, 'with Inbox email to move to Later', 'no Inbox email to move to Later'],
  [AUTO_UNSUBSCRIBE_NOISY, 'eligible for Unsubscribe', 'already unsubscribed'],
  [
    { ...AUTO_ARCHIVE_LOW_ENGAGEMENT, actionKind: 'delete' as const },
    'with email to Delete',
    'no email in this rule’s scope to Delete',
  ],
])('explains zero eligibility alongside historical matches (%#)', (rule, label, reason) => {
  render(<ActivateRuleModal {...previewProps(rule)} />);
  const dialog = within(screen.getByRole('dialog'));
  expect(dialog.getByText('0', { selector: 'strong' })).toBeInTheDocument();
  expect(dialog.getByText(new RegExp(label))).toBeInTheDocument();
  expect(dialog.getByText(new RegExp(`1 matching sender.*${reason}`))).toBeInTheDocument();
  expect(dialog.queryByText(/ready for review|actionable now/i)).not.toBeInTheDocument();
});

it('describes watching and approval when Watch first is selected', () => {
  render(<ActivateRuleModal {...previewProps(AUTO_UNSUBSCRIBE_NOISY)} />);
  fireEvent.click(screen.getByRole('radio', { name: 'Watch first' }));
  expect(screen.getByText(/You approve each one/)).toBeInTheDocument();
  expect(
    screen.getByText(/No unsubscribe requests until you approve a suggestion/),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByText('Details', { exact: true }));
  expect(screen.getByText('If approved')).toBeInTheDocument();
  expect(screen.getByText(/Up to 25 actions per day/)).toBeInTheDocument();
  expect(screen.queryByText(/rest wait for the next check/)).not.toBeInTheDocument();
});

it('describes frozen batches rather than suggestions for Delete', () => {
  render(
    <ActivateRuleModal
      {...previewProps({ ...AUTO_ARCHIVE_LOW_ENGAGEMENT, actionKind: 'delete' })}
    />,
  );
  expect(screen.getByText(/Review matching email in a batch/)).toBeInTheDocument();
  expect(
    screen.getByText(/Preview and approve each batch before emails move to Trash/),
  ).toBeInTheDocument();
  expect(
    screen.queryByText(/Matches become suggestions|approve a suggestion/),
  ).not.toBeInTheDocument();
});
