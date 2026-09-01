/**
 * ComposeStrip DomainMenu typing regression (D38).
 *
 * Founder-reported 2026-07-04: the domain popover accepted only ONE
 * letter. Cause: focus/select lived in the same effect as the
 * outside-click listener, whose deps include `draft` — so `select()`
 * re-ran per keystroke, highlighting the whole input, and the next key
 * replaced it. The multi-character test below fails against that code.
 *
 * Typed with @testing-library/user-event (per-key events flush effects
 * between keystrokes, so a per-keystroke select() is visible here);
 * the sibling sender-search bug additionally needed Playwright because
 * its mechanism was host-render latency, which jsdom can't exhibit.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ComposeStrip, EMPTY_COMPOSE } from './compose-strip';

function renderStrip(onChange = vi.fn()) {
  render(
    <ComposeStrip
      state={EMPTY_COMPOSE}
      counts={undefined}
      onChange={onChange}
      onClear={vi.fn()}
      sort="total"
      direction="desc"
      onSortChange={vi.fn()}
      domainSuggestions={['amazon.com', 'linkedin.com']}
    />,
  );
  return { onChange };
}

describe('ComposeStrip · DomainMenu', () => {
  it('accepts a full multi-character domain, not just one letter', async () => {
    const user = userEvent.setup();
    renderStrip();

    await user.click(screen.getByRole('button', { name: /domain/i }));
    const input = screen.getByPlaceholderText(/amazon\.com/);

    await user.type(input, 'bankofamerica');

    expect(input).toHaveValue('bankofamerica');
  });

  it('commits the typed domain on Enter', async () => {
    const user = userEvent.setup();
    const { onChange } = renderStrip();

    await user.click(screen.getByRole('button', { name: /domain/i }));
    await user.type(screen.getByPlaceholderText(/amazon\.com/), 'Chase.com{Enter}');

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ domain: 'chase.com' }));
  });
});

describe('ComposeStrip · activity chip thresholds', () => {
  // QA-senders-20260901-04: active/quiet/dormant filtered a real cutoff
  // (WINDOWS.ACTIVE_DAYS/DORMANT_DAYS) that was stated nowhere on screen.
  it("states each bucket's day cutoff in its title", () => {
    renderStrip();

    expect(screen.getByRole('radio', { name: /active/i })).toHaveAttribute(
      'title',
      'Last email within 30 days · alt-click to exclude',
    );
    expect(screen.getByRole('radio', { name: /quiet/i })).toHaveAttribute(
      'title',
      'Last email more than 30 and up to 180 days ago · alt-click to exclude',
    );
    expect(screen.getByRole('radio', { name: /dormant/i })).toHaveAttribute(
      'title',
      'Last email over 180 days ago · alt-click to exclude',
    );
  });
});

describe('ComposeStrip · updating (QA-senders-20260901-01)', () => {
  it('dims the chip counts and marks the group aria-busy while a background refetch is in flight', () => {
    render(
      <ComposeStrip
        state={EMPTY_COMPOSE}
        counts={{
          total: 508,
          active: 508,
          quiet: 0,
          dormant: 0,
          unsubReady: 0,
          wroteTo: 0,
          protected: 508,
          unsubIgnored: 0,
        }}
        updating
        onChange={vi.fn()}
        onClear={vi.fn()}
        sort="total"
        direction="desc"
        onSortChange={vi.fn()}
        domainSuggestions={[]}
      />,
    );

    // QA-senders-filtering-20260901-08: the whole-strip 0.6 dim used to
    // compound with an already-0.6-opacity inactive chip's OWN count
    // span (0.6 × 0.6 = 0.36), reading as "disabled" rather than
    // "updating". `SenderResultsFreshness` (senders-screen.tsx) already
    // renders an explicit "Updating results…" status text for this same
    // state — `aria-busy` here is the accessible signal now; the strip
    // itself no longer dims.
    const group = screen.getByRole('group', { name: 'Filter and sort senders' });
    expect(group).toHaveAttribute('aria-busy', 'true');
    expect(group).not.toHaveStyle({ opacity: '0.6' });
  });

  it('stays at full opacity when not updating (default)', () => {
    renderStrip();

    const group = screen.getByRole('group', { name: 'Filter and sort senders' });
    expect(group).toHaveAttribute('aria-busy', 'false');
  });
});

describe('ComposeStrip · accessible name', () => {
  // QA-senders-20260901-07: the strip's own aria-label described a
  // recipient list ("Senders included in this message"), not the
  // filter/sort row it actually is.
  it('describes itself as the filter-and-sort row, not a recipient list', () => {
    renderStrip();

    expect(screen.getByRole('group', { name: 'Filter and sort senders' })).toBeInTheDocument();
  });
});

describe('ComposeStrip · chip negation (QA-senders-filtering-20260901-02)', () => {
  // A negated chip used to render the SAME visible label and count as an
  // included one — color was the only difference, invisible to a screen
  // reader (`aria-checked` is true for both states) and to anyone
  // colorblind. `ComposeStrip` is a controlled component (state lives in
  // the caller), so these assert the emitted `onChange` shape and the
  // chip's OWN pre-click rendering, not a re-render after the click.
  it('right-click on an ActivityChip requests the negated state and is labeled/titled for exclusion', () => {
    const { onChange } = renderStrip();
    const activeChip = screen.getByRole('radio', { name: /only active senders/i });
    expect(activeChip).toHaveTextContent('active');
    expect(activeChip).not.toHaveTextContent('not active');

    fireEvent.contextMenu(activeChip);

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ activity: 'active', activityNegate: true }),
    );
  });

  it('right-click on a ToggleChip requests the negated (false) state', () => {
    const { onChange } = renderStrip();
    const protectedChip = screen.getByRole('button', { name: 'protected' });

    fireEvent.contextMenu(protectedChip);

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ protectedFlag: false }));
  });

  it("labels and announces an already-negated ActivityChip as 'not <bucket>', distinct from included", () => {
    render(
      <ComposeStrip
        state={{ ...EMPTY_COMPOSE, activity: 'active', activityNegate: true }}
        counts={{
          total: 10,
          active: 3,
          quiet: 4,
          dormant: 3,
          unsubReady: 0,
          wroteTo: 0,
          protected: 0,
          unsubIgnored: 0,
        }}
        onChange={vi.fn()}
        onClear={vi.fn()}
        sort="total"
        direction="desc"
        onSortChange={vi.fn()}
        domainSuggestions={[]}
      />,
    );

    const negated = screen.getByRole('radio', { name: /exclude active senders/i });
    expect(negated).toHaveTextContent('not active');
    expect(negated).toHaveTextContent('−3');
    expect(screen.queryByRole('radio', { name: /only active senders/i })).not.toBeInTheDocument();
  });
});
