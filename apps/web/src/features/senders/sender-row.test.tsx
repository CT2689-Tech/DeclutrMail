import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SWIPE_THRESHOLD_PX } from '@declutrmail/shared';

import { RowActivityProvider, type RowActivityById } from './row-activity';
import { DomainGroupRow, SenderRow } from './sender-row';
import { makeSender } from './testing/make-sender';

const noop = () => {};

function renderRow(
  overrides: Parameters<typeof makeSender>[0] = {},
  props: Partial<React.ComponentProps<typeof SenderRow>> = {},
  activity: RowActivityById = new Map(),
) {
  const s = makeSender(overrides);
  render(
    <RowActivityProvider value={activity}>
      <SenderRow
        s={s}
        selected={false}
        onToggleSelect={noop}
        onOpen={noop}
        onAction={noop}
        {...props}
      />
    </RowActivityProvider>,
  );
  return s;
}

describe('<SenderRow /> — what the row says', () => {
  // Senders are keyed by ADDRESS, so one brand legitimately owns several
  // rows; the domain alone renders them identical.
  it('shows the stored size', () => {
    renderRow({ sizeBytes: 1_500_000 });
    expect(screen.getByTestId('sender-size-cell')).toHaveTextContent('≈ 1.5 MB');
  });

  it('shows the full address, not just the domain', () => {
    renderRow({ displayName: 'Redfin', email: 'listings@redfin.com', domain: 'redfin.com' });
    expect(screen.getByText('listings@redfin.com')).toBeInTheDocument();
  });

  it('falls back to the domain when there is no display name — never the address twice', () => {
    renderRow({ displayName: '', email: 'bare@redfin.com', domain: 'redfin.com' });
    expect(screen.getAllByText('bare@redfin.com')).toHaveLength(1);
    expect(screen.getByText('redfin.com')).toBeInTheDocument();
  });

  it('keeps lifetime received alongside current inbox and explicitly scoped read-state evidence', () => {
    renderRow({ totalReceived: 1204, monthlyVolume: 37, inboxCount: 42, readRate: 0.2 });
    expect(screen.getByText('1,204')).toBeInTheDocument();
    expect(screen.getByText('emails')).toBeInTheDocument();
    expect(screen.queryByText(/37/)).not.toBeInTheDocument();
    expect(screen.getByText('42 in inbox')).toBeInTheDocument();
    expect(screen.getByText('20% marked read · 90 days')).toBeInTheDocument();
  });

  it('refreshes current mail after cleanup while the received history stays unchanged', () => {
    const props = { selected: false, onToggleSelect: noop, onOpen: noop, onAction: noop };
    const { rerender } = render(
      <SenderRow
        {...props}
        s={makeSender({ totalReceived: 3558, inboxCount: 100, archivedCount: 3458 })}
      />,
    );
    expect(screen.getByText('3,558')).toBeInTheDocument();
    rerender(
      <SenderRow
        {...props}
        s={makeSender({ totalReceived: 3558, inboxCount: 0, archivedCount: 850 })}
      />,
    );
    expect(screen.getByText('850')).toBeInTheDocument();
    expect(screen.getByText('inbox + archived')).toBeInTheDocument();
    expect(screen.getByText('0 in inbox')).toBeInTheDocument();
    expect(screen.getByText('850 archived')).toBeInTheDocument();
    expect(screen.queryByText('3,558')).not.toBeInTheDocument();
    rerender(
      <SenderRow
        {...props}
        s={makeSender({ totalReceived: 3558, inboxCount: 100, archivedCount: 3458 })}
      />,
    );
    expect(screen.getByText('3,558')).toBeInTheDocument();
  });

  it('does not turn unknown inbox or read-state evidence into zero', () => {
    renderRow({ inboxCount: null, readRate: null });
    expect(screen.queryByText(/in inbox|marked read/)).not.toBeInTheDocument();
  });

  it('marks a Protected sender', () => {
    renderRow({
      protectionFlags: { isProtected: true, protectionReason: 'starred', protectionSetAt: null },
    });
    expect(screen.getByRole('img', { name: 'Protected' })).toBeInTheDocument();
  });

  it('says nothing about unsubscribe until the user has asked for one', () => {
    renderRow({ unsubscribeMethod: 'one_click' });
    expect(screen.queryByText(/request|unavailable|gmail/i)).not.toBeInTheDocument();
  });

  it('keeps compact identity separate from one lifecycle status and complete evidence', () => {
    renderRow(
      {
        displayName: 'Old Navy',
        policyType: 'unsubscribe',
        unsubStatus: 'endpoint_accepted',
        inboxCount: 18,
        readRate: 0.12,
      },
      { compact: true },
    );
    const name = screen.getByRole('link', { name: 'Old Navy' });
    const status = screen.getByText('Request accepted');
    expect(name.parentElement).not.toContainElement(status);
    expect(screen.getAllByText('Request accepted')).toHaveLength(1);
    expect(screen.getByText('18 in inbox')).toBeInTheDocument();
    expect(screen.getByText('12% marked read · 90 days')).toBeInTheDocument();
  });

  it('keeps one compact activity status below the identity without changing its accessible label', () => {
    renderRow(
      { id: 'working', displayName: 'Substack' },
      { compact: true },
      new Map([['working', { phase: 'working', verb: 'archive' }]]),
    );
    const name = screen.getByRole('link', { name: 'Substack, Archiving…' });
    expect(screen.getAllByText('Archiving…')).toHaveLength(1);
    expect(name.parentElement).not.toContainElement(screen.getByText('Archiving…'));
  });

  it.each([false, true])(
    'shows one pending row status at compact=%s during combined cleanup',
    (compact) => {
      renderRow(
        { id: 'working', policyType: 'unsubscribe', unsubStatus: 'requested' },
        { compact },
        new Map([['working', { phase: 'working', verb: 'delete' }]]),
      );
      expect(screen.getAllByText('Deleting…')).toHaveLength(1);
      expect(screen.queryByText('Requesting…')).toBeNull();
    },
  );

  it('states the unsubscribe lifecycle once it exists', () => {
    renderRow({ policyType: 'unsubscribe', unsubStatus: 'endpoint_accepted' });
    expect(screen.getByText('Request accepted')).toBeInTheDocument();
  });

  it('does not imply a legacy one-click request is still being delivered', () => {
    renderRow({ policyType: 'unsubscribe', unsubscribeMethod: 'one_click', unsubStatus: null });
    expect(screen.getByText('Outcome unknown').parentElement).toHaveAttribute(
      'title',
      'We can’t confirm whether this earlier request went through.',
    );
    expect(screen.queryByText('Requesting…')).not.toBeInTheDocument();
  });
});

describe('<SenderRow /> — opening vs. acting', () => {
  it('opens from a plain row click and from the name link', () => {
    const onOpen = vi.fn();
    const s = renderRow({}, { onOpen });
    fireEvent.click(screen.getByTestId(`sender-row-${s.id}`));
    fireEvent.click(screen.getByRole('link', { name: s.name }));
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it('the name is a real link to the sender page', () => {
    const s = renderRow({ id: 'abc' });
    expect(screen.getByRole('link', { name: s.name })).toHaveAttribute('href', '/senders/abc');
  });

  it('does NOT open from the checkbox, a verb button or the ⋯ menu', () => {
    const onOpen = vi.fn();
    const onToggleSelect = vi.fn();
    const onAction = vi.fn();
    renderRow({}, { onOpen, onToggleSelect, onAction });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /^More actions for/ }));
    const [verb] = screen.getAllByRole('button');
    fireEvent.click(verb!);
    expect(onToggleSelect).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('marks the row open in the detail pane', () => {
    const s = renderRow({}, { active: true });
    expect(screen.getByRole('link', { name: s.name })).toHaveAttribute('aria-current', 'true');
  });
});

describe('<SenderRow compact /> — phone', () => {
  type Direction = 'right' | 'left' | 'up';
  const swipe = (row: HTMLElement, direction: Direction, release = true) => {
    const at = (x: number, y: number) => ({
      pointerId: 1,
      pointerType: 'touch',
      clientX: x,
      clientY: y,
    });
    const d = SWIPE_THRESHOLD_PX + 40;
    const dx = direction === 'right' ? d : direction === 'left' ? -d : 0;
    const dy = direction === 'up' ? -d : 0;
    fireEvent.pointerDown(row, at(200, 200));
    fireEvent.pointerMove(row, at(200 + dx, 200 + dy));
    if (release) fireEvent.pointerUp(row, at(200 + dx, 200 + dy));
  };
  /** A sender every verb can run on. */
  const FULL = {
    inboxCount: 12,
    archivedCount: 3,
    unsubscribeMethod: 'one_click',
    policyType: null,
    unsubStatus: null,
  } as const;

  it('keeps the checkbox and the ⋯ menu; drops the verb button', () => {
    renderRow({}, { compact: true });
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it.each([
    ['right', 'Keep'],
    ['left', 'Unsubscribe'],
    ['up', 'Delete'],
  ] as const)('swipe %s → %s through onAction (the D226 preview path)', (direction, verb) => {
    const onAction = vi.fn();
    const s = renderRow(FULL, { compact: true, onAction });
    swipe(screen.getByTestId(`sender-row-${s.id}`), direction);
    expect(onAction).toHaveBeenCalledExactlyOnceWith({ verb, senders: [s] });
  });

  it('names the verb while dragging, in the shared words', () => {
    const s = renderRow(FULL, { compact: true });
    const row = screen.getByTestId(`sender-row-${s.id}`);
    swipe(row, 'left', false);
    expect(screen.getByText('← Unsubscribe')).toBeInTheDocument();
  });

  it('retains a fresh unsubscribe swipe with zero current mail', () => {
    const onAction = vi.fn();
    const s = renderRow(
      {
        inboxCount: 0,
        archivedCount: 0,
        unsubscribeMethod: 'one_click',
        policyType: null,
        unsubStatus: null,
      },
      { compact: true, onAction },
    );
    swipe(screen.getByTestId(`sender-row-${s.id}`), 'left');
    expect(onAction).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ verb: 'Unsubscribe' }),
    );
  });

  it.each(['right', 'left', 'up'] as const)(
    'offers no %s swipe where nothing can run: no mail, no unsubscribe channel',
    (direction) => {
      const onAction = vi.fn();
      const s = renderRow(
        { inboxCount: 0, archivedCount: 0, lastDays: 250, unsubscribeMethod: 'none' },
        { compact: true, onAction },
      );
      swipe(screen.getByTestId(`sender-row-${s.id}`), direction);
      expect(onAction).not.toHaveBeenCalled();
      expect(screen.queryByText(/^[←→↑] /)).not.toBeInTheDocument();
    },
  );

  it('shows no hint for a verb that would then be refused', () => {
    // No unsubscribe channel: dragging left must not promise Unsubscribe.
    const s = renderRow({ ...FULL, unsubscribeMethod: null }, { compact: true });
    swipe(screen.getByTestId(`sender-row-${s.id}`), 'left', false);
    expect(screen.queryByText('← Unsubscribe')).not.toBeInTheDocument();
  });

  it.each(['requested', 'endpoint_accepted', 'user_marked_sent'] as const)(
    'does not offer Unsubscribe by swipe while a %s request is in flight; the other swipes still work',
    (unsubStatus) => {
      const onAction = vi.fn();
      const s = renderRow(
        { ...FULL, policyType: 'unsubscribe', unsubStatus },
        { compact: true, onAction },
      );
      const row = screen.getByTestId(`sender-row-${s.id}`);
      swipe(row, 'left');
      expect(onAction).not.toHaveBeenCalled();
      expect(screen.queryByText('← Unsubscribe')).not.toBeInTheDocument();
      swipe(row, 'right');
      expect(onAction).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ verb: 'Keep' }));
    },
  );

  it('swipe is refused while the row is busy — the same action its inert button refuses', () => {
    const onAction = vi.fn();
    const s = makeSender(FULL);
    render(
      <RowActivityProvider value={new Map([[s.id, { phase: 'working', verb: 'archive' }]])}>
        <SenderRow
          s={s}
          selected={false}
          compact
          onToggleSelect={noop}
          onOpen={noop}
          onAction={onAction}
        />
      </RowActivityProvider>,
    );
    for (const direction of ['right', 'left', 'up'] as const) {
      swipe(screen.getByTestId(`sender-row-${s.id}`), direction);
    }
    expect(onAction).not.toHaveBeenCalled();
    expect(screen.getByText('Archiving…')).toHaveAttribute('data-dm-row-activity', 'working');
  });

  it('a full-width row ignores the swipe', () => {
    const onAction = vi.fn();
    const s = renderRow(FULL, { onAction });
    swipe(screen.getByTestId(`sender-row-${s.id}`), 'left');
    expect(onAction).not.toHaveBeenCalled();
  });
});

describe('<DomainGroupRow />', () => {
  it('states the member count and the summed received total, and toggles', () => {
    const onToggleExpand = vi.fn();
    render(
      <DomainGroupRow
        domain="brand.com"
        senderCount={4}
        totalReceived={2300}
        memberIds={['a', 'b', 'c', 'd']}
        expanded={false}
        onToggleExpand={onToggleExpand}
      />,
    );
    const header = screen.getByRole('button', { name: /brand\.com/ });
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(header).toHaveTextContent('4 senders');
    expect(header).toHaveTextContent('2,300');
    fireEvent.click(header);
    expect(onToggleExpand).toHaveBeenCalledTimes(1);
  });
});

it('shows a previously saved Keep decision after a compact row is revisited', () => {
  renderRow({ policyType: 'keep' }, { compact: true });
  expect(screen.getByText('Kept')).toBeInTheDocument();
});

it('keeps the compact Protected state below the sender identity so the name has room', () => {
  renderRow(
    {
      displayName: 'Acme Updates',
      protectionFlags: {
        isProtected: true,
        protectionReason: 'user_defined',
        protectionSetAt: null,
      },
    },
    { compact: true },
  );
  const name = screen.getByRole('link', { name: 'Acme Updates' });
  expect(name.parentElement).not.toContainElement(screen.getByText('Protected'));
});
