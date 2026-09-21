import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { BannerSlot } from './banner-slot';

function Banner({ name, on }: { name: string; on: boolean }) {
  return on ? <div role="alert">{name}</div> : null;
}

// Scoped to the banner itself: a collapsed banner's words also appear in
// the slot's live region.
const banner = (name: string) => screen.getByText(name, { selector: '[role="alert"]' });
const item = (name: string) => banner(name).closest('.dm-banner-item');

describe('BannerSlot', () => {
  it('renders nothing extra when no banner is active', () => {
    render(
      <BannerSlot>
        <Banner name="deletion" on={false} />
        <Banner name="sync" on={false} />
      </BannerSlot>,
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows a lone banner with no "more" control', () => {
    render(
      <BannerSlot>
        <Banner name="deletion" on={false} />
        <Banner name="sync" on />
      </BannerSlot>,
    );
    expect(item('sync')).not.toHaveAttribute('hidden');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows only the highest-priority banner and expands the rest on demand', async () => {
    render(
      <BannerSlot>
        <Banner name="deletion" on={false} />
        <Banner name="sync" on />
        <Banner name="reconnect" on />
        <Banner name="later" on />
      </BannerSlot>,
    );

    const more = await screen.findByRole('button', { name: '+2 more' });
    expect(item('sync')).not.toHaveAttribute('hidden');
    expect(item('reconnect')).toHaveAttribute('hidden');
    expect(item('later')).toHaveAttribute('hidden');
    // Alerts keep their role while collapsed — hidden, not re-typed.
    expect(banner('later')).toHaveAttribute('role', 'alert');

    fireEvent.click(more);
    expect(item('reconnect')).not.toHaveAttribute('hidden');
    expect(item('later')).not.toHaveAttribute('hidden');
    expect(screen.getByRole('button', { name: 'Show less' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('tracks banners that appear and clear on their own state, without a parent render', async () => {
    let setDeletion: (on: boolean) => void = () => undefined;
    function SelfDriven() {
      const [on, setOn] = useState(false);
      setDeletion = setOn;
      return <Banner name="deletion" on={on} />;
    }
    render(
      <BannerSlot>
        <SelfDriven />
        <Banner name="sync" on />
      </BannerSlot>,
    );
    expect(item('sync')).not.toHaveAttribute('hidden');

    // A higher-priority banner arrives: it takes the slot, sync steps back.
    act(() => setDeletion(true));
    await screen.findByRole('button', { name: '+1 more' });
    expect(item('deletion')).not.toHaveAttribute('hidden');
    expect(item('sync')).toHaveAttribute('hidden');

    act(() => setDeletion(false));
    await waitFor(() => expect(screen.queryByRole('button')).not.toBeInTheDocument());
    expect(item('sync')).not.toHaveAttribute('hidden');
  });
  // `hidden` removes a banner from the accessibility tree, so its own
  // role="alert" is never spoken while collapsed.
  it('mirrors collapsed banners into one polite live region, never the visible one', async () => {
    render(
      <BannerSlot>
        <Banner name="deletion" on />
        <div role="alert">
          Gmail needs reconnecting <button type="button">Reconnect</button>
        </div>
        <Banner name="later" on />
      </BannerSlot>,
    );

    const live = screen.getByTestId('banner-slot-live');
    expect(live).toHaveAttribute('aria-live', 'polite');
    await waitFor(() => expect(live).toHaveTextContent('Gmail needs reconnecting. later'));
    // The visible banner announces itself; controls are not read out.
    expect(live).not.toHaveTextContent('deletion');
    expect(live).not.toHaveTextContent('Reconnect');
    expect(document.querySelectorAll('[aria-live]')).toHaveLength(1);

    // Expanded, the banners are exposed themselves — no second announcement.
    fireEvent.click(screen.getByRole('button', { name: '+2 more' }));
    expect(live).toBeEmptyDOMElement();
  });

  it('keeps the live region empty when nothing is collapsed', async () => {
    render(
      <BannerSlot>
        <Banner name="deletion" on={false} />
        <Banner name="sync" on />
      </BannerSlot>,
    );
    expect(item('sync')).not.toHaveAttribute('hidden');
    expect(screen.getByTestId('banner-slot-live')).toBeEmptyDOMElement();
  });
});
