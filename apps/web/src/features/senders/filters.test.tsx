/**
 * Senders filters — the panel behind `[Filter]`, the active-filter chip
 * row, and the Sort menu (D38).
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  ActiveFilterChips,
  DEFAULT_COMPOSE,
  EMPTY_COMPOSE,
  FilterButton,
  FilterPanel,
  SortMenu,
} from './filters';

function renderStrip(onChange = vi.fn()) {
  render(
    <FilterPanel
      state={EMPTY_COMPOSE}
      counts={undefined}
      onChange={onChange}
      onClear={vi.fn()}
      domainSuggestions={['amazon.com', 'linkedin.com']}
    />,
  );
  return { onChange };
}

describe('FilterPanel · domain field', () => {
  // Founder-reported 2026-07-04: the domain control accepted only ONE
  // letter (a per-keystroke select()). Typed with user-event so per-key
  // effects flush between keystrokes.
  it('accepts a full multi-character domain, not just one letter', async () => {
    const user = userEvent.setup();
    renderStrip();

    const input = screen.getByRole('combobox', { name: 'Domain' });
    await user.type(input, 'bankofamerica');

    expect(input).toHaveValue('bankofamerica');
  });

  it('commits the typed domain on Enter, lower-cased', async () => {
    const user = userEvent.setup();
    const { onChange } = renderStrip();

    await user.type(screen.getByRole('combobox', { name: 'Domain' }), 'Chase.com{Enter}');

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ domain: 'chase.com' }));
  });
});

describe('FilterPanel · activity chip thresholds', () => {
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

describe('FilterPanel · updating (QA-senders-20260901-01)', () => {
  it('marks the group aria-busy, undimmed, while a background refetch is in flight', () => {
    render(
      <FilterPanel
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
        domainSuggestions={[]}
      />,
    );

    // `aria-busy` is the signal; a whole-panel dim compounded with an
    // inactive chip's own count opacity and read as "disabled".
    const group = screen.getByRole('group', { name: 'Filter senders' });
    expect(group).toHaveAttribute('aria-busy', 'true');
    expect(group).not.toHaveStyle({ opacity: '0.6' });
  });

  it('stays at full opacity when not updating (default)', () => {
    renderStrip();

    const group = screen.getByRole('group', { name: 'Filter senders' });
    expect(group).toHaveAttribute('aria-busy', 'false');
  });
});

describe('FilterPanel · chip negation (QA-senders-filtering-20260901-02)', () => {
  // A negated chip used to render the SAME visible label and count as an
  // included one — color was the only difference, invisible to a screen
  // reader (`aria-checked` is true for both states) and to anyone
  // colorblind. `FilterPanel` is a controlled component (state lives in
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
      <FilterPanel
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
        domainSuggestions={[]}
      />,
    );

    const negated = screen.getByRole('radio', { name: /exclude active senders/i });
    expect(negated).toHaveTextContent('not active');
    expect(negated).toHaveTextContent('−3');
    expect(screen.queryByRole('radio', { name: /only active senders/i })).not.toBeInTheDocument();
  });

  // Codex round-1 review: an explicit `aria-label` REPLACES the whole
  // accessible name a screen reader computes from visible text — the
  // first version of this fix set `aria-label="Only active senders"` /
  // `"Exclude: protected"` with no count in it at all, silently
  // dropping a number the un-labelled button used to announce (e.g.
  // "active 508"). The counts test above uses `counts={undefined}`, so
  // it can't catch this — this one supplies real counts.
  it('keeps the count in the accessible name for both ActivityChip and ToggleChip, included and excluded', () => {
    render(
      <FilterPanel
        state={{ ...EMPTY_COMPOSE, activity: 'active', unsubReady: false }}
        counts={{
          total: 10,
          active: 508,
          quiet: 4,
          dormant: 3,
          unsubReady: 2368,
          wroteTo: 0,
          protected: 0,
          unsubIgnored: 0,
        }}
        onChange={vi.fn()}
        onClear={vi.fn()}
        domainSuggestions={[]}
      />,
    );

    expect(screen.getByRole('radio', { name: /only active senders.*508/i })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /exclude: has unsubscribe.*2,368/i }),
    ).toBeInTheDocument();
  });
});

describe('FilterButton', () => {
  it('keeps every control behind one button until it is opened', async () => {
    const user = userEvent.setup();
    render(
      <FilterButton
        state={DEFAULT_COMPOSE}
        counts={undefined}
        onChange={vi.fn()}
        onClear={vi.fn()}
        domainSuggestions={[]}
      />,
    );
    expect(screen.queryByRole('group', { name: 'Filter senders' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^filter/i }));

    expect(screen.getByRole('group', { name: 'Filter senders' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('group', { name: 'Filter senders' })).not.toBeInTheDocument();
  });

  it('counts the filters in force — none on the first-visit default', () => {
    const { rerender } = render(
      <FilterButton
        state={DEFAULT_COMPOSE}
        counts={undefined}
        onChange={vi.fn()}
        onClear={vi.fn()}
        domainSuggestions={[]}
      />,
    );
    expect(screen.getByRole('button', { name: /^filter/i })).toHaveTextContent(/^Filter$/);

    rerender(
      <FilterButton
        state={{ ...DEFAULT_COMPOSE, protectedFlag: false, domain: 'chase.com' }}
        counts={undefined}
        onChange={vi.fn()}
        onClear={vi.fn()}
        domainSuggestions={[]}
      />,
    );
    expect(screen.getByRole('button', { name: /^filter/i })).toHaveTextContent('3');
  });
});

describe('ActiveFilterChips', () => {
  it('renders nothing on the first-visit default', () => {
    const { container } = render(
      <ActiveFilterChips state={DEFAULT_COMPOSE} onChange={vi.fn()} onClear={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('names each filter in force, excluded ones as "not", and removes one on click', () => {
    const onChange = vi.fn();
    const onClear = vi.fn();
    const state = {
      ...EMPTY_COMPOSE,
      activity: 'dormant' as const,
      activityNegate: true,
      unsubReady: true,
      windowDays: 90,
    };
    render(<ActiveFilterChips state={state} onChange={onChange} onClear={onClear} />);

    expect(screen.getByRole('button', { name: 'Remove filter: Not dormant' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Remove filter: No email for 90+ days' }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove filter: Has unsubscribe' }));
    expect(onChange).toHaveBeenCalledWith({ ...state, unsubReady: null });

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onClear).toHaveBeenCalled();
  });
});

describe('SortMenu', () => {
  it('names the sort in force and emits the picked column + direction', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SortMenu sort="total" direction="desc" onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: /most received/i }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Least recent' }));

    expect(onChange).toHaveBeenCalledWith({ sort: 'last_seen', direction: 'asc' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('offers only sorts the API implements', async () => {
    const user = userEvent.setup();
    render(<SortMenu sort="total" direction="desc" onChange={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /sort/i }));
    expect(screen.queryByRole('menuitemradio', { name: /recommended/i })).not.toBeInTheDocument();
  });
});
