import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { GuidedReviewFrame } from './guided-review-frame';

const senders = [
  { id: 'one', name: 'First sender', domain: 'one.invalid', brandMark: false },
  { id: 'two', name: 'Second sender', domain: 'two.invalid', brandMark: false },
];
describe('Guided review navigation', () => {
  it('makes Previous and Next visible, and changes only the local position', () => {
    const navigate = vi.fn();
    render(
      <GuidedReviewFrame
        senders={senders}
        index={0}
        label="Selected senders"
        onNavigate={navigate}
        onExit={() => {}}
      >
        <p>Sender content</p>
      </GuidedReviewFrame>,
    );
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('1 of 2');
    fireEvent.click(screen.getByRole('button', { name: 'Next sender' }));
    expect(navigate).toHaveBeenCalledWith(1);
    fireEvent.click(
      within(screen.getByRole('navigation', { name: 'Senders in this review' })).getByRole(
        'button',
        { name: 'Second sender' },
      ),
    );
    expect(navigate).toHaveBeenCalledTimes(2);
  });
  it('keeps the preview subject fixed while confirmation owns it', () => {
    const navigate = vi.fn();
    const exit = vi.fn();
    render(
      <GuidedReviewFrame
        senders={senders}
        index={1}
        label="Suggested senders"
        onNavigate={navigate}
        onExit={exit}
        navigationDisabled
      >
        <p>Preview</p>
      </GuidedReviewFrame>,
    );
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to Senders' }));
    expect(navigate).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });
  it('finishes the last sender by leaving review, without recording a decision', () => {
    const navigate = vi.fn();
    const exit = vi.fn();
    render(
      <GuidedReviewFrame
        senders={senders}
        index={1}
        label="Selected senders"
        onNavigate={navigate}
        onExit={exit}
      >
        <p>Sender content</p>
      </GuidedReviewFrame>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Finish review' }));
    expect(exit).toHaveBeenCalledOnce();
    expect(navigate).not.toHaveBeenCalled();
  });
});
