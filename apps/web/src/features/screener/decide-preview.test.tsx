import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SCREENER_QUEUE } from './data';
import { DecidePreview } from './decide-preview';

const row = SCREENER_QUEUE[0]!;

describe('DecidePreview — live-preview confirm gate', () => {
  it.each(['archive', 'later', 'delete'] as const)(
    'blocks %s click confirmation while the mail-moving preview is unavailable',
    (verb) => {
      const onConfirm = vi.fn();
      render(
        <DecidePreview
          verb={verb}
          row={row}
          inboxCount="unavailable"
          confirming={false}
          onConfirm={onConfirm}
          onCancel={() => {}}
        />,
      );

      const confirm = screen.getByRole('button', { name: new RegExp(`Confirm ${verb}`, 'i') });
      expect(confirm).toBeDisabled();
      fireEvent.click(confirm);
      expect(onConfirm).not.toHaveBeenCalled();
      expect(screen.getByText(/Cancel and retry/i)).toBeInTheDocument();
    },
  );

  it('blocks click confirmation while a required preview is still loading', () => {
    const onConfirm = vi.fn();
    render(
      <DecidePreview
        verb="archive"
        row={row}
        inboxCount="loading"
        confirming={false}
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );

    const confirm = screen.getByRole('button', { name: /Confirm Archive/i });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText(/Counting the inbox/i)).toBeInTheDocument();
  });

  it.each(['keep', 'unsubscribe'] as const)(
    'keeps %s confirmable without an inbox preview because it moves no current mail',
    (verb) => {
      const onConfirm = vi.fn();
      render(
        <DecidePreview
          verb={verb}
          row={row}
          inboxCount="unavailable"
          confirming={false}
          onConfirm={onConfirm}
          onCancel={() => {}}
        />,
      );

      const confirm = screen.getByRole('button', { name: new RegExp(`Confirm ${verb}`, 'i') });
      expect(confirm).toBeEnabled();
      fireEvent.click(confirm);
      expect(onConfirm).toHaveBeenCalledTimes(1);
    },
  );

  it('unlocks a mail-moving decision with current-match and execution re-check copy', () => {
    const onConfirm = vi.fn();
    render(
      <DecidePreview
        verb="archive"
        row={row}
        inboxCount={2}
        confirming={false}
        mailboxEmail="active@gmail.com"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );

    const confirm = screen.getByRole('button', { name: /Confirm Archive/i });
    expect(confirm).toBeEnabled();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText(/emails in Inbox now/i)).toBeInTheDocument();
    expect(screen.getByText(/Rechecked when it runs/i)).toBeInTheDocument();
    expect(screen.getByRole('note', { name: 'Gmail account: active@gmail.com' })).toBeVisible();
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe('DecidePreview — ADR-0028 reach chips (Delete only)', () => {
  it('renders the chip pair with both live counts, defaulting to Inbox only', () => {
    render(
      <DecidePreview
        verb="delete"
        row={row}
        inboxCount={2}
        allMailCount={9}
        reach="inbox_only"
        onReachChange={() => {}}
        confirming={false}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(screen.getByRole('radiogroup', { name: 'Where it applies' })).toBeInTheDocument();
    const inboxChip = screen.getByRole('radio', { name: /Inbox only/ });
    const allMailChip = screen.getByRole('radio', { name: /Inbox \+ archived/ });
    expect(inboxChip).toHaveAttribute('aria-checked', 'true');
    expect(allMailChip).toHaveAttribute('aria-checked', 'false');
    expect(inboxChip).toHaveTextContent('2');
    expect(allMailChip).toHaveTextContent('9');
    // Default reach keeps the inbox-scoped title + caption.
    expect(screen.getByText(`Delete ${row.senderName}'s inbox email`)).toBeInTheDocument();
    expect(screen.getByText(/in Inbox now/i)).toBeInTheDocument();
  });

  it('hides the chips on a non-Delete verb and when the all-mail block is absent', () => {
    const { rerender } = render(
      <DecidePreview
        verb="archive"
        row={row}
        inboxCount={2}
        allMailCount={9}
        confirming={false}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.queryByRole('radiogroup')).toBeNull();

    // Delete against an API predating the field (deploy skew) — the
    // choice simply does not appear.
    rerender(
      <DecidePreview
        verb="delete"
        row={row}
        inboxCount={2}
        allMailCount={null}
        confirming={false}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  it('reports a chip click and, at the widened reach, restates title, figure, caption, exclusions', () => {
    const onReachChange = vi.fn();
    const props = {
      verb: 'delete' as const,
      row,
      inboxCount: 2,
      allMailCount: 9,
      onReachChange,
      confirming: false,
      onConfirm: () => {},
      onCancel: () => {},
    };
    const { rerender } = render(<DecidePreview {...props} reach="inbox_only" />);

    fireEvent.click(screen.getByRole('radio', { name: /Inbox \+ archived/ }));
    expect(onReachChange).toHaveBeenCalledWith('all_mail');

    rerender(<DecidePreview {...props} reach="all_mail" />);
    expect(
      screen.getByText(`Delete ${row.senderName}'s inbox + archived email`),
    ).toBeInTheDocument();
    // The armed headline figure IS the all-mail count — '9' appears on
    // the chip and the headline, while '2' remains only on the inbox chip.
    expect(screen.getAllByText('9')).toHaveLength(2);
    expect(screen.getAllByText('2')).toHaveLength(1);
    expect(screen.getByText(/across inbox \+ archived/i)).toBeInTheDocument();
    expect(screen.getByText(/Trash, Spam, Drafts and Chat are never touched/i)).toBeInTheDocument();
  });

  it('softens the empty-inbox notice when the reach control is on screen (ADR-0028 wording)', () => {
    render(
      <DecidePreview
        verb="delete"
        row={row}
        inboxCount={0}
        allMailCount={3}
        reach="inbox_only"
        onReachChange={() => {}}
        confirming={false}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    // "only acts on mail still in the inbox" would be false right under
    // the chip that reaches past it.
    expect(screen.getByText(/Delete acts on inbox email by default\./)).toBeInTheDocument();
    expect(screen.queryByText(/only acts on email still in the inbox/)).toBeNull();
  });

  it('keeps the absolute empty-inbox wording when no reach control is offered', () => {
    render(
      <DecidePreview
        verb="delete"
        row={row}
        inboxCount={0}
        allMailCount={null}
        confirming={false}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText(/Delete only acts on email still in the inbox\./)).toBeInTheDocument();
  });
});

describe('DecidePreview — Delete default window (QA-delete-20260829-01)', () => {
  it('names the active window next to the live count, and only for Delete', () => {
    render(
      <DecidePreview
        verb="delete"
        row={row}
        inboxCount={2}
        inboxTotal={9}
        windowDays={180}
        confirming={false}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText(/in Inbox now \(older than 6 months\+\)/i)).toBeInTheDocument();
  });

  it('stays silent when no window is active (every non-Delete verb)', () => {
    render(
      <DecidePreview
        verb="archive"
        row={row}
        inboxCount={2}
        windowDays={null}
        confirming={false}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.queryByText(/older than/i)).toBeNull();
  });

  it('gives the same empty-window notice the senders confirm modal gives, instead of a silent 0', () => {
    render(
      <DecidePreview
        verb="delete"
        row={row}
        inboxCount={0}
        inboxTotal={9}
        windowDays={180}
        confirming={false}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    // Not the empty-INBOX wording ("Nothing from ... is in your inbox
    // right now") — 9 messages ARE in the inbox, just none inside the
    // window. A reader seeing a bare "0" with no explanation is exactly
    // the bug this fixes.
    expect(screen.queryByText(/is in your inbox right now/i)).toBeNull();
    expect(
      screen.getByText(/9 emails from this sender are in your inbox, but none are older than/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/the 6 months\+ window/i)).toBeInTheDocument();
    // Codex review 2026-09-03 (QA-delete-20260903-01): the zero-match
    // header must not contradict this exact notice — "Nothing to move"
    // would sit directly above "9 emails ... are in your inbox."
    expect(screen.queryByText(/Nothing to move/)).toBeNull();
    expect(screen.getByText(`Delete ${row.senderName}'s inbox email`)).toBeInTheDocument();
  });

  it('applies no window qualifier or empty-window notice at all-mail reach', () => {
    render(
      <DecidePreview
        verb="delete"
        row={row}
        inboxCount={0}
        inboxTotal={9}
        windowDays={180}
        allMailCount={3}
        reach="all_mail"
        onReachChange={() => {}}
        confirming={false}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.queryByText(/older than/i)).toBeNull();
  });
});

// QA-archive-20260903-01: this dialog rendered the frozen `reasoning`
// sentence with no indication of when it was scored — the identical gap
// QA-archive-20260828-02 already fixed on Triage's own D226 preview.
describe('DecidePreview — reasoning age label (QA-archive-20260903-01)', () => {
  it('states how old the reasoning is when scoredAt is known', async () => {
    const scoredAt = new Date(Date.now() - 60_000).toISOString(); // 1 minute ago
    render(
      <DecidePreview
        verb="archive"
        row={{ ...row, recommendation: { ...row.recommendation!, scoredAt } }}
        inboxCount={2}
        confirming={false}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    // "Scored" → "Last checked" — shared across Sender Detail, Triage,
    // and the Screener (QA-sender-detail-20260902-08).
    expect(await screen.findByText('Last checked today')).toBeInTheDocument();
  });

  it('renders no age label when scoredAt is unknown (demo/simulator rows)', () => {
    expect(row.recommendation?.scoredAt).toBeUndefined(); // fixture precondition
    render(
      <DecidePreview
        verb="archive"
        row={row}
        inboxCount={2}
        confirming={false}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.queryByText(/^Last checked /)).toBeNull();
    // The reasoning itself still renders — only the age label is gated.
    expect(screen.getByText('Why we suggested this:')).toBeInTheDocument();
  });
});

// QA-delete-20260903-01: a zero-match Archive/Later/Delete otherwise still
// read as an active move ("Delete X's inbox email") above a "0 matching
// emails" body — the identical gap QA-delete-20260829-08 already fixed on
// Triage's own D226 preview.
describe('DecidePreview — zero-match header (QA-delete-20260903-01)', () => {
  it.each(['archive', 'later', 'delete'] as const)(
    'reads "Nothing to move" for a zero-match %s, not an active-move header',
    (verb) => {
      render(
        <DecidePreview
          verb={verb}
          row={row}
          inboxCount={0}
          confirming={false}
          onConfirm={() => {}}
          onCancel={() => {}}
        />,
      );
      expect(
        screen.getByText(`Nothing to move from ${row.senderName} right now`),
      ).toBeInTheDocument();
    },
  );

  it('still reads "Nothing to move" when the window count AND the true total are both zero', () => {
    render(
      <DecidePreview
        verb="delete"
        row={row}
        inboxCount={0}
        inboxTotal={0}
        windowDays={180}
        confirming={false}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(
      screen.getByText(`Nothing to move from ${row.senderName} right now`),
    ).toBeInTheDocument();
  });

  // Codex review 2026-09-03, round 2: `inboxTotal` is always the
  // inbox-only unwindowed total, so it cannot answer "is all-mail reach
  // truly empty" — an empty inbox with archived mail outside the window
  // would still (wrongly) read `inboxTotal === 0` as a confident zero.
  it('does not claim "Nothing to move" at all-mail reach when archived mail exists outside the window', () => {
    render(
      <DecidePreview
        verb="delete"
        row={row}
        inboxCount={0}
        inboxTotal={0}
        windowDays={180}
        allMailCount={0}
        allMailTotal={5}
        reach="all_mail"
        onReachChange={() => {}}
        confirming={false}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.queryByText(/Nothing to move/)).toBeNull();
    expect(
      screen.getByText(`Delete ${row.senderName}'s inbox + archived email`),
    ).toBeInTheDocument();
  });

  it('still reads "Nothing to move" at all-mail reach when the true all-mail total is also zero', () => {
    render(
      <DecidePreview
        verb="delete"
        row={row}
        inboxCount={0}
        inboxTotal={0}
        windowDays={180}
        allMailCount={0}
        allMailTotal={0}
        reach="all_mail"
        onReachChange={() => {}}
        confirming={false}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(
      screen.getByText(`Nothing to move from ${row.senderName} right now`),
    ).toBeInTheDocument();
  });

  it('leaves Keep and Unsubscribe headers untouched — neither ever claims a move', () => {
    render(
      <DecidePreview
        verb="keep"
        row={row}
        inboxCount={0}
        confirming={false}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText(`Keep ${row.senderName}`)).toBeInTheDocument();
    expect(screen.queryByText(/Nothing to move/)).toBeNull();
  });

  it('keeps the active-move header once at least one email matches', () => {
    render(
      <DecidePreview
        verb="delete"
        row={row}
        inboxCount={1}
        confirming={false}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText(`Delete ${row.senderName}'s inbox email`)).toBeInTheDocument();
  });
});
