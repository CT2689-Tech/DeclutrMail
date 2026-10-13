import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { joinProviderWaitlist, track } = vi.hoisted(() => ({
  joinProviderWaitlist: vi.fn(),
  track: vi.fn(async () => undefined),
}));

vi.mock('@/lib/api/provider-waitlist', () => ({ joinProviderWaitlist }));
vi.mock('@/lib/posthog', () => ({ track }));

import { WS3_COPY } from '@declutrmail/shared/copy/launch';

import { NotOnGmail } from './not-on-gmail';

describe('NotOnGmail', () => {
  beforeEach(() => {
    joinProviderWaitlist.mockReset();
    track.mockClear();
  });

  it('keeps the disclosure at least 24px tall', () => {
    render(<NotOnGmail source="landing" />);
    expect(screen.getByText(WS3_COPY['ws3.notOnGmail.link']).closest('summary')).toHaveStyle({
      minHeight: '24px',
    });
  });

  it('joins once, leaves the opt-in unchecked, and emits a closed event', async () => {
    joinProviderWaitlist.mockResolvedValue({
      data: { status: 'joined', providerClass: 'microsoft' },
    });
    render(<NotOnGmail source="sign_in" />);
    fireEvent.click(screen.getByText(WS3_COPY['ws3.notOnGmail.link']));

    expect(
      screen.getByRole('checkbox', { name: WS3_COPY['ws3.notOnGmail.optIn'] }),
    ).not.toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: WS3_COPY['ws3.notOnGmail.wouldPay'] }),
    ).not.toBeChecked();

    fireEvent.change(screen.getByLabelText(WS3_COPY['ws3.notOnGmail.email.label']), {
      target: { value: 'person@outlook.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: WS3_COPY['ws3.notOnGmail.submit'] }));

    expect(await screen.findByText(WS3_COPY['ws3.notOnGmail.done'])).toBeInTheDocument();
    expect(joinProviderWaitlist).toHaveBeenCalledTimes(1);
    expect(joinProviderWaitlist).toHaveBeenCalledWith({
      email: 'person@outlook.com',
      contactOptIn: false,
      source: 'sign_in',
    });
    expect(track).toHaveBeenCalledWith('provider_waitlist_joined', {
      provider: 'unspecified',
      provider_class: 'microsoft',
      would_pay: false,
    });
    expect(JSON.stringify(track.mock.calls)).not.toContain('person@outlook.com');
    expect(
      screen.queryByRole('button', { name: WS3_COPY['ws3.notOnGmail.submit'] }),
    ).not.toBeInTheDocument();
  });
});
