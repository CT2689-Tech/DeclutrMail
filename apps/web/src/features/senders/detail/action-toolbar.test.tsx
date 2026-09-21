import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { tokens } from '@declutrmail/shared';
import { ActionToolbar } from './action-toolbar';
import { makeSender } from '../testing/make-sender';

const sender: typeof makeSender = (overrides = {}) =>
  makeSender({
    displayName: 'Acme',
    domain: 'acme.example',
    gmailCategory: 'promotions',
    readRate: 0.1,
    lastDays: 2,
    unsubscribeMethod: 'none',
    ...overrides,
  });

describe('ActionToolbar — D245 fact-derived primary', () => {
  function actionButtonTag(html: string, label: string): string {
    const marker = `aria-label="${label} (${label[0]})"`;
    const markerAt = html.indexOf(marker);
    const start = html.lastIndexOf('<button', markerAt);
    const end = html.indexOf('>', markerAt);
    return html.slice(start, end + 1);
  }

  it.each([
    ['Keep', sender(), tokens.color.primary],
    ['Unsubscribe', sender({ unsubscribeMethod: 'one_click' }), tokens.color.amber],
    ['Archive', sender({ lastDays: 250 }), tokens.color.fg],
    [
      'Keep',
      sender({
        unsubscribeMethod: 'one_click',
        protectionFlags: {
          isProtected: true,
          protectionReason: 'user_defined',
          protectionSetAt: '2026-06-01T00:00:00.000Z',
        },
      }),
      tokens.color.primary,
    ],
  ] as const)('highlights %s from observed facts', (label, row, background) => {
    const html = renderToStaticMarkup(<ActionToolbar sender={row} onAction={() => {}} shortcuts />);
    expect(actionButtonTag(html, label)).toContain(`background:${background}`);
  });

  it('emits the selected action without any recommendation input', () => {
    const onAction = vi.fn();
    const row = sender();
    render(<ActionToolbar sender={row} onAction={onAction} shortcuts />);

    fireEvent.click(screen.getByRole('button', { name: 'Archive (A)' }));
    expect(onAction).toHaveBeenCalledWith({ verb: 'Archive', senders: [row] });
  });

  it('renders the full canonical verb set K/A/U/L/D, Delete included', () => {
    // Delete was missing here until 2026-07-26 while a note in Triage
    // told every user it lived on Sender Detail. Nothing pinned a
    // verb count on any surface, which is why the gap survived every gate
    // — this assertion is that missing tripwire.
    render(<ActionToolbar sender={sender()} onAction={() => {}} shortcuts />);
    for (const [verb, key] of [
      ['Keep', 'K'],
      ['Archive', 'A'],
      ['Unsubscribe', 'U'],
      ['Later', 'L'],
      ['Delete', 'D'],
    ] as const) {
      expect(screen.getByRole('button', { name: `${verb} (${key})` })).toBeInTheDocument();
    }
  });

  it('emits Delete, and keeps it live on a standing-protected sender', () => {
    const onAction = vi.fn();
    const row = sender();
    const { unmount } = render(<ActionToolbar sender={row} onAction={onAction} shortcuts />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete (D)' }));
    expect(onAction).toHaveBeenCalledWith({ verb: 'Delete', senders: [row] });
    unmount();

    // D245 excludes Protected senders from BULK and AUTOMATIC actions —
    // not from an explicit click aimed at one sender. The server agrees:
    // it answers a protected single-sender action with a 409 whose copy
    // is "Confirm to archive anyway" and accepts an `override`. The
    // acknowledgement belongs in the mandatory D226 confirm, not in a
    // greyed-out button that makes the 409 unreachable.
    const protectedRow = sender({
      protectionFlags: {
        isProtected: true,
        protectionReason: 'user_defined',
        protectionSetAt: '2026-06-01T00:00:00.000Z',
      },
    });
    const onProtectedAction = vi.fn();
    render(<ActionToolbar sender={protectedRow} onAction={onProtectedAction} shortcuts />);
    const deleteButton = screen.getByRole('button', { name: 'Delete (D)' });
    expect(deleteButton).toBeEnabled();
    fireEvent.click(deleteButton);
    expect(onProtectedAction).toHaveBeenCalledWith({ verb: 'Delete', senders: [protectedRow] });
  });
});

describe('ActionToolbar — one filled verb, four quiet ones', () => {
  it('fills only the fact-derived primary', () => {
    const html = renderToStaticMarkup(
      <ActionToolbar sender={sender()} onAction={() => {}} shortcuts />,
    );
    // Keep is the primary for this sender; every other verb is a quiet
    // fill capsule (the key hints inside are not buttons).
    const buttons = html.match(/<button[^>]*>/g) ?? [];
    expect(buttons).toHaveLength(5);
    expect(buttons.filter((b) => b.includes(`background:${tokens.color.fill}`))).toHaveLength(4);
    expect(buttons.filter((b) => b.includes(`background:${tokens.color.primary}`))).toHaveLength(1);
    expect(html).not.toContain('Nothing moves until you confirm');
  });
});

describe('ActionToolbar — K/A/U/L/D keys', () => {
  it('routes a key through the same onAction a click uses', () => {
    const onAction = vi.fn();
    const row = sender();
    render(<ActionToolbar sender={row} onAction={onAction} shortcuts />);
    fireEvent.keyDown(window, { key: 'a' });
    expect(onAction).toHaveBeenCalledWith({ verb: 'Archive', senders: [row] });
  });

  it('ignores a key for a verb the sender cannot take, a modified key, and typing', () => {
    const onAction = vi.fn();
    // `unsubscribeMethod: 'none'` — Unsubscribe is disabled for this sender.
    render(
      <>
        <input aria-label="search" />
        <ActionToolbar sender={sender()} onAction={onAction} shortcuts />
      </>,
    );
    fireEvent.keyDown(window, { key: 'u' });
    fireEvent.keyDown(window, { key: 'a', metaKey: true });
    fireEvent.keyDown(screen.getByLabelText('search'), { key: 'a' });
    expect(onAction).not.toHaveBeenCalled();
  });

  it('stays inert while a modal is open, so a key never acts behind the preview', () => {
    const onAction = vi.fn();
    render(
      <>
        <div role="dialog" aria-modal="true" />
        <ActionToolbar sender={sender()} onAction={onAction} shortcuts />
      </>,
    );
    fireEvent.keyDown(window, { key: 'a' });
    expect(onAction).not.toHaveBeenCalled();
  });

  it('binds nothing and advertises no key when shortcuts are off (the side pane)', () => {
    const onAction = vi.fn();
    render(<ActionToolbar sender={sender()} onAction={onAction} />);
    fireEvent.keyDown(window, { key: 'a' });
    expect(onAction).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument();
    expect(screen.queryByText('A')).not.toBeInTheDocument();
  });
});
