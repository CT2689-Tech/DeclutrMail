import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FirstCleanupNudge, shouldShowFirstCleanupNudge } from './first-cleanup-nudge';

describe('shouldShowFirstCleanupNudge', () => {
  const show = {
    mailboxReady: true,
    hasCompletedCleanup: false,
    visibleSenderCount: 3,
  };

  it('shows only for a ready mailbox with senders and no completed cleanup', () => {
    expect(shouldShowFirstCleanupNudge(show)).toBe(true);
  });

  it('stays off when the summary field is absent (rolling-deploy unknown)', () => {
    expect(shouldShowFirstCleanupNudge({ ...show, hasCompletedCleanup: undefined })).toBe(false);
  });

  it('stays off after the first completed action_jobs row', () => {
    expect(shouldShowFirstCleanupNudge({ ...show, hasCompletedCleanup: true })).toBe(false);
  });

  it('stays off while the mailbox is not ready', () => {
    expect(shouldShowFirstCleanupNudge({ ...show, mailboxReady: false })).toBe(false);
  });

  it('stays off when there is no sender to pick', () => {
    expect(shouldShowFirstCleanupNudge({ ...show, visibleSenderCount: 0 })).toBe(false);
  });
});

describe('<FirstCleanupNudge />', () => {
  it('names the next step and links the first sender', () => {
    render(<FirstCleanupNudge href="/senders/a" />);
    expect(screen.getByRole('region', { name: 'Finish first cleanup' })).toBeInTheDocument();
    expect(screen.getByText('Pick one sender')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open a sender' })).toHaveAttribute(
      'href',
      '/senders/a',
    );
  });
});
