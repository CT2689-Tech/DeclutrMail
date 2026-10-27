import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WS5_COPY } from '@declutrmail/shared/copy/launch';
import { SCREENER_QUEUE } from './data';
import { DecidePreview } from './decide-preview';

const row = SCREENER_QUEUE[0]!;

describe('DecidePreview — inline keyboard navigation', () => {
  it('lets Tab leave the nonmodal Delete preview without cancelling it', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <>
        <DecidePreview
          verb="delete"
          row={row}
          inboxCount={4}
          windowDays={180}
          onWindowChange={vi.fn()}
          confirming={false}
          onConfirm={vi.fn()}
          onCancel={onCancel}
        />
        <button type="button">Next row action</button>
      </>,
    );
    const preview = screen.getByRole('region', { name: /^Preview · Delete / });
    const outside = screen.getByRole('button', { name: 'Next row action' });
    expect(preview).toHaveAttribute('data-dm-preview-mode', 'inline');
    expect(screen.queryByRole('dialog')).toBeNull();
    const confirm = screen.getByRole('button', { name: /^Delete/ });
    confirm.focus();
    await user.tab();
    expect(outside).toHaveFocus();
    await user.tab({ shift: true });
    expect(confirm).toHaveFocus();
    expect(onCancel).not.toHaveBeenCalled();
  });
});

describe('DecidePreview — live-preview confirm gate', () => {
  it('retries an unavailable preview without confirming or changing its selected age', () => {
    const onRetryPreview = vi.fn();
    const onConfirm = vi.fn();
    render(
      <DecidePreview
        verb="delete"
        row={row}
        inboxCount="unavailable"
        windowDays={180}
        onWindowChange={vi.fn()}
        confirming={false}
        onRetryPreview={onRetryPreview}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetryPreview).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('combobox', { name: 'Email age' })).toHaveValue('180');
    expect(screen.getByRole('button', { name: /^Delete for/ })).toBeDisabled();
  });
  it('keeps Archive inbox-only and any age with an editable age and no Delete scope', () => {
    const onConfirm = vi.fn();
    render(
      <DecidePreview
        verb="archive"
        row={row}
        inboxCount={128}
        allMailCount={146}
        onWindowChange={vi.fn()}
        onReachChange={vi.fn()}
        confirming={false}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('heading', { name: `Archive emails from ${row.senderName}?` }),
    ).toBeVisible();
    expect(screen.getByRole('region', { name: 'What Archive will do' })).toHaveTextContent(
      '128 emails will leave your inbox and stay in Gmail.Inbox only · Any age',
    );
    expect(screen.getByRole('combobox', { name: 'Email age' })).toHaveValue('all');
    expect(screen.queryByRole('checkbox', { name: 'Include archived email' })).toBeNull();
    expect(screen.queryByText(/Emails from before about/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: `Archive for ${row.senderName}` }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

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

      const confirm = screen.getByRole('button', { name: new RegExp(`^${verb}`, 'i') });
      expect(confirm).toBeDisabled();
      fireEvent.click(confirm);
      expect(onConfirm).not.toHaveBeenCalled();
      expect(screen.getByText(/couldn’t load the preview/i)).toBeInTheDocument();
    },
  );

  // The verb and the count, as on the Senders and Triage confirms.
  it('names the action on the confirm and keeps the live count in the impact summary', () => {
    render(
      <DecidePreview
        verb="archive"
        row={row}
        inboxCount={1400}
        confirming={false}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    // The accessible name contains the visible label, so "click Archive
    // 1,400" finds it (WCAG 2.5.3).
    const confirm = screen.getByRole('button', { name: /^Archive for/ });
    expect(confirm).toHaveTextContent(/^Archive$/);
    expect(screen.getByRole('region', { name: 'What Archive will do' })).toHaveTextContent(
      '1,400 emails will leave your inbox and stay in Gmail.',
    );
  });

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

    const confirm = screen.getByRole('button', { name: /^Archive/i });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText(/Counting the email you already have/)).toBeInTheDocument();
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

      const confirm = screen.getByRole('button', { name: new RegExp(`^${verb}`, 'i') });
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

    const confirm = screen.getByRole('button', { name: /^Archive/i });
    expect(confirm).toBeEnabled();
    // One bold line: the count and where it goes. Its scope sits in Details.
    expect(
      screen.getByRole('heading', { name: `Archive emails from ${row.senderName}?` }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Inbox only. We check again right before anything moves.'),
    ).toBeInTheDocument();
    const account = screen.getByRole('note', { name: 'Gmail account: active@gmail.com' });
    expect(account.closest('details')).toBeNull();
    expect(account).toBeVisible();
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe('DecidePreview — ADR-0028 reach chips (Delete only)', () => {
  it('renders Include archived email off by default, with the inbox count in the impact summary', () => {
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

    const includeArchived = screen.getByRole('checkbox', { name: 'Include archived email' });
    expect(includeArchived).not.toBeChecked();
    expect(includeArchived).toHaveStyle({ minHeight: '48px' });
    expect(
      screen.getByRole('heading', { name: `Delete emails from ${row.senderName}?` }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Both choices cover the same emails right now.')).toBeNull();
    expect(screen.getByRole('region', { name: 'What Delete will do' })).toHaveTextContent(
      '2 emails will move to Gmail Trash.',
    );
    expect(
      screen.getByText(/^Inbox only\. We check again right before anything moves/),
    ).toBeInTheDocument();
  });

  it('keeps the scope choice visible when inbox and all-mail counts match', () => {
    render(
      <DecidePreview
        verb="delete"
        row={row}
        inboxCount={4}
        allMailCount={4}
        reach="inbox_only"
        confirming={false}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByRole('checkbox', { name: 'Include archived email' })).toBeEnabled();
    expect(screen.getByRole('checkbox', { name: 'Include archived email' })).not.toBeChecked();
  });

  it('hides the checkbox on a non-Delete verb and disables it when archived mail cannot be counted', () => {
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
    expect(screen.queryByRole('checkbox', { name: 'Include archived email' })).toBeNull();

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
    const includeArchived = screen.getByRole('checkbox', { name: 'Include archived email' });
    expect(includeArchived).toBeDisabled();
    expect(includeArchived).not.toBeChecked();
    expect(screen.getByText(WS5_COPY['f1.preview.archived.unavailable'])).toBeInTheDocument();
  });

  it('reports a chip click and, at the widened reach, restates the headline, count scope, exclusions', () => {
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

    fireEvent.click(screen.getByRole('checkbox', { name: 'Include archived email' }));
    expect(onReachChange).toHaveBeenCalledWith('all_mail');

    rerender(<DecidePreview {...props} reach="all_mail" />);
    const impact = screen.getByRole('region', { name: 'What Delete will do' });
    expect(impact).toHaveTextContent('9 emails will move to Gmail Trash.');
    expect(impact).toHaveTextContent('Inbox and archived email');
    expect(screen.queryByText(/^2 emails from/)).toBeNull();
    expect(
      screen.getByText(/^Inbox and archived email\. We check again right before anything moves/),
    ).toBeInTheDocument();
    expect(screen.getByText('Puts each email back where it was')).toBeInTheDocument();
    expect(screen.getByText('Trash, Spam, Drafts, Chat')).toBeInTheDocument();
    expect(screen.queryByText(/They move to Gmail Trash/)).toBeNull();
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
  it('shows the existing selected age with a cutoff, and keeps the count out of Delete', () => {
    const onWindowChange = vi.fn();
    render(
      <DecidePreview
        verb="delete"
        row={row}
        inboxCount={2}
        inboxTotal={9}
        windowDays={180}
        onWindowChange={onWindowChange}
        confirming={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const age = screen.getByRole('combobox', { name: 'Email age' });
    expect(age).toHaveValue('180');
    expect(age).toHaveAccessibleDescription(/Emails from before about/);
    expect(screen.getByRole('option', { name: 'Older than 90 days' })).toBeEnabled();
    expect(screen.getByRole('button', { name: `Delete for ${row.senderName}` })).toHaveTextContent(
      /^Delete$/,
    );
    fireEvent.change(age, { target: { value: '30' } });
    expect(onWindowChange).toHaveBeenCalledWith(30);
  });

  it.each(['loading', 'unavailable'] as const)(
    'hides a cached archived impact while the preview is %s',
    (inboxCount) => {
      const onConfirm = vi.fn();
      render(
        <DecidePreview
          verb="delete"
          row={row}
          inboxCount={inboxCount}
          allMailCount={9}
          reach="all_mail"
          confirming={false}
          onConfirm={onConfirm}
          onCancel={vi.fn()}
        />,
      );
      expect(screen.queryByRole('region', { name: 'What Delete will do' })).toBeNull();
      const confirm = screen.getByRole('button', { name: `Delete for ${row.senderName}` });
      expect(confirm).toBeDisabled();
      fireEvent.click(confirm);
      expect(onConfirm).not.toHaveBeenCalled();
    },
  );

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
    expect(
      screen.getByText(
        'Inbox only (older than 180 days). We check again right before anything moves.',
      ),
    ).toBeInTheDocument();
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
    // Pins the facts — the true inbox total and the window — not the
    // shared sentence around them (packages/shared inbox-scope owns that).
    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent(/\b9\b/);
    expect(notice).toHaveTextContent(/older than/i);
    expect(notice).toHaveTextContent(/180 days/i);
    // Codex review 2026-09-03 (QA-delete-20260903-01): the zero-match
    // header must not contradict this exact notice — "Nothing to move"
    // would sit directly above "9 emails ... are in your inbox."
    expect(screen.queryByText(/Nothing to move/)).toBeNull();
    expect(screen.getByRole('region', { name: 'What Delete will do' })).toHaveTextContent(
      'No emails match these choices.',
    );
  });

  it('names the selected time window at all-mail reach without an inbox-only notice', () => {
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
    expect(
      screen.getByText(
        'Inbox and archived email (older than 180 days). We check again right before anything moves.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('lets the reader widen Delete to any age and blocks a zero-count Delete', () => {
    const onWindowChange = vi.fn();
    render(
      <DecidePreview
        verb="delete"
        row={row}
        inboxCount={0}
        inboxTotal={2}
        windowDays={180}
        onWindowChange={onWindowChange}
        confirming={false}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /^Delete/i })).toBeDisabled();
    fireEvent.change(screen.getByRole('combobox', { name: 'Email age' }), {
      target: { value: 'all' },
    });
    expect(onWindowChange).toHaveBeenCalledWith(null);
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
    expect(screen.getByText('Why suggested')).toBeInTheDocument();
  });

  it('labels a Later abstention as review context without changing the chosen action', () => {
    const reasoning = 'No recent mail, so engagement patterns cannot yet be assessed.';
    render(
      <DecidePreview
        verb="later"
        row={{ ...row, recommendation: { verdict: 'later', confidence: 0.4, reasoning } }}
        inboxCount={2}
        wakeAt="2030-10-31T12:00:00.000Z"
        confirming={false}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText('Review context')).toBeInTheDocument();
    expect(screen.getByText(reasoning)).toBeInTheDocument();
    expect(screen.queryByText('Why suggested')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: `Later for ${row.senderName}` })).toBeEnabled();
  });
});

// QA-delete-20260903-01: a zero-match Archive/Later/Delete otherwise still
// read as an active move ("Delete X's inbox email") above a "0 matching
// emails" body — the identical gap QA-delete-20260829-08 already fixed on
// Triage's own D226 preview.
describe('DecidePreview — zero-match header (QA-delete-20260903-01)', () => {
  it.each([
    { inboxCount: 0 as const, allMailCount: 0, allMailTotal: 2 },
    { inboxCount: 0 as const, allMailCount: null, allMailTotal: null },
    { inboxCount: 'loading' as const, allMailCount: null, allMailTotal: 0 },
    { inboxCount: 'unavailable' as const, allMailCount: null, allMailTotal: 0 },
  ])(
    'does not call a sender empty from an age-filtered zero or unavailable count: %j',
    (counts) => {
      render(
        <DecidePreview
          verb="delete"
          row={row}
          {...counts}
          inboxTotal={0}
          windowDays={180}
          onChooseDecision={vi.fn()}
          confirming={false}
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
      expect(
        screen.queryByRole('heading', { name: `No current email from ${row.senderName}` }),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Keep' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: `Delete for ${row.senderName}` })).toBeDisabled();
    },
  );

  it.each(['one_click', 'mailto', 'none', null] as const)(
    'only offers Unsubscribe for supported empty senders: %s',
    (method) => {
      const choose = vi.fn();
      const confirm = vi.fn();
      render(
        <DecidePreview
          verb="delete"
          row={{ ...row, unsubscribeMethod: method }}
          inboxCount={0}
          inboxTotal={0}
          allMailCount={0}
          allMailTotal={0}
          onChooseDecision={choose}
          confirming={false}
          onConfirm={confirm}
          onCancel={vi.fn()}
        />,
      );
      if (method === 'one_click' || method === 'mailto') {
        fireEvent.click(screen.getByRole('button', { name: 'Unsubscribe' }));
        expect(choose).toHaveBeenCalledWith('unsubscribe');
      } else expect(screen.queryByRole('button', { name: 'Unsubscribe' })).not.toBeInTheDocument();
      expect(confirm).not.toHaveBeenCalled();
    },
  );

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
      // The title says it once — no lead describing the move and its undo.
      expect(screen.queryByText(/undo/i)).toBeNull();
      expect(
        screen.getByText('Choose Keep to record a decision without moving email.'),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: new RegExp(`^${verb}`, 'i') })).toBeDisabled();
    },
  );

  it.each(['archive', 'later', 'delete'] as const)(
    'keeps the lead (where it goes, how to undo) when %s has email to move',
    (verb) => {
      render(
        <DecidePreview
          verb={verb}
          row={row}
          inboxCount={2}
          wakeAt="2099-01-01T09:00:00.000Z"
          confirming={false}
          onConfirm={() => {}}
          onCancel={() => {}}
        />,
      );
      expect(screen.getAllByText(/undo/i).length).toBeGreaterThan(0);
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
    const impact = screen.getByRole('region', { name: 'What Delete will do' });
    expect(impact).toHaveTextContent('No emails match these choices.');
    expect(impact).toHaveTextContent('Inbox and archived email · Older than 180 days');
  });

  it('explains a verified empty sender even at all-mail reach', () => {
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
    expect(screen.getByText(`No current email from ${row.senderName}`)).toBeInTheDocument();
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
    expect(screen.getByRole('heading', { name: `Keep ${row.senderName}?` })).toBeInTheDocument();
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
    expect(
      screen.getByRole('heading', { name: `Delete emails from ${row.senderName}?` }),
    ).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'What Delete will do' })).toHaveTextContent(
      '1 email will move to Gmail Trash.',
    );
  });
});
