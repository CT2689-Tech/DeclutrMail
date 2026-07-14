import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { track } = vi.hoisted(() => ({ track: vi.fn(async () => undefined) }));
vi.mock('@/lib/posthog', () => ({ track }));

import { FinalStoryCta, ProductStoryShell } from './story-shell';

describe('ProductStoryShell CTA tracking', () => {
  beforeEach(() => track.mockClear());

  it('tracks hero and final conversion links while leaving the walkthrough anchor alone', () => {
    render(
      <ProductStoryShell eyebrow="How it works" title="Story" lede="A public product story.">
        <div id="walkthrough">Walkthrough</div>
        <FinalStoryCta title="Try it" body="Start with one Gmail inbox." />
      </ProductStoryShell>,
    );

    fireEvent.click(screen.getByRole('link', { name: 'See the walkthrough' }));
    expect(track).not.toHaveBeenCalled();

    const connectLinks = screen.getAllByRole('link', { name: 'Connect your Gmail' });
    fireEvent.click(connectLinks[0]!);
    fireEvent.click(connectLinks[1]!);
    fireEvent.click(screen.getByRole('link', { name: 'Compare plans' }));

    expect(track).toHaveBeenNthCalledWith(1, 'landing_cta_clicked', {
      cta: 'connect_gmail',
      placement: 'hero',
    });
    expect(track).toHaveBeenNthCalledWith(2, 'landing_cta_clicked', {
      cta: 'connect_gmail',
      placement: 'final',
    });
    expect(track).toHaveBeenNthCalledWith(3, 'landing_cta_clicked', {
      cta: 'see_pricing',
      placement: 'final',
    });
  });
});
