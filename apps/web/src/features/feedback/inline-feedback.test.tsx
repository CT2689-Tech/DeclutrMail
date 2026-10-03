import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InlineFeedback } from './inline-feedback';

const h = vi.hoisted(() => ({ post: vi.fn(), track: vi.fn() }));

vi.mock('@/lib/api/product-feedback', () => ({ postProductFeedback: h.post }));
vi.mock('@/lib/posthog', () => ({ track: h.track }));

function renderFeedback(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(node, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}

beforeEach(() => {
  h.post.mockReset();
  h.track.mockReset();
});

describe('InlineFeedback', () => {
  it('drops the saved rating and receipt when the observation changes', async () => {
    h.post.mockResolvedValue({ data: { rating: 'useful' } });
    const view = renderFeedback(
      <InlineFeedback surface="brief" referenceId="brief-1" initialRating={null} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Useful' }));
    await screen.findByText('Feedback saved.');

    view.rerender(<InlineFeedback surface="brief" referenceId="brief-2" initialRating={null} />);

    expect(screen.getByRole('button', { name: 'Useful' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByText('Feedback saved.')).not.toBeInTheDocument();
  });

  it('does not apply a late feedback response to the next observation', async () => {
    let resolve!: (value: unknown) => void;
    h.post.mockReturnValue(new Promise((done) => (resolve = done)));
    const view = renderFeedback(
      <InlineFeedback surface="brief" referenceId="brief-1" initialRating={null} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Useful' }));
    await waitFor(() => expect(h.post).toHaveBeenCalledOnce());
    view.rerender(<InlineFeedback surface="brief" referenceId="brief-2" initialRating={null} />);
    resolve({ data: { rating: 'useful' } });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Useful' })).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Useful' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByText('Feedback saved.')).not.toBeInTheDocument();
  });

  it('renders an accessible group and restores the persisted selection', () => {
    renderFeedback(
      <InlineFeedback surface="activity" referenceId="row-1" initialRating="expected" />,
    );
    const group = screen.getByRole('group', { name: /match what you expected/i });
    expect(within(group).getByRole('button', { name: 'Expected' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(group).getByRole('button', { name: 'Surprising' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('saves a changed rating before selection and analytics confirm', async () => {
    let resolve!: (value: unknown) => void;
    const onSaved = vi.fn();
    h.post.mockReturnValue(new Promise((done) => (resolve = done)));
    renderFeedback(
      <InlineFeedback
        surface="followups"
        referenceId="row-2"
        initialRating={null}
        onSaved={onSaved}
      />,
    );
    const useful = screen.getByRole('button', { name: 'Useful' });
    fireEvent.click(useful);

    await waitFor(() => expect(useful).toBeDisabled());
    expect(h.post).toHaveBeenCalledWith({
      surface: 'followups',
      referenceId: 'row-2',
      rating: 'useful',
    });
    expect(useful).toHaveAttribute('aria-pressed', 'false');
    resolve({
      data: {
        id: 'feedback-1',
        surface: 'followups',
        referenceId: 'row-2',
        rating: 'useful',
        createdAt: '2026-07-15T00:00:00.000Z',
        updatedAt: '2026-07-15T00:00:00.000Z',
      },
    });

    await waitFor(() => expect(useful).toHaveAttribute('aria-pressed', 'true'));
    expect(screen.getByText('Feedback saved.')).toBeInTheDocument();
    expect(h.track).toHaveBeenCalledWith('product_feedback_submitted', {
      surface: 'followups',
      rating: 'useful',
    });
    expect(onSaved).toHaveBeenCalledWith('useful');
  });

  it('keeps the prior selection and reports an unconfirmed receipt when the request fails', async () => {
    h.post.mockRejectedValue(new Error('offline'));
    renderFeedback(<InlineFeedback surface="brief" referenceId="brief-1" initialRating="useful" />);
    expect(screen.getByRole('button', { name: 'Something looks wrong' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Not useful' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "We couldn't confirm your feedback was saved. Try again.",
    );
    expect(screen.queryByText(/Nothing changed|Feedback saved\./i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Useful' })).toHaveAttribute('aria-pressed', 'true');
    expect(h.track).not.toHaveBeenCalled();
  });
});
