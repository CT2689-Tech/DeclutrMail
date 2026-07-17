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
    const html = renderToStaticMarkup(<ActionToolbar sender={row} onAction={() => {}} />);
    expect(actionButtonTag(html, label)).toContain(`background:${background}`);
  });

  it('emits the selected action without any recommendation input', () => {
    const onAction = vi.fn();
    const row = sender();
    render(<ActionToolbar sender={row} onAction={onAction} />);

    fireEvent.click(screen.getByRole('button', { name: 'Archive (A)' }));
    expect(onAction).toHaveBeenCalledWith({ verb: 'Archive', senders: [row] });
  });
});
