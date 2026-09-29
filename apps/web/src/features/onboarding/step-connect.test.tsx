import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const { startMailboxConnect } = vi.hoisted(() => ({ startMailboxConnect: vi.fn() }));
vi.mock('@/features/mailboxes/connect-mailbox-url', () => ({ startMailboxConnect }));

import { StepConnect } from './step-connect';
import {
  GMAIL_CONNECTION_DATA_INVENTORY,
  GMAIL_DERIVED_DATA_INVENTORY,
  GMAIL_MESSAGE_STORAGE_LABELS,
} from '@declutrmail/shared/contracts';

describe('StepConnect privacy boundary', () => {
  it('explains access, fetched fields, stored data, and action scope in order', () => {
    const { container } = render(<StepConnect />);
    const text = container.textContent ?? '';

    expect(text.indexOf('Access')).toBeLessThan(text.indexOf('Fetched during the scan'));
    expect(text.indexOf('Fetched during the scan')).toBeLessThan(
      text.indexOf('Stored in DeclutrMail'),
    );
    expect(text.indexOf('Stored in DeclutrMail')).toBeLessThan(text.indexOf('Actions you approve'));
    for (const label of GMAIL_MESSAGE_STORAGE_LABELS) expect(text).toContain(label);
    for (const item of [...GMAIL_CONNECTION_DATA_INVENTORY, ...GMAIL_DERIVED_DATA_INVENTORY]) {
      expect(text).toContain(item.label);
    }
    expect(text).toMatch(/full bodies and attachments are not fetched/i);
    expect(text).toMatch(/connecting grants that access, but does not change any email/i);
    expect(text).toMatch(/what can be undone/i);
    // A sent unsubscribe cannot be undone — never promise an undo for every verb.
    expect(text).not.toMatch(/how to undo it/i);
    expect(text).not.toMatch(/whole list|exactly this list/i);
  });
});

describe('StepConnect start (D108)', () => {
  // Signed in with no connected mailbox: the signed-out start bounces a
  // live session straight back to this screen, so the button never reached
  // Google. Connecting a mailbox to the existing account does.
  it('connects a mailbox to the signed-in account from the reconnect variant', () => {
    render(<StepConnect variant="reconnect" />);

    fireEvent.click(screen.getByRole('button', { name: 'Continue to Google' }));

    expect(startMailboxConnect).toHaveBeenCalledWith();
  });

  it('starts the signed-out sign-in from the fresh variant', () => {
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...original, assign },
    });
    try {
      render(<StepConnect variant="fresh" />);
      fireEvent.click(screen.getByRole('button', { name: 'Continue to Google' }));
      expect(assign).toHaveBeenCalledWith(expect.stringMatching(/\/api\/auth\/google\/start$/));
      expect(startMailboxConnect).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
  });
});
