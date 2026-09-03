// Tests for the D54 (ADR-0018) senders mobile row dialect.
//
// `resolveRowSwipeDirection` is the pure pointer-delta → direction
// mapping the row's swipe gesture is built on; mirrors
// `triage/use-swipe-verb.test.ts`'s coverage shape for the sibling
// resolver (right → primary CTA, left → expand). The render tests below
// pin the ADR-0018 checkbox contract — hidden on a collapsed phone row
// until `selectMode`, always visible on desktop/tablet — using the same
// matchMedia stub `triage/triage-row.test.tsx` uses for its own
// `useIsAtMost` viewport tests.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { resolveRowSwipeDirection, ROW_SWIPE_THRESHOLD_PX, SenderListRow } from './sender-list-row';
import { makeSender } from '../testing/make-sender';

const T = ROW_SWIPE_THRESHOLD_PX;

describe('resolveRowSwipeDirection — the D54 row gesture mapping', () => {
  it('right past the threshold → right (primary CTA)', () => {
    expect(resolveRowSwipeDirection(T, 0)).toBe('right');
    expect(resolveRowSwipeDirection(T + 40, 4)).toBe('right');
  });

  it('left past the threshold → left (expand)', () => {
    expect(resolveRowSwipeDirection(-T, 0)).toBe('left');
    expect(resolveRowSwipeDirection(-(T + 40), -4)).toBe('left');
  });

  it('a vertical drag is unbound — resolves to null either direction', () => {
    expect(resolveRowSwipeDirection(0, -T)).toBeNull();
    expect(resolveRowSwipeDirection(0, T)).toBeNull();
  });

  it('sub-threshold travel is a tap, not a swipe (null)', () => {
    expect(resolveRowSwipeDirection(T - 1, 0)).toBeNull();
    expect(resolveRowSwipeDirection(0, 0)).toBeNull();
  });

  it('diagonal drags are rejected by the dominance ratio', () => {
    // 60px right + 55px up/down: neither axis dominates the other by 1.4×.
    expect(resolveRowSwipeDirection(60, -55)).toBeNull();
    expect(resolveRowSwipeDirection(60, 55)).toBeNull();
  });

  it('a clearly horizontal drag with minor vertical drift still resolves', () => {
    expect(resolveRowSwipeDirection(80, -10)).toBe('right');
    expect(resolveRowSwipeDirection(-80, 10)).toBe('left');
  });

  it('honours custom threshold + dominance options', () => {
    expect(resolveRowSwipeDirection(30, 0, { threshold: 20 })).toBe('right');
    expect(resolveRowSwipeDirection(30, 0, { threshold: 40 })).toBeNull();
  });
});

// ─── matchMedia stub ────────────────────────────────────────────────
// Same shape as triage-row.test.tsx's — useIsAtMost queries
// `(max-width: Npx)`; the stub answers per a simulated viewport width.

const originalMatchMedia = window.matchMedia;

function setViewportWidth(width: number): void {
  window.matchMedia = ((query: string) => {
    const limit = /\(max-width:\s*(\d+(?:\.\d+)?)px\)/.exec(query);
    const matches = limit != null && width <= Number(limit[1]);
    return {
      matches,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
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

function noop() {}

describe('<SenderListRow /> — D54 phone dialect', () => {
  const sender = makeSender({ displayName: 'LinkedIn', domain: 'linkedin.com' });

  it('always shows the checkbox on desktop, regardless of selectMode', () => {
    setViewportWidth(1280);
    render(
      <SenderListRow
        s={sender}
        selected={false}
        onToggleSelect={noop}
        expanded={false}
        onToggleExpand={noop}
        onAction={noop}
      />,
    );
    expect(screen.getByRole('checkbox', { name: `Select ${sender.name}` })).toBeInTheDocument();
  });

  it('hides the checkbox on a collapsed phone row until selectMode', () => {
    setViewportWidth(375);
    const { rerender } = render(
      <SenderListRow
        s={sender}
        selected={false}
        onToggleSelect={noop}
        expanded={false}
        onToggleExpand={noop}
        onAction={noop}
      />,
    );
    expect(
      screen.queryByRole('checkbox', { name: `Select ${sender.name}` }),
    ).not.toBeInTheDocument();

    rerender(
      <SenderListRow
        s={sender}
        selected={false}
        onToggleSelect={noop}
        expanded={false}
        onToggleExpand={noop}
        onAction={noop}
        selectMode
      />,
    );
    expect(screen.getByRole('checkbox', { name: `Select ${sender.name}` })).toBeInTheDocument();
  });

  it('hides the primary action row on a phone-width collapsed row (it moves into the expanded panel)', () => {
    setViewportWidth(375);
    render(
      <SenderListRow
        s={sender}
        selected={false}
        onToggleSelect={noop}
        expanded={false}
        onToggleExpand={noop}
        onAction={noop}
      />,
    );
    // The row itself is `role="button"` (the expand affordance); the
    // desktop/tablet row additionally renders `SenderActionRow`'s
    // primary button + `⋯` trigger inline. The phone row defers every
    // verb button to `SenderRowDetailLive` on expand, so only the row's
    // own expand button should be present here.
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('tapping a select-mode phone row toggles selection instead of expanding', () => {
    setViewportWidth(375);
    const onToggleSelect = vi.fn();
    const onToggleExpand = vi.fn();
    render(
      <SenderListRow
        s={sender}
        selected={false}
        onToggleSelect={onToggleSelect}
        expanded={false}
        onToggleExpand={onToggleExpand}
        onAction={noop}
        selectMode
      />,
    );
    screen.getByRole('button', { name: `${sender.name} — expand detail` }).click();
    expect(onToggleSelect).toHaveBeenCalledTimes(1);
    expect(onToggleExpand).not.toHaveBeenCalled();
  });

  it('tapping a non-select-mode row expands (desktop and phone alike)', () => {
    setViewportWidth(375);
    const onToggleExpand = vi.fn();
    render(
      <SenderListRow
        s={sender}
        selected={false}
        onToggleSelect={noop}
        expanded={false}
        onToggleExpand={onToggleExpand}
        onAction={noop}
      />,
    );
    screen.getByRole('button', { name: `${sender.name} — expand detail` }).click();
    expect(onToggleExpand).toHaveBeenCalledTimes(1);
  });

  it('names the 90d window on the cadence token and never renders a bare /mo', () => {
    // Same defect as sender-table.tsx's cell and confirm-action-modal.tsx's
    // arrival figure: `monthlyVolume` is a 90-day rolling COUNT, not a
    // per-month rate. A `/mo` suffix here overstates cadence 3x.
    setViewportWidth(1280);
    render(
      <SenderListRow
        s={sender}
        selected={false}
        onToggleSelect={noop}
        expanded={false}
        onToggleExpand={noop}
        onAction={noop}
      />,
    );
    expect(screen.getByTitle(/12 in last 90d/)).toBeInTheDocument();
    expect(screen.queryByText(/\/mo/)).not.toBeInTheDocument();
  });
});
