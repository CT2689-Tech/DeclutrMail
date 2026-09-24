import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { RowActivityProvider, type RowActivityById } from './row-activity';
import {
  DomainGroupRow,
  resolvesToSwipeRight,
  ROW_SWIPE_THRESHOLD_PX,
  SenderRow,
} from './sender-row';
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

describe('resolvesToSwipeRight — the phone row gesture', () => {
  it('right past the threshold resolves', () => {
    expect(resolvesToSwipeRight(ROW_SWIPE_THRESHOLD_PX + 1, 0)).toBe(true);
  });
  it('left, vertical and sub-threshold drags do not', () => {
    expect(resolvesToSwipeRight(-ROW_SWIPE_THRESHOLD_PX - 40, 0)).toBe(false);
    expect(resolvesToSwipeRight(0, 200)).toBe(false);
    expect(resolvesToSwipeRight(ROW_SWIPE_THRESHOLD_PX - 1, 0)).toBe(false);
  });
  it('diagonals are rejected by the dominance ratio; minor drift is not', () => {
    expect(resolvesToSwipeRight(100, 90)).toBe(false);
    expect(resolvesToSwipeRight(120, 20)).toBe(true);
  });
  it('honours custom threshold + dominance', () => {
    expect(resolvesToSwipeRight(30, 0, { threshold: 20 })).toBe(true);
    expect(resolvesToSwipeRight(100, 60, { dominance: 2 })).toBe(false);
  });
});

describe('<SenderRow /> — what the row says', () => {
  // Senders are keyed by ADDRESS, so one brand legitimately owns several
  // rows; the domain alone renders them identical.
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
    expect(screen.getByText('20% marked read · 90d')).toBeInTheDocument();
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
    expect(screen.getByText('12% marked read · 90d')).toBeInTheDocument();
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

  it('states the unsubscribe lifecycle once it exists', () => {
    renderRow({ policyType: 'unsubscribe', unsubStatus: 'endpoint_accepted' });
    expect(screen.getByText('Request accepted')).toBeInTheDocument();
  });

  it('does not imply a legacy one-click request is still being delivered', () => {
    renderRow({ policyType: 'unsubscribe', unsubscribeMethod: 'one_click', unsubStatus: null });
    expect(screen.getByText('Outcome unknown').parentElement).toHaveAttribute(
      'title',
      'This earlier unsubscribe has no delivery record, so we cannot confirm its outcome',
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
  const swipeRight = (row: HTMLElement) => {
    const at = (clientX: number) => ({ pointerId: 1, pointerType: 'touch', clientX, clientY: 0 });
    fireEvent.pointerDown(row, at(0));
    fireEvent.pointerMove(row, at(ROW_SWIPE_THRESHOLD_PX + 40));
    fireEvent.pointerUp(row, at(ROW_SWIPE_THRESHOLD_PX + 40));
  };

  it('keeps the checkbox and the ⋯ menu; drops the verb button', () => {
    renderRow({}, { compact: true });
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('swipe-right fires the primary verb through onAction (the D226 preview path)', () => {
    const onAction = vi.fn();
    const s = renderRow({}, { compact: true, onAction });
    swipeRight(screen.getByTestId(`sender-row-${s.id}`));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('swipe is refused while the row is busy — the same action its inert button refuses', () => {
    const onAction = vi.fn();
    const s = makeSender();
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
    swipeRight(screen.getByTestId(`sender-row-${s.id}`));
    expect(onAction).not.toHaveBeenCalled();
    expect(screen.getByText('Archiving…')).toHaveAttribute('data-dm-row-activity', 'working');
  });

  it('a full-width row ignores the swipe', () => {
    const onAction = vi.fn();
    const s = renderRow({}, { onAction });
    swipeRight(screen.getByTestId(`sender-row-${s.id}`));
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
