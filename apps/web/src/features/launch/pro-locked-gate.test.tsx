import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WS2_COPY } from '@declutrmail/shared/copy/launch';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useTier = vi.fn();
const apiPost = vi.fn();
const track = vi.fn();

vi.mock('@/features/auth/api/use-tier', () => ({
  useTier: () => useTier(),
}));
vi.mock('@/lib/api/client', () => ({
  apiPost: (...args: unknown[]) => apiPost(...args),
}));
vi.mock('@/lib/posthog', () => ({
  track: (...args: unknown[]) => track(...args),
}));

import { ProLockedGate } from './pro-locked-gate';

const JOINED_KEY = 'dm.pro-waitlist.joined';
const cta = WS2_COPY.pro.cta.replaceAll('{proName}', 'Pro');
const joinedCopy = WS2_COPY.pro.joined.replaceAll('{proName}', 'Pro');
const unavailable = WS2_COPY.pro.status.replaceAll('{proName}', 'Pro');

function gate(source: 'brief' | 'followups' = 'brief') {
  return (
    <ProLockedGate capability={source} source={source} title="Feature" pitch="One sentence.">
      <p>feature body</p>
    </ProLockedGate>
  );
}

beforeEach(() => {
  useTier.mockReset();
  apiPost.mockReset();
  track.mockReset();
  localStorage.clear();
});

describe('ProLockedGate', () => {
  it('keeps the feature unmounted and shows no price or checkout link', () => {
    useTier.mockReturnValue({ tier: 'free' });
    const { container } = render(gate());
    expect(screen.queryByText('feature body')).toBeNull();
    expect(screen.getByRole('button', { name: cta })).toBeInTheDocument();
    expect(screen.getByText(unavailable)).toBeInTheDocument();
    expect(container.innerHTML).not.toContain('/pricing');
    expect(container.textContent).not.toMatch(/[$₹€£]/);
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('posts once and shows the same joined message for a new or existing signup', async () => {
    useTier.mockReturnValue({ tier: 'plus' });
    apiPost.mockResolvedValue({ data: { status: 'already_joined' } });
    render(gate('followups'));
    fireEvent.click(screen.getByRole('button', { name: cta }));
    await waitFor(() => expect(screen.getByText(joinedCopy)).toBeInTheDocument());
    expect(screen.getByText(WS2_COPY.pro.joinedSub)).toBeInTheDocument();
    expect(apiPost).toHaveBeenCalledTimes(1);
    expect(apiPost).toHaveBeenCalledWith('/api/v1/waitlist', {
      kind: 'pro',
      source: 'followups',
    });
    expect(track).toHaveBeenCalledWith('waitlist_joined', {
      tier_interest: 'pro',
      source: 'followups',
    });
    expect(localStorage.getItem(JOINED_KEY)).toBe('1');
    expect(screen.queryByRole('button', { name: cta })).toBeNull();
  });

  it('reads a stored join without posting again', async () => {
    localStorage.setItem(JOINED_KEY, '1');
    useTier.mockReturnValue({ tier: 'free' });
    render(gate());
    await waitFor(() => expect(screen.getByText(joinedCopy)).toBeInTheDocument());
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('leaves the feature available when the tier includes it', () => {
    useTier.mockReturnValue({ tier: 'pro' });
    render(gate());
    expect(screen.getByText('feature body')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: cta })).toBeNull();
  });

  it('shows the error and does not record a join when the request fails', async () => {
    useTier.mockReturnValue({ tier: 'free' });
    apiPost.mockRejectedValue(new Error('offline'));
    render(gate());
    fireEvent.click(screen.getByRole('button', { name: cta }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(WS2_COPY.pro.error));
    expect(localStorage.getItem(JOINED_KEY)).toBeNull();
    expect(track).not.toHaveBeenCalled();
  });
});
