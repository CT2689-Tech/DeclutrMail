import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SendersSimulator } from './senders-simulator';

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
    fireEvent.click(within(preview()).getByRole('radio', { name: 'Archive them' }));
    expect(preview()).toHaveTextContent('0 emails currently match');
    const confirm = within(preview()).getByRole('button', { name: 'Unsubscribe + Archive' });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(screen.getByRole('complementary', { name: 'Sender details' })).toHaveTextContent(
      'Unsubscribe requested',
    );
    expect(screen.getByRole('region', { name: 'Sample activity' })).toHaveTextContent(
      'No sample email matched the selected past-email scope',
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
    expect(within(activity).getAllByRole('button', { name: 'Undo mail movement' })).toHaveLength(1);
  });
});
