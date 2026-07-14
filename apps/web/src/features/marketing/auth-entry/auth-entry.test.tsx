import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { track } = vi.hoisted(() => ({ track: vi.fn(async () => undefined) }));
vi.mock('@/lib/posthog', () => ({ track }));

import { AuthEntry } from './auth-entry';

describe('AuthEntry CTA tracking', () => {
  beforeEach(() => track.mockClear());

  it('tracks the OAuth conversion and synthetic-demo alternative', () => {
    render(<AuthEntry />);

    fireEvent.click(screen.getByRole('link', { name: /Continue with Google/i }));
    fireEvent.click(screen.getByRole('link', { name: /Try the demo/i }));

    expect(track).toHaveBeenNthCalledWith(1, 'landing_cta_clicked', {
      cta: 'connect_gmail',
      placement: 'hero',
    });
    expect(track).toHaveBeenNthCalledWith(2, 'landing_cta_clicked', {
      cta: 'try_demo',
      placement: 'final',
    });
  });

  it('tracks the inbox-limit recovery pricing link', () => {
    render(<AuthEntry authResult="inbox_limit" />);

    fireEvent.click(screen.getByRole('link', { name: /Compare plans/i }));

    expect(track).toHaveBeenCalledWith('landing_cta_clicked', {
      cta: 'see_pricing',
      placement: 'hero',
    });
  });
});
