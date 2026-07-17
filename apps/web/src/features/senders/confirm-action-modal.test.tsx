import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CompositeActionPreviewResult } from '@/lib/api/use-action';
import { ConfirmActionModal } from './confirm-action-modal';
import type { ActionRequest } from './data';
import { makeSender } from './testing/make-sender';

const sender = makeSender();
const buckets = {
  all: 4,
  olderThan30d: 3,
  olderThan90d: 2,
  olderThan180d: 1,
  olderThan365d: 0,
};
const subjects = {
  all: ['Latest message'],
  olderThan30d: ['Older message'],
  olderThan90d: [],
  olderThan180d: [],
  olderThan365d: [],
};
const livePreview: CompositeActionPreviewResult = {
  sender: {
    id: sender.id,
    name: sender.name,
    domain: sender.domain,
    lastSeenDays: sender.lastDays,
    repliedCount: sender.repliedCount,
    monthly: sender.monthlyVolume ?? 0,
  },
  counts: buckets,
  recentSubjects: subjects,
  unsubAvailable: true,
  protected: false,
};

function request(verb: ActionRequest['verb']): ActionRequest {
  return { verb, senders: [sender] };
}

describe('ConfirmActionModal — live-preview confirm gate', () => {
  it.each(['Archive', 'Later', 'Delete'] as const)(
    'blocks %s click and keyboard confirmation until a live preview resolves',
    (verb) => {
      const onConfirm = vi.fn();
      const { rerender } = render(
        <ConfirmActionModal request={request(verb)} onCancel={() => {}} onConfirm={onConfirm} />,
      );

      const confirm = screen.getByRole('button', { name: new RegExp(verb) });
      expect(confirm).toBeDisabled();
      fireEvent.click(confirm);
      fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
      expect(onConfirm).not.toHaveBeenCalled();

      rerender(
        <ConfirmActionModal
          request={request(verb)}
          onCancel={() => {}}
          onConfirm={onConfirm}
          compositePreview={livePreview}
        />,
      );

      const readyConfirm = screen.getByRole('button', { name: new RegExp(verb) });
      expect(readyConfirm).toBeEnabled();
      fireEvent.click(readyConfirm);
      fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
      expect(onConfirm).toHaveBeenCalledTimes(2);
    },
  );

  it('fails closed with retry copy when the required preview is unavailable', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmActionModal
        request={request('Archive')}
        onCancel={() => {}}
        onConfirm={onConfirm}
        archivePreview={{ inboxCount: undefined, loading: false, error: true }}
        compositePreviewError={true}
      />,
    );

    expect(screen.getByRole('button', { name: /Archive/ })).toBeDisabled();
    expect(screen.getAllByText(/close and retry/i)).toHaveLength(2);
    expect(screen.queryByText(/archive whatever/i)).not.toBeInTheDocument();
  });

  it('allows a pure unsubscribe but blocks click and keyboard after a backlog action is selected', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmActionModal
        request={request('Unsubscribe')}
        onCancel={() => {}}
        onConfirm={onConfirm}
        compositePreviewError={true}
      />,
    );

    const confirm = screen.getByRole('button', { name: /Unsubscribe/ });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('radio', { name: 'Archive them' }));
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('presents counts and subject samples as a current snapshot, not an exact future set', () => {
    render(
      <ConfirmActionModal
        request={request('Archive')}
        onCancel={() => {}}
        onConfirm={() => {}}
        compositePreview={livePreview}
        mailboxEmail="active@gmail.com"
      />,
    );

    expect(screen.getByText(/emails currently match.*Archive/i)).toBeInTheDocument();
    expect(screen.getByText(/Gmail is checked again when this runs/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Show what currently matches \(1 of 4\)/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/will move to Archive/i)).not.toBeInTheDocument();
    expect(screen.getByRole('note', { name: 'Gmail account: active@gmail.com' })).toBeVisible();
  });

  it('discloses that an unsubscribe backlog move consumes a second Free action', () => {
    render(
      <ConfirmActionModal
        request={request('Unsubscribe')}
        onCancel={() => {}}
        onConfirm={() => {}}
        compositePreview={livePreview}
      />,
    );

    expect(screen.getByText(/second cleanup action/i)).toBeInTheDocument();
  });
});
