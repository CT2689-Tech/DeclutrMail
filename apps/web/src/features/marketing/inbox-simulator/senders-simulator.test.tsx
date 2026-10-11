import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fillCopy, pluralCopy, WS5_COPY } from '@declutrmail/shared/copy/launch';

import { SendersSimulator } from './senders-simulator';

afterEach(() => {
  vi.unstubAllEnvs();
});

function preview(): HTMLElement {
  return screen.getByRole('dialog');
}

describe('SendersSimulator', () => {
  it('opens a visible sender in the right inspector and follows the active filter', () => {
    render(<SendersSimulator />);
    expect(screen.getByRole('region', { name: 'Sample senders' })).toHaveTextContent(
      '4 active senders',
    );
    expect(screen.getByRole('complementary', { name: 'Sender details' })).toHaveTextContent(
      'Northstar Weekly',
    );
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter' }), {
      target: { value: 'protected' },
    });
    expect(screen.getByRole('complementary', { name: 'Sender details' })).toHaveTextContent(
      'Parcel Receipts',
    );
    expect(screen.getByRole('region', { name: 'Sample senders' })).not.toHaveTextContent(
      'Northstar Weekly',
    );
  });

  it('changes Delete counts with age and Inbox + archived reach before confirmation', () => {
    render(<SendersSimulator />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = preview();
    expect(dialog).toHaveTextContent('Inbox only · 45'); // Default 6-month window.
    fireEvent.click(within(dialog).getByRole('radio', { name: /Inbox \+ archived/ }));
    expect(dialog).toHaveTextContent('155 emails currently match');
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'How far back to act on' }), {
      target: { value: '365' },
    });
    expect(dialog).toHaveTextContent('76 emails currently match');
    expect(within(dialog).queryByText('Your Sunday reading list')).not.toBeInTheDocument();
  });

  it('allows future Unsubscribe even when the selected past-email scope is empty', () => {
    render(<SendersSimulator />);
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    fireEvent.click(within(preview()).getByRole('button', { name: 'Archive 111' }));
    fireEvent.click(screen.getByRole('button', { name: 'Unsubscribe' }));
    expect(
      within(preview()).getByRole('radio', { name: /Unsubscribe and archive 0/ }),
    ).toBeDisabled();
    expect(preview()).toHaveTextContent('Email you already have stays where it is.');
    const confirm = within(preview()).getByRole('button', { name: 'Unsubscribe' });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(screen.getByRole('complementary', { name: 'Sender details' })).toHaveTextContent(
      'Unsubscribe requested',
    );
    expect(screen.getByRole('region', { name: 'Sample activity' })).toHaveTextContent(
      'Unsubscribe requested from 1 sender',
    );
  });

  it('skips Protected senders in bulk and prevents stale snapshot Undo', () => {
    render(<SendersSimulator />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all visible senders' }));
    fireEvent.click(
      within(screen.getByRole('region', { name: 'Sample senders' })).getByRole('button', {
        name: 'Archive',
      }),
    );
    expect(preview()).toHaveTextContent('1 selected sender is excluded');
    fireEvent.click(within(preview()).getByRole('button', { name: /^Archive \d+/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(within(preview()).getByRole('radio', { name: /Inbox \+ archived/ }));
    fireEvent.click(within(preview()).getByRole('button', { name: /^Delete \d+/ }));
    const activity = screen.getByRole('region', { name: 'Sample activity' });
    expect(activity).toHaveTextContent('A later sample decision changed this sender');
    expect(within(activity).getAllByRole('button', { name: 'Undo' })).toHaveLength(1);
  });
});

describe('SendersSimulator — WS5 sample surfaces', () => {
  it('shows the Inbox Report from sample data', () => {
    render(<SendersSimulator />);
    expect(screen.getByText(/mostly leave unread/)).toBeInTheDocument();
    expect(screen.getByText(WS5_COPY['report.trust'])).toBeInTheDocument();
    expect(
      screen.getByText('1 of these senders includes an unsubscribe link.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Unsubscribe + archive 1 sender' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review them first' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'What we store and share' })).toHaveAttribute(
      'href',
      '/privacy',
    );
    const links = document.querySelectorAll('a[href]');
    for (const link of links) {
      expect(link.getAttribute('href') ?? '').not.toMatch(
        /^\/(senders|settings|home|triage|activity|billing)(\/|$|\?)/,
      );
    }
  });

  it('reuses the unsubscribe dialog and toasts without a network call or the old copy', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const openSpy = vi.spyOn(XMLHttpRequest.prototype, 'open');
    render(<SendersSimulator />);

    const inspector = screen.getByRole('complementary', { name: 'Sender details' });
    fireEvent.click(within(inspector).getByRole('button', { name: 'Unsubscribe' }));
    const dialog = preview();
    expect(within(dialog).getAllByText('Unsubscribe only')).toHaveLength(1);
    expect(dialog).toHaveTextContent('Unsubscribe from Northstar Weekly and archive 111 emails?');
    expect(dialog).toHaveTextContent(
      fillCopy(WS5_COPY['f1.preview.future'], { Sender: 'Northstar Weekly' }),
    );
    expect(dialog).toHaveTextContent(
      pluralCopy(WS5_COPY['f1.preview.backlog.archive'], 111, { n: 111 }),
    );
    expect(dialog).toHaveTextContent(WS5_COPY['f1.honesty.archive']);
    expect(dialog).toHaveTextContent(WS5_COPY['f1.meterFree']);
    expect(dialog).toHaveTextContent(WS5_COPY['f1.footer']);
    expect(dialog).not.toHaveTextContent('This requests that future email stop');
    expect(dialog).not.toHaveTextContent('Undo can restore supported mail movement');
    expect(dialog).not.toHaveTextContent(/Gmail draft/i);
    expect(dialog).not.toHaveTextContent(/Unsubscribe and archive \d+ emails from /);

    fireEvent.click(
      within(dialog).getByRole('radio', { name: /Unsubscribe and delete 111 emails/ }),
    );
    expect(dialog).toHaveTextContent(WS5_COPY['f1.deleteNote']);
    expect(dialog).toHaveTextContent(
      pluralCopy(WS5_COPY['f1.preview.backlog.delete'], 111, { n: 111 }),
    );
    fireEvent.click(
      within(dialog).getByRole('radio', { name: /Unsubscribe and archive 111 emails/ }),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Unsubscribe + Archive' }));
    expect(
      screen
        .getAllByRole('status')
        .some((node) => node.textContent?.includes('Unsubscribe requested · Archived 111 emails')),
    ).toBe(true);
    const activity = screen.getByRole('region', { name: 'Sample activity' });
    expect(activity).toHaveTextContent(fillCopy(WS5_COPY['f1.activity.row'], { n: 111 }));
    expect(activity).toHaveTextContent('undone from Activity for 30 days');
    expect(within(activity).getByRole('button', { name: 'Undo' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Market Finds/ }));
    fireEvent.click(
      within(screen.getByRole('complementary', { name: 'Sender details' })).getByRole('button', {
        name: 'Unsubscribe',
      }),
    );
    fireEvent.click(
      within(preview()).getByRole('radio', { name: /Unsubscribe and delete 191 emails/ }),
    );
    fireEvent.click(within(preview()).getByRole('button', { name: 'Unsubscribe + Delete' }));
    expect(
      screen
        .getAllByRole('status')
        .some((node) => node.textContent?.includes('Unsubscribe requested · Deleted 191 emails')),
    ).toBe(true);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    openSpy.mockRestore();
  });
});
