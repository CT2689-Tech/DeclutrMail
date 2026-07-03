// Tests for the triage row's edge states (2026-07-02 audit W1 + W3).
//
//   W1 — narrow-viewport identity: below the xs ceiling the single-row
//   header grid crushed the identity cell (`minmax(0, 1fr)`) to zero
//   width — avatar + verdict pill rendered, sender name/domain
//   vanished. The fix stacks the header (identity keeps row 1, pill
//   moves to row 2, the Recommended hint drops). happy-dom computes no
//   layout, so the assertions are structural: the grid template
//   switches and the identity block stays in the tree with a title
//   attr for truncation.
//
//   W3 — stat consistency: the "last seen" stat card must never
//   contradict the collapsed row's quiet-90d copy. `lastSeenLabel`
//   derives the display from the same rolling-window aggregate that
//   drives "Quiet 90d", so the pair can no longer disagree.
//
// Client renders via @testing-library/react (the useIsAtMost hook
// reads window.matchMedia in an effect); the viewport is simulated by
// stubbing matchMedia per test.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { lastSeenLabel, TRIAGE_QUEUE, type TriageDecisionRow } from './data';
import { TriageRow } from './triage-row';

function rowById(id: string): TriageDecisionRow {
  const r = TRIAGE_QUEUE.find((row) => row.id === id);
  if (!r) throw new Error(`fixture missing row ${id}`);
  return r;
}

// ─── matchMedia stub ────────────────────────────────────────────────
// useIsAtMost('xs') queries `(max-width: 480px)`. The stub answers the
// query for a simulated viewport width; happy-dom's own matchMedia is
// restored after each test.

const originalMatchMedia = window.matchMedia;

function setViewportWidth(width: number): void {
  window.matchMedia = ((query: string) => {
    const limit = /\(max-width:\s*(\d+(?:\.\d+)?)px\)/.exec(query);
    const matches = limit != null && width <= Number(limit[1]);
    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
}

beforeEach(() => {
  setViewportWidth(1280);
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

const NARROW_TEMPLATE = '32px minmax(0, 1fr) 18px';
const WIDE_TEMPLATE = '32px minmax(0, 1fr) auto auto 18px';

function renderRow(row: TriageDecisionRow, { expanded = false } = {}) {
  return render(
    <TriageRow row={row} expanded={expanded} onToggleExpand={() => {}} onAction={() => {}} />,
  );
}

function header(row: TriageDecisionRow): HTMLElement {
  return screen.getByRole('button', {
    name: `${row.senderName} — expand triage detail`,
  });
}

describe('TriageRow — narrow-viewport identity (W1)', () => {
  it('stacks the header grid at ≤480px so the identity cell keeps its track', () => {
    setViewportWidth(375);
    const row = rowById('t-shipping');
    renderRow(row);
    expect(header(row).style.gridTemplateColumns).toBe(NARROW_TEMPLATE);
  });

  it('keeps sender name + domain rendered (with title attrs) at 375px', () => {
    setViewportWidth(375);
    const row = rowById('t-shipping');
    renderRow(row);
    const h = header(row);
    expect(within(h).getByText(row.senderName)).toBeInTheDocument();
    expect(within(h).getByText(row.senderDomain)).toBeInTheDocument();
    // Truncation stays inspectable — the full value rides the title.
    expect(within(h).getByText(row.senderName)).toHaveAttribute('title', row.senderName);
    expect(within(h).getByText(row.senderDomain)).toHaveAttribute('title', row.senderDomain);
  });

  it('keeps the identity block when the row is EXPANDED at 375px (the audit repro)', () => {
    setViewportWidth(375);
    const row = rowById('t-shipping');
    render(<TriageRow row={row} expanded={true} onToggleExpand={() => {}} onAction={() => {}} />);
    // The audit's W1: expanded row at 375px rendered avatar + chip
    // only. Name + domain must be in the tree alongside the toolbar.
    expect(screen.getByText(row.senderName)).toBeInTheDocument();
    expect(screen.getByText(row.senderDomain)).toBeInTheDocument();
    expect(screen.getByRole('toolbar')).toBeInTheDocument();
  });

  it('drops the standalone Recommended hint at 375px — the pill still carries the %', () => {
    setViewportWidth(375);
    const row = rowById('t-shipping'); // confidence 0.95 → recommended
    renderRow(row);
    expect(screen.queryByText('Recommended')).not.toBeInTheDocument();
    // The verdict pill keeps the recommendation visible: "Unsubscribe · 95%".
    expect(header(row).textContent).toContain('95%');
  });

  it('keeps the single-row grid + Recommended hint on desktop widths', () => {
    setViewportWidth(1280);
    const row = rowById('t-shipping');
    renderRow(row);
    expect(header(row).style.gridTemplateColumns).toBe(WIDE_TEMPLATE);
    expect(screen.getByText('Recommended')).toBeInTheDocument();
  });
});

describe('lastSeenLabel — the W3 consistency guard', () => {
  it('renders "90d+" when the 90d window is empty but lastDays disagrees', () => {
    // The live bug shape: quiet 90d with a collapsed lastDays of 0
    // ("LAST SEEN today" beside "Quiet 90d · 555 lifetime").
    expect(lastSeenLabel({ last90dMessages: 0, lastDays: 0 })).toBe('90d+');
    expect(lastSeenLabel({ last90dMessages: 0, lastDays: 45 })).toBe('90d+');
    expect(lastSeenLabel({ last90dMessages: 0, lastDays: 89 })).toBe('90d+');
  });

  it('trusts lastDays when it agrees with the empty window (≥90)', () => {
    expect(lastSeenLabel({ last90dMessages: 0, lastDays: 90 })).toBe('90d');
    expect(lastSeenLabel({ last90dMessages: 0, lastDays: 200 })).toBe('200d');
  });

  it('keeps the plain display when the window has messages', () => {
    expect(lastSeenLabel({ last90dMessages: 13, lastDays: 0 })).toBe('today');
    expect(lastSeenLabel({ last90dMessages: 13, lastDays: 1 })).toBe('1d');
    expect(lastSeenLabel({ last90dMessages: 13, lastDays: 12 })).toBe('12d');
  });
});

describe('TriageRow expanded — quiet-90d rows never read "LAST SEEN today" (W3)', () => {
  it('shows "90d+" beside the "Quiet 90d" why-line for the audit-shape row', () => {
    const row = rowById('t-shipping'); // last90dMessages 0, lastDays 0, 555 lifetime
    renderRow(row, { expanded: true });
    expect(screen.getByText('Quiet 90d · 555 lifetime')).toBeInTheDocument();
    expect(screen.getByText('90d+')).toBeInTheDocument();
    expect(screen.queryByText('today')).not.toBeInTheDocument();
  });

  it('holds for every quiet-90d fixture row', () => {
    for (const row of TRIAGE_QUEUE.filter((r) => r.last90dMessages === 0)) {
      const { unmount } = renderRow(row, { expanded: true });
      expect(screen.queryByText('today')).not.toBeInTheDocument();
      unmount();
    }
  });

  it('still shows "today" for a sender whose window has recent messages', () => {
    const row = rowById('t-groupon'); // last90dMessages 156, lastDays 0
    renderRow(row, { expanded: true });
    expect(screen.getByText('today')).toBeInTheDocument();
  });
});
