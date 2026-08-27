// Tests for the triage row's edge states (2026-07-02 audit W1 + W3).
//
//   W1 — narrow-viewport identity: below the xs ceiling the single-row
//   header grid crushed the identity cell (`minmax(0, 1fr)`) to zero
//   width — avatar + verdict pill rendered, sender name/domain
//   vanished. The fix stacks the header (identity keeps row 1, pill
//   moves to row 2). happy-dom computes no
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
import { QueryWrapper, createTestQueryClient } from '@/test/query-wrapper';
import { lastSeenLabel, TRIAGE_QUEUE, type TriageDecisionRow } from './data';
import { TriageRow } from './triage-row';
import { UnprotectButton } from './unprotect-button';
import { recommendedVerb } from './types';

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
const WIDE_TEMPLATE = '32px minmax(0, 1fr) auto 18px';

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

  it('shows the same badge at 375px as on desktop — the narrow layout reflows, it does not drop information', () => {
    setViewportWidth(375);
    // LinkedIn, not Shipping (D133): Shipping's real cascade signals now
    // land on Later, which `confidenceBand` always maps to `null` (an
    // abstention has no band to show) — see
    // packages/shared/src/copy/engine-confidence.ts. LinkedIn is
    // unsubscribe at 0.89, comfortably above the 0.85 floor, so it still
    // exercises the same "verdict pill carries a band at every width"
    // invariant this test is actually about.
    const row = rowById('t-linkedin'); // confidence 0.89 → recommended
    renderRow(row);
    // The verdict pill carries the recommendation at every width:
    // "Unsubscribe · strong".
    expect(header(row).textContent).toContain('strong');
  });

  // The pill used to print `Math.round(confidence * 100)`. The cascade
  // sums fixed weights into a clamped band, so its reachable value set
  // is small and its top saturates — and because the queue sorts by
  // confidence DESC, the head of a real queue printed the same "91%"
  // on four consecutive senders. Honest, and it read as fabricated.
  it('never prints a rounded percentage on the verdict pill', () => {
    setViewportWidth(1280);
    const row = rowById('t-shipping');
    renderRow(row);
    expect(header(row).textContent).not.toMatch(/\d+%/);
  });

  // `strong` is DEFINED as "recommended", so the one badge the row
  // renders always agrees with the engine's own gate.
  it('shows the band `strong` exactly when the engine recommends the verdict', () => {
    setViewportWidth(1280);
    for (const row of TRIAGE_QUEUE.filter((r) => r.protectionReason === null)) {
      const { unmount } = renderRow(row);
      const isStrong = header(row).textContent?.includes('· strong') ?? false;
      const isRecommended = recommendedVerb(row.verdict, row.confidence) !== null;
      expect(isStrong).toBe(isRecommended);
      unmount();
    }
  });

  it('keeps the single-row grid on desktop widths', () => {
    setViewportWidth(1280);
    const row = rowById('t-shipping');
    renderRow(row);
    expect(header(row).style.gridTemplateColumns).toBe(WIDE_TEMPLATE);
  });

  // The row must not reintroduce a second label for a fact the pill
  // already carries — that duplication is what 1A removed.
  it('renders no standalone Recommended hint at any width', () => {
    for (const width of [375, 1280]) {
      setViewportWidth(width);
      const { unmount } = renderRow(rowById('t-shipping'));
      expect(screen.queryByText('Recommended')).not.toBeInTheDocument();
      unmount();
    }
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

describe('TriageRow — every protection reason names its evidence', () => {
  // CLAUDE.md §2.6 / D245: "show the exact reason". A user-set Protect
  // arrives on the Triage wire as `manual`, while this feature's union
  // declared `user-marked` — so the value matched nothing and the row
  // rendered the tautology "Protected · it is Protected". Fixtures used
  // the type's spelling instead of the wire's, so nothing caught it.
  it.each([
    ['manual', /you marked it Protected/],
    ['replied', /you wrote to them at least 3 times/],
    ['starred', /you starred a message/],
    ['gmail-important', /Gmail marks it important/],
  ] as const)('renders the exact evidence for %s', (reason, expected) => {
    const row: TriageDecisionRow = { ...rowById('t-sarah'), protectionReason: reason };
    renderRow(row);
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it('says the evidence is gone rather than repeating the old claim (F010)', () => {
    // The defect the smoke caught: the D245 review's header named 99
    // stale shields while every row under it still read "you wrote to
    // them at least 3 times" — the screen contradicting itself on the
    // rows it exists to surface.
    const row: TriageDecisionRow = {
      ...rowById('t-sarah'),
      protectionReason: 'replied',
      protectionEvidenceCurrent: false,
    };
    renderRow(row);
    expect(screen.getByText(/we can no longer confirm you wrote to them/)).toBeInTheDocument();
    expect(screen.queryByText(/you wrote to them at least 3 times/)).not.toBeInTheDocument();
  });

  it.each([
    ['null — unmeasurable on this mailbox', null],
    ['undefined — an API predating the field', undefined],
    ['true — checked and holding', true],
  ] as const)('keeps the recorded reason when evidence is %s', (_label, evidence) => {
    // Only an explicit `false` may contradict a recorded reason.
    // Coercing unknown would indict every correspondence shield on a
    // mailbox whose Sent mail simply was not indexed.
    const row: TriageDecisionRow = {
      ...rowById('t-sarah'),
      protectionReason: 'replied',
      ...(evidence === undefined ? {} : { protectionEvidenceCurrent: evidence }),
    };
    renderRow(row);
    expect(screen.getByText(/you wrote to them at least 3 times/)).toBeInTheDocument();
    expect(screen.queryByText(/we can no longer confirm/)).not.toBeInTheDocument();
  });

  it('never renders the tautology', () => {
    for (const reason of ['manual', 'replied', 'starred', 'gmail-important'] as const) {
      const { unmount, container } = renderRow({
        ...rowById('t-sarah'),
        protectionReason: reason,
      });
      expect(container.textContent).not.toContain('Protected · it is Protected');
      unmount();
    }
  });
});

describe('TriageRow — an unknown read rate is never rendered as 0%', () => {
  // The BE has always sent `null` when the sender mailed nothing in the
  // 90-day window; the FE typed it `number` and every consumer did
  // `Math.round(readRate * 100)`. That printed a confident "0% read" for
  // a sender we measured nothing about — and 0% is the STRONGEST signal
  // under every low-engagement ranking on this screen.
  it('shows an em dash on the expanded stat card, not a fabricated zero', () => {
    const row = rowById('t-shipping'); // quiet 90d — readRate null
    expect(row.readRate).toBeNull();
    renderRow(row, { expanded: true });

    const stats = screen.getByText('read rate 90d').parentElement!;
    expect(stats.textContent).toContain('—');
    expect(stats.textContent).not.toContain('0%');
  });

  it('still renders a real measured zero for a sender that IS never opened', () => {
    // Two-sided: suppressing unknown must not suppress a true 0%.
    // Old Navy, not Groupon (D133): Groupon's real cascade signals now
    // carry a genuine 30% read rate (see data.ts's own comment on why),
    // so it stopped being a 0%-read example. Old Navy still is one.
    const row = rowById('t-oldnavy'); // readRate 0 over 144 messages
    expect(row.readRate).toBe(0);
    renderRow(row, { expanded: true });

    const stats = screen.getByText('read rate 90d').parentElement!;
    expect(stats.textContent).toContain('0%');
  });

  // `readRate` here is `last90Read / last90Total` (triage.read-service).
  // The why-line said "Never opened", an absolute lifetime claim built
  // from a 90-day window, on the product's core ritual — the stronger
  // twin of the "Never" the Senders surface carried. A sender read for
  // years reads as never opened after one quiet quarter.
  it('never makes a lifetime claim from the 90-day window', () => {
    // Old Navy, not Groupon — see the comment two tests up (D133).
    const row = rowById('t-oldnavy'); // readRate 0 over 144 messages
    const { container } = renderRow(row);
    expect(container.textContent).not.toContain('Never opened');
    expect(container.textContent).toContain('None marked read in 90d');
    // "opened" is unobservable: Gmail exposes only the absence of UNREAD,
    // which a filter or a third-party sweeper can strip with no human
    // ever seeing the message (D45). The first pass at this fix corrected
    // the window and kept the banned verb.
    expect(container.textContent).not.toContain('opened');
  });

  it('never renders an unqualified read-rate percentage', () => {
    // The invariant is conditional, not universal: a protected sender
    // exits the why-line early on its protection evidence and shows no
    // rate at all. What must never happen is a percentage WITHOUT its
    // window — that is the F008 shape.
    for (const id of ['t-groupon', 't-sarah', 't-shipping']) {
      const { unmount, container } = renderRow(rowById(id));
      const text = container.textContent ?? '';
      // The VERB matters as much as the window (D45): Gmail exposes only
      // the absence of the UNREAD label, so "% read" claims a human that
      // a filter or a sweeper could have been. Assert the full phrase.
      if (text.includes('% marked read')) {
        expect(text).toContain('% marked read in 90d');
      }
      expect(text).not.toMatch(/\d% read in 90d/);
      unmount();
    }
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
    // The notice carries the Unprotect control, which is a real
    // mutation — so the row now needs a query client here, the same way
    // it has one in the app (mounted at the root layout).
    return render(
      <QueryWrapper client={createTestQueryClient()}>
        <TriageRow
          row={row}
          expanded={true}
          onToggleExpand={() => {}}
          onAction={() => {}}
          inlinePreview={{ verb: 'Archive', archiveHistoric: false, inboxCount: 2 }}
          // Mirrors what triage-queue.tsx constructs for a daily-Triage
          // row (offerUnprotect unset — surface is the inline preview).
          unprotectSlot={<UnprotectButton row={row} surface="triage-preview" />}
        />
      </QueryWrapper>,
    );
  }

  it('states the protection and says "anyway" on the inline confirm', () => {
    // D226 lets the SHEET be skipped via D34's remember-preference, but
    // the preview always renders. The override notice therefore has to
    // exist on BOTH paths — otherwise skipping the sheet silently skips
    // the acknowledgement while `override: true` still goes on the wire.
    renderInline(rowById('t-sarah')); // protectionReason: 'manual' (the wire's user-set spelling)
    expect(screen.getByRole('button', { name: /Confirm Archive anyway/i })).toBeInTheDocument();
  });

  it('states that the protection SURVIVES the action, and offers Unprotect', () => {
    // Acting on a Protected sender leaves the shield intact, so every
    // future bulk and Autopilot run keeps skipping them while this
    // action feels finished. The inline preview must say so, and offer
    // the separate control — bundling removal into the verb has no undo
    // kind and would forge a D245 sticky override.
    renderInline(rowById('t-sarah'));
    expect(screen.getByRole('status')).toHaveTextContent(
      /stays Protected, so bulk and automatic cleanup will keep skipping it/i,
    );
    expect(screen.getByRole('button', { name: /^Unprotect$/i })).toBeInTheDocument();
  });

  it('says nothing about protection on an unprotected row', () => {
    const { container } = renderInline(rowById('t-groupon'));
    expect(container.textContent).not.toMatch(/stays Protected/);
    expect(screen.getByRole('button', { name: /^Confirm Archive$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Unprotect$/i })).toBeNull();
  });
});

describe('TriageRow — the D245 review row strip (offerUnprotect)', () => {
  // The strip is the PRIMARY control of the protection review, and
  // until 2026-08-10 nothing rendered it in a test — the only assertion
  // was that the screen passes `offerUnprotect` to a mocked
  // TriageScreen, which verifies a prop, not a control.
  function renderStrip(
    row: ReturnType<typeof rowById>,
    opts: { offerUnprotect?: boolean; inline?: boolean } = {},
  ) {
    const offerUnprotect = opts.offerUnprotect ?? true;
    return render(
      <QueryWrapper client={createTestQueryClient()}>
        <TriageRow
          row={row}
          expanded={false}
          onToggleExpand={() => {}}
          onAction={() => {}}
          offerUnprotect={offerUnprotect}
          // Mirrors what triage-queue.tsx constructs per row: the same
          // control, surfaced under whichever `surface` the active
          // position (row strip vs inline notice) needs.
          unprotectSlot={
            <UnprotectButton
              row={row}
              surface={offerUnprotect ? 'onboarding-review' : 'triage-preview'}
            />
          }
          inlinePreview={
            opts.inline ? { verb: 'Archive', archiveHistoric: false, inboxCount: 2 } : null
          }
        />
      </QueryWrapper>,
    );
  }

  it('renders the consequence and the Unprotect control on a protected row', () => {
    renderStrip(rowById('t-sarah'));
    expect(screen.getByText(/Bulk and automatic cleanup skip this sender/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Unprotect$/i })).toBeInTheDocument();
  });

  it('renders no strip for an unprotected row, even on the review', () => {
    renderStrip(rowById('t-groupon'));
    expect(screen.queryByText(/Bulk and automatic cleanup skip this sender/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /^Unprotect$/i })).toBeNull();
  });

  it('renders no strip outside the review (offerUnprotect unset)', () => {
    renderStrip(rowById('t-sarah'), { offerUnprotect: false });
    expect(screen.queryByText(/Bulk and automatic cleanup skip this sender/i)).toBeNull();
  });

  it('never stacks two Unprotect buttons when the strip and an inline preview are both live', () => {
    // `unprotectSlot={offerUnprotect ? undefined : unprotectSlot}` on the
    // inline notice (triage-row.tsx) exists for exactly this: with D34's
    // remember-preference set, a protected row on the review renders BOTH
    // the strip and the inline preview. Two identical buttons with two
    // overlapping sentences on one card was the bug; this pins the
    // suppression in both directions.
    renderStrip(rowById('t-sarah'), { inline: true });
    expect(screen.getAllByRole('button', { name: /^Unprotect$/i })).toHaveLength(1);
    // The notice itself still renders — only its duplicate control is
    // suppressed.
    expect(screen.getByRole('status')).toHaveTextContent(/stays Protected/i);
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
      <QueryWrapper client={createTestQueryClient()}>
        <TriageRow
          row={rowById('t-sarah')}
          expanded={false}
          onToggleExpand={() => {}}
          onAction={() => {}}
          inlinePreview={{ verb: 'Archive', archiveHistoric: false, inboxCount: 2 }}
        />
      </QueryWrapper>,
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

describe('TriageRow — inline zero-count no-op gate', () => {
  // D34 lets the sheet be skipped, so this button IS the confirm surface
  // for those users. The sheet refuses an inbox-moving verb at a resolved
  // count of zero (`nothingToActOn`) and `triage-screen.tsx` refuses the
  // matching dispatch; without the same gate here the button renders
  // armed and a click does nothing the user can see.
  const inline = (verb: 'Archive' | 'Later' | 'Delete' | 'Unsubscribe', inboxCount: number) => ({
    verb,
    archiveHistoric: false,
    inboxCount,
  });

  it.each(['Archive', 'Later', 'Delete'] as const)(
    'disables Confirm %s and says why at a resolved count of zero',
    (verb) => {
      const row = rowById('t-groupon');
      const { rerender } = render(
        <TriageRow
          row={row}
          expanded={true}
          onToggleExpand={() => {}}
          onAction={() => {}}
          inlinePreview={inline(verb, 0)}
        />,
      );

      expect(screen.getByRole('button', { name: new RegExp(`^Confirm ${verb}$`) })).toBeDisabled();
      expect(screen.getByText(/Nothing to act on/i)).toBeInTheDocument();
      // The shortcut hint must not advertise a key the screen refuses.
      expect(screen.queryByText(/press .* again/i)).toBeNull();

      rerender(
        <TriageRow
          row={row}
          expanded={true}
          onToggleExpand={() => {}}
          onAction={() => {}}
          inlinePreview={inline(verb, 1)}
        />,
      );
      expect(screen.getByRole('button', { name: new RegExp(`^Confirm ${verb}$`) })).toBeEnabled();
      expect(screen.queryByText(/Nothing to act on/i)).toBeNull();
    },
  );

  it('leaves Confirm Unsubscribe armed at zero — it cuts future mail', () => {
    const row = rowById('t-groupon');
    render(
      <TriageRow
        row={row}
        expanded={true}
        onToggleExpand={() => {}}
        onAction={() => {}}
        inlinePreview={inline('Unsubscribe', 0)}
      />,
    );

    expect(screen.getByRole('button', { name: /^Confirm Unsubscribe$/ })).toBeEnabled();
    expect(screen.queryByText(/Nothing to act on/i)).toBeNull();
  });

  it('keeps the verb toolbar live so a zero count does not trap the row', () => {
    // The sheet's `confirmDisabled` gates the confirm button and nothing
    // else. Folding the zero case into `actionsDisabled` would also kill
    // the toolbar and the swipe, leaving a row whose only exit is Esc.
    const row = rowById('t-groupon');
    const clicked: string[] = [];
    render(
      <TriageRow
        row={row}
        expanded={true}
        onToggleExpand={() => {}}
        onAction={(verb) => clicked.push(verb)}
        inlinePreview={inline('Archive', 0)}
      />,
    );

    const later = screen.getByRole('button', { name: /^Later \(L\)/ });
    expect(later).toBeEnabled();
    later.click();
    expect(clicked).toEqual(['Later']);
  });
});
