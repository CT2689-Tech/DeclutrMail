import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  fillCopy,
  pluralCopy,
  WS2_COPY,
  WS3_COPY,
  WS5_COPY,
} from '@declutrmail/shared/copy/launch';

import { SendersSimulator } from './senders-simulator';

afterEach(() => {
  vi.unstubAllEnvs();
});

function preview(): HTMLElement {
  return screen.getByRole('dialog');
}

describe('SendersSimulator', () => {
  it.each(['Archive', 'Delete'] as const)(
    'moves only the selected aged email for Unsubscribe + %s and preserves sample Undo',
    (mode) => {
      render(<SendersSimulator />);
      fireEvent.click(screen.getByRole('button', { name: 'Unsubscribe' }));
      if (mode === 'Delete') {
        fireEvent.click(within(preview()).getByRole('radio', { name: 'Unsubscribe and delete' }));
        fireEvent.change(within(preview()).getByRole('combobox', { name: 'How far back' }), {
          target: { value: 'all' },
        });
        fireEvent.click(
          within(preview()).getByRole('checkbox', { name: 'Include archived email' }),
        );
      }
      fireEvent.change(within(preview()).getByRole('combobox', { name: 'How far back' }), {
        target: { value: '180' },
      });
      const moved = mode === 'Delete' ? 155 : 45;
      expect(
        within(preview()).getByRole('region', {
          name: mode === 'Delete' ? 'Delete impact' : 'Archive impact',
        }),
      ).toHaveTextContent(`${moved} emails`);
      fireEvent.click(
        within(preview()).getByRole('button', {
          name: mode === 'Delete' ? 'Unsubscribe + Delete' : 'Unsubscribe + Archive',
        }),
      );
      const activity = screen.getByRole('region', { name: 'Sample activity' });
      expect(activity).toHaveTextContent(
        `${mode === 'Delete' ? 'Deleted' : 'Archived'} ${moved} emails`,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Unsubscribe' }));
      expect(
        within(preview()).getByRole('radio', { name: 'Unsubscribe and archive' }),
      ).toBeInTheDocument();
      fireEvent.click(within(preview()).getByRole('button', { name: 'Cancel' }));
      fireEvent.click(within(activity).getByRole('button', { name: 'Undo' }));
      fireEvent.click(screen.getByRole('button', { name: 'Unsubscribe' }));
      expect(
        within(preview()).getByRole('radio', { name: 'Unsubscribe and archive' }),
      ).toBeInTheDocument();
    },
  );

  it('uses archived scope for Unsubscribe + Delete and restores that mail with sample Undo', () => {
    render(<SendersSimulator />);
    fireEvent.click(screen.getByRole('button', { name: 'Unsubscribe' }));
    fireEvent.click(within(preview()).getByRole('radio', { name: 'Unsubscribe and delete' }));
    fireEvent.change(within(preview()).getByRole('combobox', { name: 'How far back' }), {
      target: { value: 'all' },
    });
    fireEvent.click(within(preview()).getByRole('checkbox', { name: 'Include archived email' }));
    expect(within(preview()).getByRole('region', { name: 'Delete impact' })).toHaveTextContent(
      '273 emails',
    );
    fireEvent.click(
      within(preview()).getByRole('button', {
        name: /^Unsubscribe \+ Delete(?: [\d,]+ emails?)?$/,
      }),
    );
    const activity = screen.getByRole('region', { name: 'Sample activity' });
    expect(activity).toHaveTextContent('Deleted 273 emails');
    fireEvent.click(within(activity).getByRole('button', { name: 'Undo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Unsubscribe' }));
    fireEvent.click(within(preview()).getByRole('radio', { name: 'Unsubscribe and delete' }));
    fireEvent.change(within(preview()).getByRole('combobox', { name: 'How far back' }), {
      target: { value: 'all' },
    });
    const includeArchived = within(preview()).getByRole('checkbox', {
      name: 'Include archived email',
    });
    expect(includeArchived).not.toBeChecked();
    fireEvent.click(includeArchived);
    expect(within(preview()).getByRole('region', { name: 'Delete impact' })).toHaveTextContent(
      '273 emails',
    );
  });

  it('opens Delete on Cancel and restores trigger focus on Escape', () => {
    render(<SendersSimulator />);
    const trigger = screen.getByRole('button', { name: 'Delete' });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('requires explicit acknowledgement for a Protected sender', () => {
    render(<SendersSimulator />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter' }), {
      target: { value: 'protected' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(within(preview()).getByRole('button', { name: 'Delete anyway' })).toBeEnabled();
    expect(preview()).toHaveTextContent('This sender is Protected.');
  });

  it('explains a blocked Later confirmation when the return time is empty or past', () => {
    render(<SendersSimulator />);
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    const dialog = preview();
    const returnTime = within(dialog).getByLabelText('When to return to your inbox');
    fireEvent.change(returnTime, { target: { value: '' } });
    expect(within(dialog).getByRole('button', { name: /^Later \d+/ })).toBeDisabled();
    expect(within(dialog).getByRole('status')).toHaveTextContent('Choose a future return time.');
    fireEvent.change(returnTime, { target: { value: '2000-01-01T12:00' } });
    expect(within(dialog).getByRole('button', { name: /^Later \d+/ })).toBeDisabled();
    expect(within(dialog).getByRole('status')).toHaveTextContent('Choose a future return time.');
  });

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

  it('changes Delete counts with age and the archived-email checkbox before confirmation', () => {
    render(<SendersSimulator />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = preview();
    const includeArchived = within(dialog).getByRole('checkbox', {
      name: WS2_COPY.simplify.confirm.includeArchived,
    });
    expect(includeArchived).not.toBeChecked();
    expect(includeArchived).toHaveStyle({ minHeight: '48px' });
    expect(within(dialog).getByRole('heading')).toHaveTextContent('45 emails'); // Default 6-month window.
    fireEvent.click(within(dialog).getByText('Details'));
    const includes = () =>
      within(dialog)
        .getAllByRole('definition')
        .map((value) => value.textContent);
    expect(includes()).toContain(
      `${WS3_COPY['ws3.demo.details.includes.inbox']} · older than 180 days`,
    );
    fireEvent.click(includeArchived);
    expect(includeArchived).toBeChecked();
    expect(within(dialog).getByRole('heading')).toHaveTextContent('155 emails');
    expect(
      within(dialog)
        .getAllByRole('term')
        .map((term) => term.textContent),
    ).toEqual(
      expect.arrayContaining([
        WS3_COPY['ws3.demo.details.includes.label'],
        WS3_COPY['ws3.demo.details.deleted.label'],
      ]),
    );
    expect(includes()).toEqual(
      expect.arrayContaining([
        `${WS3_COPY['ws3.demo.details.includes.all']} · older than 180 days`,
        WS3_COPY['ws3.demo.details.deleted.value'],
      ]),
    );
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'How far back to act on' }), {
      target: { value: '365' },
    });
    expect(within(dialog).getByRole('heading')).toHaveTextContent('76 emails');
    expect(includes()).toContain(
      `${WS3_COPY['ws3.demo.details.includes.all']} · older than 365 days`,
    );
    expect(within(dialog).queryByText('Your Sunday reading list')).not.toBeInTheDocument();
  });

  it('allows future Unsubscribe even when the selected past-email scope is empty', () => {
    render(<SendersSimulator />);
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    fireEvent.click(within(preview()).getByRole('button', { name: 'Archive 111' }));
    fireEvent.click(screen.getByRole('button', { name: 'Unsubscribe' }));
    expect(
      within(preview()).getByRole('radio', { name: 'Unsubscribe and archive' }),
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
    expect(preview()).toHaveTextContent('1 Protected sender will be left unchanged.');
    fireEvent.click(within(preview()).getByRole('button', { name: /^Archive \d+/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(
      within(preview()).getByRole('checkbox', {
        name: WS2_COPY.simplify.confirm.includeArchived,
      }),
    );
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
    expect(within(dialog).getByRole('heading')).toHaveTextContent('Unsubscribe from this sender?');
    expect(within(dialog).getByRole('region', { name: 'Archive impact' })).toHaveTextContent(
      '111 emails',
    );
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

    fireEvent.click(within(dialog).getByRole('radio', { name: 'Unsubscribe and delete' }));
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'How far back' }), {
      target: { value: 'all' },
    });
    expect(dialog).toHaveTextContent(WS5_COPY['f1.deleteNote']);
    expect(dialog).toHaveTextContent(
      pluralCopy(WS5_COPY['f1.preview.backlog.delete'], 111, { n: 111 }),
    );
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Unsubscribe and archive' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Unsubscribe + Archive' }));
    expect(
      screen
        .getAllByRole('status')
        .some((node) => node.textContent?.includes('Unsubscribe requested · Archived 111 emails')),
    ).toBe(true);
    const activity = screen.getByRole('region', { name: 'Sample activity' });
    expect(activity).toHaveTextContent(pluralCopy(WS5_COPY['f1.activity.row'], 111, { n: 111 }));
    expect(activity).toHaveTextContent('undone from Activity for 30 days');
    expect(within(activity).getByRole('button', { name: 'Undo' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Market Finds/ }));
    fireEvent.click(
      within(screen.getByRole('complementary', { name: 'Sender details' })).getByRole('button', {
        name: 'Unsubscribe',
      }),
    );
    fireEvent.click(within(preview()).getByRole('radio', { name: 'Unsubscribe and delete' }));
    fireEvent.change(within(preview()).getByRole('combobox', { name: 'How far back' }), {
      target: { value: 'all' },
    });
    fireEvent.click(
      within(preview()).getByRole('button', {
        name: /^Unsubscribe \+ Delete(?: [\d,]+ emails?)?$/,
      }),
    );
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
