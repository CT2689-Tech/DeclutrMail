import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { OVERLAY_Z } from '@declutrmail/shared';

import { ActivityFilterDialog } from './activity-filter-dialog';

const noop = () => undefined;

describe('ActivityFilterDialog stacking', () => {
  it('keeps the desktop filter dialog above the cookie banner', () => {
    render(
      <ActivityFilterDialog
        isMobile={false}
        source="all"
        verbs={[]}
        window="30d"
        dateFrom={null}
        dateTo={null}
        onClose={noop}
        onSource={noop}
        onVerbs={noop}
        onWindow={noop}
        onRange={noop}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Activity filters' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveStyle({ zIndex: String(OVERLAY_Z.modal) });
    expect(Number(dialog.style.zIndex)).toBeGreaterThan(OVERLAY_Z.cookieBanner);
  });
});
