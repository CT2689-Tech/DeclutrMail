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
    // ("LAST SEEN today" beside "Quiet 90d · 555 received").
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
    const row = rowById('t-shipping'); // last90dMessages 0, lastDays 0, 555 received
    renderRow(row, { expanded: true });
    expect(screen.getByText('Quiet 90d · 555 received')).toBeInTheDocument();
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

describe('TriageRow — inline preview composition', () => {
  it('renders the app-owned account context inside the pure preview surface', () => {
    const row = rowById('t-groupon');

    render(
      <TriageRow
        row={row}
        expanded={true}
        onToggleExpand={() => {}}
        onAction={() => {}}
        inlinePreview={{ verb: 'Archive', archiveHistoric: false, inboxCount: 2 }}
        inlinePreviewAccountContext={
          <div role="note" aria-label="Gmail account: active@gmail.com">
            active@gmail.com
          </div>
        }
      />,
    );

    const preview = screen.getByRole('region', {
      name: `Preview · Archive ${row.senderName}`,
    });
    expect(
      within(preview).getByRole('note', { name: 'Gmail account: active@gmail.com' }),
    ).toBeInTheDocument();
  });
});

describe('TriageRow — inline preview Protected acknowledgement (D245/D42)', () => {
  function renderInline(row: ReturnType<typeof rowById>) {
    return render(
      <TriageRow
        row={row}
        expanded={true}
        onToggleExpand={() => {}}
        onAction={() => {}}
        inlinePreview={{ verb: 'Archive', archiveHistoric: false, inboxCount: 2 }}
      />,
    );
  }

  it('states the protection and says "anyway" on the inline confirm', () => {
    // D226 lets the SHEET be skipped via D34's remember-preference, but
    // the preview always renders. The override notice therefore has to
    // exist on BOTH paths — otherwise skipping the sheet silently skips
    // the acknowledgement while `override: true` still goes on the wire.
    renderInline(rowById('t-sarah')); // protectionReason: 'user-marked'
    expect(screen.getByRole('button', { name: /Confirm Archive anyway/i })).toBeInTheDocument();
  });

  it('says nothing about protection on an unprotected row', () => {
    const { container } = renderInline(rowById('t-groupon'));
    expect(container.textContent).not.toMatch(/is Protected/);
    expect(screen.getByRole('button', { name: /^Confirm Archive$/i })).toBeInTheDocument();
  });
});

describe('TriageRow — the D226 inline preview survives collapse (mobile bypass)', () => {
  it('renders the preview and Protected acknowledgement on a COLLAPSED row', () => {
    // The bypass this guards: `inlinePreview` is derived from
    // `pendingAction` alone, but the preview used to render only inside
    // the `expanded` body. On narrow widths the verb toolbar stays live
    // on a collapsed card, so tapping the row header dismissed the
    // preview -- and its Protected acknowledgement -- while the pending
    // action survived and the buttons stayed tappable. D226 makes the
    // preview mandatory; a preview a tap can hide is an optional preview.
    render(
      <TriageRow
        row={rowById('t-sarah')}
        expanded={false}
        onToggleExpand={() => {}}
        onAction={() => {}}
        inlinePreview={{ verb: 'Archive', archiveHistoric: false, inboxCount: 2 }}
      />,
    );
    expect(
      screen.getByRole('region', { name: `Preview · Archive ${rowById('t-sarah').senderName}` }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Confirm Archive anyway/i })).toBeInTheDocument();
  });

  it('renders no preview when no action is pending, collapsed or expanded', () => {
    // Two-sided: a surface only ever observed present is not verified.
    const { rerender } = render(
      <TriageRow
        row={rowById('t-sarah')}
        expanded={false}
        onToggleExpand={() => {}}
        onAction={() => {}}
      />,
    );
    expect(screen.queryByRole('region', { name: /^Preview · / })).toBeNull();
    rerender(
      <TriageRow
        row={rowById('t-sarah')}
        expanded={true}
        onToggleExpand={() => {}}
        onAction={() => {}}
      />,
    );
    expect(screen.queryByRole('region', { name: /^Preview · / })).toBeNull();
  });
});

describe('TriageRow — the inline preview only advertises live shortcuts', () => {
  const PENDING = { verb: 'Archive' as const, archiveHistoric: false, inboxCount: 2 };

  function renderPreview(expanded: boolean) {
    return render(
      <TriageRow
        row={rowById('t-groupon')}
        expanded={expanded}
        onToggleExpand={() => {}}
        onAction={() => {}}
        inlinePreview={PENDING}
      />,
    );
  }

  it('EXPANDED: offers the verb shortcut, because the toolbar keydown is live', () => {
    const { container } = renderPreview(true);
    expect(container.textContent).toMatch(/press A again/);
    expect(container.textContent).toMatch(/Esc cancels/);
  });

  it('EXPANDED but preview still loading: no shortcut, and confirm fails closed', () => {
    // `inlineConfirmBlocked` makes the toolbar's keydown inert while a
    // mail-moving verb's live count has not resolved, so advertising the
    // shortcut there is the same lie in a different state. The confirm
    // button must also fail closed exactly like the sheet does —
    // otherwise D226's mandatory preview can be confirmed before it has
    // produced a number.
    const { container } = render(
      <TriageRow
        row={rowById('t-groupon')}
        expanded={true}
        onToggleExpand={() => {}}
        onAction={() => {}}
        inlinePreview={{ verb: 'Archive', archiveHistoric: false, inboxCount: 'loading' }}
      />,
    );
    expect(container.textContent).not.toMatch(/press A again/);
    expect(container.textContent).toMatch(/Esc cancels/);
    expect(screen.getByRole('button', { name: /^Confirm Archive$/i })).toBeDisabled();
  });

  it('EXPANDED with a resolved count: confirm is enabled', () => {
    // Two-sided: a disabled state only ever observed disabled proves nothing.
    renderPreview(true);
    expect(screen.getByRole('button', { name: /^Confirm Archive$/i })).toBeEnabled();
  });

  it('COLLAPSED: offers Esc only — the verb key fires nothing on a closed row', () => {
    // Desktop never mounts the toolbar outside the expanded body, and
    // narrow widths mount it with `keyboardEnabled={expanded && ...}`.
    // Escape is a window listener on the pending inline surface, so it
    // survives the collapse and stays honest.
    const { container } = renderPreview(false);
    expect(container.textContent).not.toMatch(/press A again/);
    expect(container.textContent).toMatch(/Esc cancels/);
  });
});
