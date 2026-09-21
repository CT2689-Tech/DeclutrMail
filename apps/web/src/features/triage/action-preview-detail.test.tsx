import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

import {
  ActionPreviewDetailBlock,
  actionMovesMail,
  mailLocationValue,
  type ActionPreviewDetail,
} from './action-preview-detail';
import { afterLead } from '@/lib/copy/after-lead';
import { buildPreviewFacts } from './action-preview-presentation';
import { ActionSheet } from './action-sheet';
import { TRIAGE_QUEUE } from './data';
import { InlinePreviewBlock } from './inline-preview';
import type { SheetableVerb } from './store';

const row = TRIAGE_QUEUE[0]!;

const detail: ActionPreviewDetail = {
  mailLocationLine:
    'Where it is now: 17 emails in your inbox · 885 emails elsewhere in Gmail (archived or under a label).',
  matchSample: {
    rows: [
      { subject: 'Your weekly digest', date: '2026-08-20' },
      { subject: 'Still here?', date: '2026-07-02' },
    ],
    total: 17,
  },
  verifyInGmailUrl: 'https://mail.google.com/mail/u/0/#search/from%3Ax',
};

/** The allowance travels separately — see `ActionSheet.quotaRemaining`. */
const QUOTA_REMAINING = 34;

/**
 * Renders the preview the way both real call sites do. The sheet builds
 * its own detail block from `detail`; the inline path takes a finished
 * slot, gated by the caller on `actionMovesMail` — the block lives in its
 * own module so its code never enters the public inbox simulator's chunk,
 * which means the wiring, not just the block, is what needs asserting.
 */
function renderPreview(
  over: {
    verb?: SheetableVerb;
    archiveHistoric?: boolean;
    mode?: 'modal' | 'inline';
    detail?: ActionPreviewDetail | undefined;
    quotaRemaining?: number | null;
    inboxCount?: number;
    scoredAt?: string;
  } = {},
) {
  const verb = over.verb ?? 'Archive';
  const archiveHistoric = over.archiveHistoric ?? false;
  const supplied = 'detail' in over ? over.detail : detail;
  const quota = 'quotaRemaining' in over ? over.quotaRemaining : QUOTA_REMAINING;
  const inboxCount = over.inboxCount ?? 17;
  const theRow = over.scoredAt === undefined ? row : { ...row, scoredAt: over.scoredAt };
  const result =
    over.mode === 'inline'
      ? render(
          <InlinePreviewBlock
            row={theRow}
            busy={false}
            shortcutLive={false}
            onConfirm={() => {}}
            preview={{
              verb,
              archiveHistoric,
              inboxCount,
              quotaRemaining: quota,
              detailSlot:
                supplied !== undefined && actionMovesMail(verb, archiveHistoric) ? (
                  <ActionPreviewDetailBlock detail={supplied} />
                ) : undefined,
            }}
          />,
        )
      : render(
          <ActionSheet
            open
            verb={verb}
            row={theRow}
            inboxCount={inboxCount}
            onCancel={() => {}}
            onConfirm={() => {}}
            detail={supplied}
            quotaRemaining={quota}
          />,
        );
  // Everything past count / destination / undo is behind "Details".
  const summary = screen.queryByText('Details');
  if (summary !== null) fireEvent.click(summary);
  return result;
}

// The founder compared the two confirm surfaces side by side and kept the
// senders one: "I in fact liked sender preview since it has more details."
// Triage already fetched every number below through `useCompositePreview`.
// ADR-0042 moved them behind "Details" — they must still be reachable.
describe('Triage preview — verification detail (D226 parity)', () => {
  it('states where the sender mail actually is', () => {
    renderPreview();
    const line = screen.getByTestId('mail-location-line').textContent;
    expect(line).toContain('17 in your inbox');
    expect(line).toContain('885 elsewhere in Gmail');
  });

  it('offers the Gmail cross-check before confirming', () => {
    renderPreview();
    expect(screen.getByRole('link', { name: /Check in Gmail/ })).toHaveAttribute(
      'href',
      detail.verifyInGmailUrl,
    );
  });

  it('keeps the no-body-storage line wherever subjects render (D7)', () => {
    renderPreview();
    expect(screen.getByText('Your weekly digest')).toBeInTheDocument();
    expect(screen.getByText(/we never fetch or store full email contents/i)).toBeInTheDocument();
  });

  it('states the cleanup cost at the moment it is spent', () => {
    renderPreview();
    expect(
      screen.getByText(/Uses 1 of your 34 cleanup actions left this month/),
    ).toBeInTheDocument();
  });

  // Matches the server's `includesBacklogAction ? 2 : 1` preflight, and
  // the senders modal's copy of the same rule.
  it('counts the backlog verb as a second unit', () => {
    renderPreview({ verb: 'Unsubscribe', archiveHistoric: true, mode: 'inline' });
    expect(screen.getByText(/Uses 2 of your 34 cleanup actions/)).toBeInTheDocument();
  });

  it('says nothing about quota on a tier that does not meter it', () => {
    renderPreview({ quotaRemaining: null });
    expect(screen.queryByText(/cleanup action/)).toBeNull();
  });

  it('renders the mandatory facts with no detail supplied (the public simulator)', () => {
    renderPreview({ detail: undefined, quotaRemaining: null, mode: 'inline' });
    expect(screen.queryByTestId('mail-location-line')).toBeNull();
    expect(screen.queryByRole('link', { name: /Check in Gmail/ })).toBeNull();
    expect(screen.queryByText(/cleanup action/)).toBeNull();
    // The mandatory D226 content is untouched: count + destination.
    expect(screen.getByText(/17 emails from .*leave your inbox/)).toBeInTheDocument();
  });

  // Same rule the senders modal follows: a panel counting "what currently
  // matches" under an action that moves nothing invites the reader to
  // inspect mail nothing will touch.
  it('hides the detail for an Unsubscribe that leaves the backlog alone', () => {
    renderPreview({ verb: 'Unsubscribe', archiveHistoric: false, mode: 'inline' });
    expect(screen.queryByTestId('mail-location-line')).toBeNull();
    // The cost is still stated — an unsubscribe spends a unit either way.
    expect(screen.getByText(/Uses 1 of your 34 cleanup actions/)).toBeInTheDocument();
  });

  it('shows the detail on the inline path too, since D34 lets the sheet be skipped', () => {
    renderPreview({ mode: 'inline' });
    expect(screen.getByTestId('mail-location-line')).toBeInTheDocument();
    expect(screen.getByText(/Uses 1 of your 34 cleanup actions/)).toBeInTheDocument();
  });
});

// QA-archive-20260828-02: this dialog rendered the frozen `reasoning`
// sentence with no indication of when it was scored, unlike every other
// place the identical text renders.
describe('Triage preview — reasoning age label (D25, QA-archive-20260828-02)', () => {
  it('states how old the reasoning is when scoredAt is known', async () => {
    renderPreview({ scoredAt: new Date(Date.now() - 60_000).toISOString() });
    // QA-sender-detail-20260902-08: "Scored" renamed to "Last checked".
    expect(await screen.findByText('Last checked today')).toBeInTheDocument();
  });

  it('renders no age label when scoredAt is unknown (demo/simulator rows)', () => {
    expect(row.scoredAt).toBeUndefined(); // fixture precondition for this test
    renderPreview();
    expect(screen.queryByText(/^Last checked /)).toBeNull();
    // The reasoning itself still renders — only the age label is gated.
    expect(screen.getByText('Why suggested')).toBeInTheDocument();
  });
});

// QA-delete-20260829-08 — a header that always promises a move read as
// active even when the live count is 0.
describe('Triage preview — the count lives in the title, once', () => {
  it.each(['Archive', 'Later', 'Delete'] as const)(
    "titles %s's empty-inbox preview as nothing-to-move, not an active move",
    (verb) => {
      renderPreview({ verb, inboxCount: 0 });
      expect(
        screen.getByRole('dialog', { name: new RegExp(`Nothing in your inbox from`, 'i') }),
      ).toBeInTheDocument();
      // And the action cannot run on nothing.
      expect(screen.getByRole('button', { name: new RegExp(`^${verb}$`) })).toBeDisabled();
    },
  );

  it('asks the question with the count when there is mail to move', () => {
    renderPreview({ verb: 'Delete', inboxCount: 1 });
    const dialog = screen.getByRole('dialog', { name: 'Delete 1 email?' });
    expect(within(dialog).getByRole('button', { name: 'Delete 1' })).toBeEnabled();
    // Where it goes and how to undo it, each stated.
    expect(dialog).toHaveAccessibleDescription(/move to Gmail Trash/);
    expect(within(dialog).getByText(/Undo/)).toBeInTheDocument();
  });

  it('states the count exactly once outside Details', () => {
    renderPreview({ verb: 'Archive', inboxCount: 174 });
    const dialog = screen.getByRole('dialog');
    const details = dialog.querySelector('details');
    const outside = dialog.cloneNode(true) as HTMLElement;
    outside.querySelector('details')?.remove();
    expect(details).not.toBeNull();
    // Title "Archive 174 emails?" + button "Archive 174" — one question, one answer.
    expect((outside.textContent ?? '').match(/174/g)?.length).toBe(2);
  });
});

describe('buildPreviewFacts', () => {
  it('never claims a move for a verb that moves nothing', () => {
    const facts = buildPreviewFacts({
      verb: 'Unsubscribe',
      row,
      archiveHistoric: false,
      inboxCount: 17,
    });
    expect(facts.counts).toBe(false);
    expect(facts.note).toMatch(/can’t be recalled/);
  });

  it('names the widened reach when Delete reaches archived mail', () => {
    const facts = buildPreviewFacts({
      verb: 'Delete',
      row,
      archiveHistoric: false,
      inboxCount: 6728,
      reach: 'all_mail',
    });
    expect(facts.title).toBe('Delete 6,728 emails?');
    expect(facts.subtitle).toMatch(/archived email both move to Gmail Trash/);
  });

  // The Details values are cuts of the shared semantics sentences. Each
  // must keep the caveat that changes what a reader would do.
  it('keeps the recheck caveat, the reach and Gmail Trash permanence as short facts', () => {
    const facts = buildPreviewFacts({
      verb: 'Delete',
      row,
      archiveHistoric: false,
      inboxCount: 6728,
      reach: 'all_mail',
    });
    const byLabel = new Map(facts.disclosures.map((f) => [f.label, f.value]));
    expect(byLabel.get('Count')).toBe('Inbox + archived now, rechecked when it runs');
    expect(byLabel.get('Gmail Trash')).toMatch(/up to 30 days, then deleted for good/);
  });

  it('keeps Later’s return as a floor ("from"), not an exact time', () => {
    const facts = buildPreviewFacts({
      verb: 'Later',
      row,
      archiveHistoric: false,
      inboxCount: 3,
      wakeAt: '2030-01-02T09:00:00.000Z',
    });
    expect(facts.disclosures.find((f) => f.label === 'Returns')?.value).toMatch(/^From /);
  });

  it('says what the Unsubscribe chooser selected for past email', () => {
    const alone = buildPreviewFacts({
      verb: 'Unsubscribe',
      row,
      archiveHistoric: false,
      inboxCount: 4,
    });
    expect(alone.disclosures.find((f) => f.label === 'Past email')?.value).toBe(
      'Stays where it is',
    );
    const withArchive = buildPreviewFacts({
      verb: 'Unsubscribe',
      row,
      archiveHistoric: true,
      inboxCount: 4,
    });
    expect(withArchive.disclosures.find((f) => f.label === 'Past email')?.value).toMatch(
      /out of your inbox/,
    );
  });
});

describe('afterLead / mailLocationValue', () => {
  it('cuts only a known lead-in, and passes an unknown sentence through whole', () => {
    expect(afterLead('Returns to Inbox from Jan 2, 9:00 AM.', 'Returns to Inbox ')).toBe(
      'From Jan 2, 9:00 AM',
    );
    expect(afterLead('Something else entirely.', 'Returns to Inbox ')).toBe(
      'Something else entirely',
    );
  });

  it('keeps "elsewhere in Gmail" — never "archived" — and every segment', () => {
    expect(
      mailLocationValue(
        'Where it is now: 0 emails in your inbox · 6,275 emails elsewhere in Gmail · 1 email in Trash or Spam.',
      ),
    ).toBe('0 in your inbox · 6,275 elsewhere in Gmail · 1 in Trash or Spam');
  });
});
