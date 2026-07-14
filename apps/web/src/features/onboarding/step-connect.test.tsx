import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

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
    expect(text).toMatch(/affected mail, future-mail behavior, and available recovery/i);
    expect(text).not.toMatch(/whole list|exactly this list/i);
  });
});
