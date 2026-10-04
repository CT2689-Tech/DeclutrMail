import { fireEvent, render, screen } from '@testing-library/react';
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
