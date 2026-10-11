import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

const gate = vi.hoisted(() => ({ showReport: false }));

vi.mock('@/features/inbox-report', () => ({
  InboxReportCard: () =>
    gate.showReport ? (
      <p data-inbox-report>
        91% of the email you got in the last 90 days came from 195 senders you mostly leave unread.
      </p>
    ) : null,
  getFixSet: () => [],
}));

vi.mock('@declutrmail/shared/copy/launch', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@declutrmail/shared/copy/launch');
  return {
    ...actual,
    WS5_COPY: {
      'report.mostlyUnread.headline': {
        one: '{pct}% of the email you got in the last 90 days came from 1 sender you mostly leave unread.',
        other:
          '{pct}% of the email you got in the last 90 days came from {n} senders you mostly leave unread.',
      },
      'report.fix.heading': {
        one: '1 of these senders includes an unsubscribe link.',
        other: '{n} of these senders include an unsubscribe link.',
      },
      'report.fix.primary': {
        one: 'Unsubscribe + archive 1 sender',
        other: 'Unsubscribe + archive {n} senders',
      },
      'report.fix.review': 'Review them first',
      'report.mostlyUnread.support': {
        one: 'It had less than 10% of its email marked read in Gmail in that time.',
        other: 'Each had less than 10% of its email marked read in Gmail in that time.',
      },
      'f1.title.archive': {
        one: 'Unsubscribe from {Sender} and archive 1 email?',
        other: 'Unsubscribe from {Sender} and archive {n} emails?',
      },
      'f1.title.bulk.archive': 'Unsubscribe from {k} senders and archive {n} emails?',
      'f1.button.archive': 'Unsubscribe + Archive',
      'f1.button.cancel': 'Cancel',
      'f1.honesty.archive':
        'The unsubscribe request can’t be recalled once delivered. The archive can be undone from Activity for 30 days.',
      'report.home.title': 'Your Inbox Report',
      'report.home.body':
        'A quick look at who sends you the most, what you leave unread and what takes up space.',
      'report.home.cta': 'Open report',
      'report.trust':
        'This report uses only the sender, date, size, labels and read/unread status of your email, plus who you’ve emailed. We never fetch or store full email contents.',
      'report.trust.link': 'What we store and share',
    },
  };
});

import { HomeFixDialog } from './home-fix-dialog';
import { HomeView } from './home-view';
import type { HomeFixCandidate } from './home-next-steps';

const step: HomeFixCandidate = {
  kind: 'unsub_archive',
  senderCount: 158,
  emailCount: 1200,
  senderIds: ['s1'],
};

function Harness({ onConfirm }: { onConfirm: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open fix
      </button>
      {open && <HomeFixDialog step={step} onCancel={() => setOpen(false)} onConfirm={onConfirm} />}
    </>
  );
}

const ready = {
  kind: 'ready' as const,
  hero: { label: 'emails cleared', value: 12 },
  since: null,
  secondary: [],
  action: { label: 'Review senders', href: '/senders' },
};

describe('Home unsubscribe step', () => {
  it('hides the sender count until the report names those senders', async () => {
    gate.showReport = false;
    const { rerender } = render(<HomeView state={ready} nextSteps={[step]} />);
    expect(screen.getByRole('heading', { name: 'Your Inbox Report' })).toBeInTheDocument();
    expect(screen.queryByText(/of these senders/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Unsubscribe \+ archive/ })).toBeNull();

    gate.showReport = true;
    rerender(<HomeView state={ready} nextSteps={[step]} />);
    expect(
      await screen.findByRole('button', { name: 'Unsubscribe + archive 158 senders' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/195 senders you mostly leave unread/)).toBeInTheDocument();
    expect(screen.getByText(/158 of these senders/)).toBeInTheDocument();
  });
});

describe('HomeFixDialog focus trap', () => {
  it('traps focus on Cancel, wraps Tab, ignores Enter, and restores focus on Escape', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    const open = screen.getByRole('button', { name: 'Open fix' });
    await user.click(open);

    const dialog = screen.getByRole('alertdialog');
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const confirm = screen.getByRole('button', { name: 'Unsubscribe + Archive' });
    await waitFor(() => expect(cancel).toHaveFocus());

    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(confirm).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(cancel).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    await waitFor(() => expect(open).toHaveFocus());
  });
});
