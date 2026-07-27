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

  // A reopened modal can receive CACHED preview data while the fresh
  // refetch is still in flight (staleTime: 0 + default gcTime). Cached
  // counts must not arm confirm — only a settled fetch may (D226).
  it.each(['Archive', 'Later', 'Delete'] as const)(
    'keeps %s locked while a cached preview refetches, then unlocks on the fresh result',
    (verb) => {
      const onConfirm = vi.fn();
      const { rerender } = render(
        <ConfirmActionModal
          request={request(verb)}
          onCancel={() => {}}
          onConfirm={onConfirm}
          compositePreview={livePreview}
          compositePreviewLoading={true}
        />,
      );

      const confirm = screen.getByRole('button', { name: new RegExp(verb) });
      expect(confirm).toBeDisabled();
      fireEvent.click(confirm);
      fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
      expect(onConfirm).not.toHaveBeenCalled();
      expect(screen.getByText(/confirm stays locked/i)).toBeInTheDocument();

      rerender(
        <ConfirmActionModal
          request={request(verb)}
          onCancel={() => {}}
          onConfirm={onConfirm}
          compositePreview={livePreview}
          compositePreviewLoading={false}
        />,
      );

      const readyConfirm = screen.getByRole('button', { name: new RegExp(verb) });
      expect(readyConfirm).toBeEnabled();
      fireEvent.click(readyConfirm);
      fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
      expect(onConfirm).toHaveBeenCalledTimes(2);
    },
  );

  it('keeps a bulk verb locked while a cached bulk preview refetches', () => {
    const onConfirm = vi.fn();
    const second = makeSender({ id: 'sender-2', displayName: 'Beta Digest', email: 'b@beta.com' });
    const bulkRequest: ActionRequest = { verb: 'Archive', senders: [sender, second] };
    const bulkData = {
      senders: [
        { senderId: sender.id, name: sender.name, counts: buckets, protected: false },
        { senderId: second.id, name: second.name, counts: buckets, protected: false },
      ],
      totals: buckets,
      protectedCount: 0,
    };
    const { rerender } = render(
      <ConfirmActionModal
        request={bulkRequest}
        onCancel={() => {}}
        onConfirm={onConfirm}
        bulkPreview={{ data: bulkData, loading: true, error: false }}
      />,
    );

    const confirm = screen.getByRole('button', { name: /Archive/ });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
    expect(onConfirm).not.toHaveBeenCalled();

    rerender(
      <ConfirmActionModal
        request={bulkRequest}
        onCancel={() => {}}
        onConfirm={onConfirm}
        bulkPreview={{ data: bulkData, loading: false, error: false }}
      />,
    );
    expect(screen.getByRole('button', { name: /Archive/ })).toBeEnabled();
  });

  it('fails closed when a refetch errors while stale counts are still on screen', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmActionModal
        request={request('Archive')}
        onCancel={() => {}}
        onConfirm={onConfirm}
        compositePreview={livePreview}
        compositePreviewError={true}
      />,
    );

    const confirm = screen.getByRole('button', { name: /Archive/ });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getAllByText(/close and retry/i).length).toBeGreaterThan(0);
  });

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

describe('ConfirmActionModal — Protected sender acknowledgement (D245/D42)', () => {
  const protectedSender = makeSender({
    protectionFlags: {
      isProtected: true,
      protectionReason: 'user_defined',
      protectionSetAt: '2026-06-01T00:00:00.000Z',
    },
  });

  it('names the protection and carries override:true on confirm', () => {
    // The server has always answered a protected single-sender action
    // with 409 PROTECTED_SENDER whose copy reads "Confirm to archive
    // anyway", and accepts `override` to proceed. Nothing in production
    // ever set it — the client greyed the button out first, so the 409
    // was unreachable. This is the "anyway" the server was built for.
    const onConfirm = vi.fn();
    render(
      <ConfirmActionModal
        request={{ verb: 'Delete', senders: [protectedSender] }}
        onCancel={() => {}}
        onConfirm={onConfirm}
        compositePreview={{ ...livePreview, protected: true }}
      />,
    );

    expect(screen.getByText(/this sender is/i)).toHaveTextContent(/Protected/);
    const confirm = screen.getByRole('button', { name: /Delete anyway/i });
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ override: true }));
  });

  it('does NOT set override for an unprotected sender', () => {
    // Two-sided: a flag only ever observed set is not a verified flag.
    const onConfirm = vi.fn();
    render(
      <ConfirmActionModal
        request={{ verb: 'Delete', senders: [makeSender()] }}
        onCancel={() => {}}
        onConfirm={onConfirm}
        compositePreview={livePreview}
      />,
    );

    expect(screen.queryByText(/this sender is/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Delete/i }));
    expect(onConfirm).toHaveBeenCalledWith(expect.not.objectContaining({ override: true }));
  });
});

describe('ConfirmActionModal — backlog secondary belongs to Unsubscribe only', () => {
  // Later already moves every current message out of the inbox and
  // schedules its return, so an "also archive/delete the past" chip
  // asked the user to pick two mutually-exclusive fates for the same
  // mail. Unsubscribe is the one primary that leaves existing mail
  // where it is, so the backlog question is real there and only there.
  it('offers the backlog row for Unsubscribe', () => {
    render(
      <ConfirmActionModal
        request={request('Unsubscribe')}
        onCancel={() => {}}
        onConfirm={() => {}}
        compositePreview={livePreview}
      />,
    );

    expect(
      screen.getByRole('radiogroup', { name: /also act on past emails/i }),
    ).toBeInTheDocument();
  });

  it('does NOT offer the backlog row for Later', () => {
    render(
      <ConfirmActionModal
        request={request('Later')}
        onCancel={() => {}}
        onConfirm={() => {}}
        compositePreview={livePreview}
      />,
    );

    expect(screen.queryByRole('radiogroup', { name: /also act on past emails/i })).toBeNull();
  });

  it('sends no secondary on a Later confirm', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmActionModal
        request={request('Later')}
        onCancel={() => {}}
        onConfirm={onConfirm}
        compositePreview={livePreview}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Later/i }));
    // The key must be ABSENT, not present-and-null: `objectContaining`
    // with `undefined` would still demand it exist.
    const opts = onConfirm.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.keys(opts)).not.toContain('secondary');
    expect(opts.archiveHistoric).toBe(false);
  });
});
