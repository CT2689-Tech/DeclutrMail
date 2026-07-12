import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const { track } = vi.hoisted(() => ({ track: vi.fn(async () => undefined) }));
vi.mock('@/lib/posthog', () => ({ track }));

import { TrackedCta } from './tracked-cta';

describe('TrackedCta', () => {
  it('records the bounded funnel event without delaying navigation behavior', () => {
    const onClick = vi.fn();
    render(
      <TrackedCta href="#next" cta="connect_gmail" placement="demo" onClick={onClick}>
        Connect Gmail
      </TrackedCta>,
    );

    fireEvent.click(screen.getByRole('link', { name: 'Connect Gmail' }));

    expect(track).toHaveBeenCalledWith('landing_cta_clicked', {
      cta: 'connect_gmail',
      placement: 'demo',
    });
    expect(onClick).toHaveBeenCalledOnce();
  });
});
