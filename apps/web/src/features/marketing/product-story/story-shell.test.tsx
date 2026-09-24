import { fireEvent, render, screen } from '@testing-library/react';
import { OAUTH_SCOPE_DISCLOSURE } from '@declutrmail/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { track } = vi.hoisted(() => ({ track: vi.fn(async () => undefined) }));
vi.mock('@/lib/posthog', () => ({ track }));

import { FinalStoryCta, ProductStoryShell } from './story-shell';

describe('ProductStoryShell CTA tracking', () => {
  beforeEach(() => track.mockClear());

  it('tracks hero, demo, and final conversion links', () => {
    render(
      <ProductStoryShell title="Story" lede="A public product story." visual={<div />}>
        <FinalStoryCta title="Try it" body="Start with one Gmail inbox." />
      </ProductStoryShell>,
    );

    const connectLinks = screen.getAllByRole('link', { name: 'Start free' });
    fireEvent.click(connectLinks[0]!);
    fireEvent.click(screen.getByRole('link', { name: 'Try the demo' }));
    fireEvent.click(connectLinks[1]!);
    fireEvent.click(screen.getByRole('link', { name: 'Compare plans' }));

    expect(track).toHaveBeenNthCalledWith(1, 'landing_cta_clicked', {
      cta: 'connect_gmail',
      placement: 'hero',
    });
    expect(track).toHaveBeenNthCalledWith(2, 'landing_cta_clicked', {
      cta: 'try_demo',
      placement: 'hero',
    });
    expect(track).toHaveBeenNthCalledWith(3, 'landing_cta_clicked', {
      cta: 'connect_gmail',
      placement: 'final',
    });
    expect(track).toHaveBeenNthCalledWith(4, 'landing_cta_clicked', {
      cta: 'see_pricing',
      placement: 'final',
    });
  });

  it('keeps the Google permission disclosure beside both OAuth CTAs', () => {
    render(
      <ProductStoryShell title="Story" lede="A public product story." visual={<div />}>
        <FinalStoryCta title="Try it" body="Start with one Gmail inbox." />
      </ProductStoryShell>,
    );
    expect(screen.getAllByText(OAUTH_SCOPE_DISCLOSURE)).toHaveLength(2);
  });
});
