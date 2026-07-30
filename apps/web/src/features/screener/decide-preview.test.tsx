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
    expect(screen.getByText(/emails currently match in Inbox/i)).toBeInTheDocument();
    expect(screen.getByText(/Gmail is checked again at execution/i)).toBeInTheDocument();
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
    expect(screen.getByText(`Delete ${row.senderName}'s inbox mail`)).toBeInTheDocument();
    expect(screen.getByText(/currently match in Inbox/i)).toBeInTheDocument();
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
      screen.getByText(`Delete ${row.senderName}'s inbox + archived mail`),
    ).toBeInTheDocument();
    // The armed headline figure IS the all-mail count — '9' appears on
    // the chip and the headline, while '2' remains only on the inbox chip.
    expect(screen.getAllByText('9')).toHaveLength(2);
    expect(screen.getAllByText('2')).toHaveLength(1);
    expect(screen.getByText(/currently match across inbox \+ archived/i)).toBeInTheDocument();
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
    expect(screen.getByText(/Delete acts on inbox mail by default\./)).toBeInTheDocument();
    expect(screen.queryByText(/only acts on mail still in the inbox/)).toBeNull();
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
    expect(screen.getByText(/Delete only acts on mail still in the inbox\./)).toBeInTheDocument();
  });
});
