import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { ActionPreviewPresentation } from './action-preview-presentation';
import {
  ActionPreviewDetailBlock,
  actionMovesMail,
  type ActionPreviewDetail,
} from './action-preview-detail';
import { TRIAGE_QUEUE } from './data';

const row = TRIAGE_QUEUE[0]!;

const detail: ActionPreviewDetail = {
  mailLocationLine:
    'Where this email is now: 17 in your inbox · 885 emails elsewhere in Gmail (archived or under a label).',
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
 * Renders the preview the way both real call sites do — the caller builds
 * the slot and gates it on `actionMovesMail`. The block lives in its own
 * module so its code never enters the public inbox simulator's chunk,
 * which means the wiring, not just the block, is what needs asserting.
 */
function renderPreview(
  over: {
    verb?: 'Keep' | 'Archive' | 'Unsubscribe' | 'Later' | 'Delete';
    archiveHistoric?: boolean;
    mode?: 'modal' | 'inline';
    detail?: ActionPreviewDetail | undefined;
    quotaRemaining?: number | null;
  } = {},
) {
  const verb = over.verb ?? 'Archive';
  const archiveHistoric = over.archiveHistoric ?? false;
  const supplied = 'detail' in over ? over.detail : detail;
  return render(
    <ActionPreviewPresentation
      verb={verb}
      row={row}
      archiveHistoric={archiveHistoric}
      inboxCount={17}
      mode={over.mode ?? 'modal'}
      quotaRemaining={'quotaRemaining' in over ? over.quotaRemaining : QUOTA_REMAINING}
      detailSlot={
        supplied !== undefined && actionMovesMail(verb, archiveHistoric) ? (
          <ActionPreviewDetailBlock detail={supplied} />
        ) : undefined
      }
    />,
  );
}

// The founder compared the two confirm surfaces side by side and kept the
// senders one: "I in fact liked sender preview since it has more details."
// Triage already fetched every number below through `useCompositePreview`
// and rendered none of them.
describe('ActionPreviewPresentation — verification detail (D226 parity)', () => {
  it('states where the sender mail actually is', () => {
    renderPreview();
    expect(screen.getByTestId('mail-location-line').textContent).toContain('17 in your inbox');
    expect(screen.getByTestId('mail-location-line').textContent).toContain(
      '885 emails elsewhere in Gmail',
    );
  });

  it('offers the Gmail cross-check before confirming', () => {
    renderPreview();
    expect(screen.getByRole('link', { name: /Check these in Gmail first/ })).toHaveAttribute(
      'href',
      detail.verifyInGmailUrl,
    );
  });

  it('never advertises more sample rows than the count above it', () => {
    renderPreview();
    expect(
      screen.getByRole('button', { name: /Show what currently matches \(2 of 17\)/ }),
    ).toBeInTheDocument();
  });

  it('keeps the no-body-storage line wherever subjects render (D7)', () => {
    renderPreview();
    fireEvent.click(screen.getByRole('button', { name: /Show what currently matches/ }));
    expect(screen.getByText('Your weekly digest')).toBeInTheDocument();
    expect(screen.getByText(/we never fetch or store full email contents/)).toBeInTheDocument();
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
    renderPreview({ verb: 'Unsubscribe', archiveHistoric: true });
    expect(screen.getByText(/Uses 2 of your 34 cleanup actions/)).toBeInTheDocument();
  });

  it('says nothing about quota on a tier that does not meter it', () => {
    renderPreview({ quotaRemaining: null });
    expect(screen.queryByText(/cleanup action/)).toBeNull();
  });

  // The compact variant is the ABSENCE of the prop, not a mode flag —
  // that is what keeps this component importable by the public inbox
  // simulator without its detail code landing in the public chunk.
  it('renders exactly as before when no detail is supplied', () => {
    // What the public inbox simulator passes: neither the detail block
    // nor an allowance, since it has no mailbox and spends nothing.
    renderPreview({ detail: undefined, quotaRemaining: null });
    expect(screen.queryByTestId('mail-location-line')).toBeNull();
    expect(screen.queryByRole('link', { name: /Check these in Gmail/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Show what currently matches/ })).toBeNull();
    expect(screen.queryByText(/cleanup action/)).toBeNull();
    // The mandatory D226 content is untouched.
    expect(screen.getByText(/emails? in Inbox now/)).toBeInTheDocument();
  });

  // Same rule the senders modal now follows: a panel counting "what
  // currently matches" under an action that moves nothing invites the
  // reader to inspect mail nothing will touch.
  it('hides the detail for an Unsubscribe that leaves the backlog alone', () => {
    renderPreview({ verb: 'Unsubscribe', archiveHistoric: false });
    expect(screen.queryByTestId('mail-location-line')).toBeNull();
    expect(screen.queryByRole('button', { name: /Show what currently matches/ })).toBeNull();
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
// place the identical text renders (triage-row.tsx, triage-row-expanded.tsx).
describe('ActionPreviewPresentation — reasoning age label (D25, QA-archive-20260828-02)', () => {
  it('states how old the reasoning is when scoredAt is known', async () => {
    const scoredAt = new Date(Date.now() - 60_000).toISOString(); // 1 minute ago
    render(
      <ActionPreviewPresentation
        verb="Archive"
        row={{ ...row, scoredAt }}
        archiveHistoric={false}
        inboxCount={17}
        mode="modal"
      />,
    );
    expect(await screen.findByText('Scored today')).toBeInTheDocument();
  });

  it('renders no age label when scoredAt is unknown (demo/simulator rows)', () => {
    expect(row.scoredAt).toBeUndefined(); // fixture precondition for this test
    render(
      <ActionPreviewPresentation
        verb="Archive"
        row={row}
        archiveHistoric={false}
        inboxCount={17}
        mode="modal"
      />,
    );
    expect(screen.queryByText(/^Scored /)).toBeNull();
    // The reasoning itself still renders — only the age label is gated.
    expect(screen.getByText('Why we suggested this:')).toBeInTheDocument();
  });
});
