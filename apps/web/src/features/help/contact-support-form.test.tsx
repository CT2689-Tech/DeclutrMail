import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ContactSupportForm } from './contact-support-form';

const h = vi.hoisted(() => ({ post: vi.fn(), track: vi.fn() }));

vi.mock('@/lib/api/support-request', () => ({ postSupportRequest: h.post }));
vi.mock('@/lib/posthog', () => ({ track: h.track }));

beforeEach(() => {
  h.post.mockReset();
  h.track.mockReset();
});

function fillForm(subject: string, message: string) {
  fireEvent.change(screen.getByLabelText('Subject'), { target: { value: subject } });
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: message } });
}

describe('ContactSupportForm', () => {
  it('enforces the shared length bounds natively', () => {
    render(<ContactSupportForm />);
    expect(screen.getByLabelText('Subject')).toHaveAttribute('maxlength', '150');
    const messageField = screen.getByLabelText('Message');
    expect(messageField).toHaveAttribute('minlength', '10');
    expect(messageField).toHaveAttribute('maxlength', '5000');
  });

  it('submits a valid message and shows confirmation', async () => {
    h.post.mockResolvedValue({ data: { submittedAt: '2026-09-01T00:00:00.000Z' } });
    render(<ContactSupportForm />);
    fillForm('Cannot connect Gmail', 'I keep hitting an error at step 2.');
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() =>
      expect(h.post).toHaveBeenCalledWith({
        subject: 'Cannot connect Gmail',
        message: 'I keep hitting an error at step 2.',
      }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(/message sent/i);
    expect(h.track).toHaveBeenCalledWith('support_request_submitted', {});
  });

  it('keeps the typed text and shows a fallback on a failed submit', async () => {
    h.post.mockRejectedValue(new Error('offline'));
    render(<ContactSupportForm />);
    fillForm('Cannot connect Gmail', 'I keep hitting an error at step 2.');
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn.t send/i);
    expect(screen.getByLabelText('Subject')).toHaveValue('Cannot connect Gmail');
    expect(screen.getByLabelText('Message')).toHaveValue('I keep hitting an error at step 2.');
    expect(h.track).not.toHaveBeenCalled();
  });
});
