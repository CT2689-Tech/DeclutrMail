// Interaction tests for the shared `<UndoTray>` pill — the shared package
// tests are SSR-only (no DOM), so expand / shrink / dismiss live here.
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TRAY_COMPACT_AFTER_MS, UndoTray } from '@declutrmail/shared';
import type { UndoTrayDataSource, UndoTrayEntry, UndoTrayNotice } from '@declutrmail/shared';

function entry(overrides: Partial<UndoTrayEntry> = {}): UndoTrayEntry {
  return {
    token: '11111111-1111-1111-1111-111111111111',
    actionKind: 'archive',
    createdAt: '2026-06-09T14:30:00.000Z',
    expiresAt: '2026-06-16T14:30:00.000Z',
    ...overrides,
  };
}

function source(overrides: Partial<UndoTrayDataSource> = {}): UndoTrayDataSource {
  return { entries: [], isLoading: false, revert: async () => {}, ...overrides };
}

// Founder feedback 2026-09-20: the panel "still feels verbose". It is ONE
// pill that says the one thing the user is waiting on, and gets out of the way.
describe('<UndoTray /> — one pill', () => {
  afterEach(() => vi.useRealTimers());

  const running: UndoTrayNotice = {
    id: 'g1',
    tone: 'working',
    label: 'Deleting…',
    who: 'Yankee Candle + 12 others',
    detail: '4 of 13',
  };
  const failed: UndoTrayNotice = {
    id: 'g2',
    tone: 'attention',
    label: '2 of 13 senders failed',
    onDismiss: vi.fn(),
  };
  const done = entry({ actionKind: 'delete', affectedCount: 95, senderCount: 1 });

  it('says a finished action in one line with its Undo — no header, no deadline', () => {
    const revert = vi.fn(async () => {});
    render(<UndoTray dataSource={source({ entries: [done], revert })} />);
    const pill = screen.getByRole('region', { name: 'Recent actions' });
    expect(pill).toHaveAttribute('data-dm-undo-tray', 'pill');
    expect(pill).toHaveTextContent(/^Deleted 95 emails/);
    expect(pill).not.toHaveTextContent(/until|Trash|applied/);
    fireEvent.click(screen.getByRole('button', { name: /^Undo Delete/ }));
    expect(revert).toHaveBeenCalledWith(done.token);
  });

  it('puts a running action ahead of everything, with its progress and no Undo', () => {
    render(<UndoTray dataSource={source({ entries: [done], notices: [failed, running] })} />);
    const pill = screen.getByRole('region', { name: 'Recent actions' });
    expect(pill).toHaveTextContent('Deleting… · 4 of 13');
    expect(screen.queryByRole('button', { name: /^Undo/ })).toBeNull();
    expect(screen.getByLabelText('Working')).toBeInTheDocument();
  });

  it('shows on its own for a running action — nothing to undo yet', () => {
    render(<UndoTray dataSource={source({ notices: [running] })} />);
    expect(screen.getByRole('region', { name: 'Recent actions' })).toHaveTextContent('Deleting…');
  });

  it('puts a problem ahead of the last success, as an alert that can be dismissed', () => {
    render(
      <UndoTray
        dataSource={source({ entries: [done], notices: [failed] })}
        onViewActivity={() => {}}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('2 of 13 senders failed');
    expect(screen.getByRole('button', { name: 'See Activity' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Dismiss/ }));
    expect(failed.onDismiss).toHaveBeenCalled();
  });

  it('opens to the full list and closes again', () => {
    const second = entry({ token: '22222222-2222-2222-2222-222222222222', actionKind: 'later' });
    render(<UndoTray dataSource={source({ entries: [done, second] })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show all recent actions' }));
    expect(screen.getByRole('region', { name: 'Recent actions' })).toHaveAttribute(
      'data-dm-undo-tray',
      'open',
    );
    expect(screen.getAllByRole('button', { name: /^Undo / })).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse recent actions' }));
    expect(screen.getAllByRole('button', { name: /^Undo / })).toHaveLength(1);
  });

  it('offers no expander when the pill already says everything', () => {
    render(<UndoTray dataSource={source({ entries: [done] })} />);
    expect(screen.queryByRole('button', { name: 'Show all recent actions' })).toBeNull();
  });

  it('shrinks a finished action after a few seconds — never a running one, never while held', () => {
    vi.useFakeTimers();
    const { rerender } = render(<UndoTray dataSource={source({ entries: [done] })} />);
    const region = () => screen.getByRole('region', { name: 'Recent actions' });

    // Held (hover): stays full size past the deadline.
    fireEvent.mouseEnter(region());
    act(() => void vi.advanceTimersByTime(TRAY_COMPACT_AFTER_MS + 100));
    expect(region()).toHaveAttribute('data-dm-undo-tray', 'pill');

    fireEvent.mouseLeave(region());
    act(() => void vi.advanceTimersByTime(TRAY_COMPACT_AFTER_MS + 100));
    expect(region()).toHaveAttribute('data-dm-undo-tray', 'compact');
    // Still one click from every Undo.
    fireEvent.click(screen.getByRole('button', { name: /Show 1 recent action/ }));
    expect(region()).toHaveAttribute('data-dm-undo-tray', 'open');

    // A running action: full size for as long as it runs.
    rerender(<UndoTray dataSource={source({ entries: [done], notices: [running] })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse recent actions' }));
    act(() => void vi.advanceTimersByTime(TRAY_COMPACT_AFTER_MS * 3));
    expect(region()).toHaveAttribute('data-dm-undo-tray', 'pill');
  });
});
