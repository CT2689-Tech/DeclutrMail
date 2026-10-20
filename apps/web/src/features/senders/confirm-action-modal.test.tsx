import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { pluralCopy, WS1_COPY, WS5_COPY } from '@declutrmail/shared/copy/launch';
import { fillStory } from '@declutrmail/shared/entitlements';
import type { CompositeActionPreviewResult } from '@/lib/api/use-action';
import { ConfirmActionModal } from './confirm-action-modal';
import type { ActionRequest } from './data';
import { makeSender } from './testing/make-sender';

const { track, meterSummary } = vi.hoisted(() => ({
  track: vi.fn(),
  meterSummary: {
    current: undefined as
      | {
          metered: true;
          limit: number;
          used: number;
          remaining: number;
          resetAt: string;
        }
      | undefined,
  },
}));
vi.mock('@/lib/posthog', () => ({ track }));
vi.mock('@/features/billing/use-cleanup-summary', () => ({
  useCleanupSummary: () => ({ isLoading: false, data: meterSummary.current }),
}));

const sender = makeSender();

function backlogMail(mode: 'archive' | 'delete', n: number): string {
  const forms =
    mode === 'archive'
      ? WS5_COPY['f1.preview.backlog.archive']
      : WS5_COPY['f1.preview.backlog.delete'];
  return pluralCopy(forms, n, { n });
}
const buckets = {
  all: 4,
  olderThan30d: 3,
  olderThan90d: 2,
  olderThan180d: 1,
  olderThan365d: 0,
};
const subjects = {
  all: [{ subject: 'Latest message', date: '2026-06-20T09:00:00.000Z' }],
  olderThan30d: [{ subject: 'Older message', date: '2026-05-02T09:00:00.000Z' }],
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
    wroteToCount: sender.wroteToCount,
  },
  counts: buckets,
  recentMessages: subjects,
  // `null` = an API without the ADR-0028 block (deploy skew). The base
  // fixture keeps it null so every pre-reach test exercises the exact
  // pre-ADR behavior; reach tests build on `livePreviewWithAllMail`.
  allMail: null,
  unsubAvailable: true,
  protected: false,
};

/** ADR-0028 fixture — inbox counts above, plus a larger all-mail set. */
const allMailBuckets = {
  all: 977,
  olderThan30d: 900,
  olderThan90d: 800,
  olderThan180d: 700,
  olderThan365d: 600,
};
const livePreviewWithAllMail: CompositeActionPreviewResult = {
  ...livePreview,
  allMail: {
    counts: allMailBuckets,
    recentMessages: {
      all: [{ subject: 'Archived statement', date: '2026-07-05T09:00:00.000Z' }],
      olderThan30d: [{ subject: 'Older archived statement', date: '2026-04-01T09:00:00.000Z' }],
      olderThan90d: [],
      olderThan180d: [],
      olderThan365d: [],
    },
  },
};

/**
 * D248 — Unsubscribe is offered only for a sender with a channel
 * DeclutrMail can send. The default fixture's `unsubscribeMethod` is
 * `null`, which means "the index has not checked this sender yet" and is
 * deliberately NOT actionable, so the Unsubscribe cases seed a real
 * one-click channel.
 */
const oneClickSender = makeSender({ unsubscribeMethod: 'one_click' });

function request(verb: ActionRequest['verb']): ActionRequest {
  return { verb, senders: [verb === 'Unsubscribe' ? oneClickSender : sender] };
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
      expect(screen.getAllByText(/Loading preview/i)).toHaveLength(1);

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

  it('blocks Archive on a zero count from the ONE preview source (finding 5.5)', () => {
    // The zero-state gate and the headline read the same composite
    // bucket count — "0 emails currently match" can never sit above an
    // enabled confirm.
    const onConfirm = vi.fn();
    render(
      <ConfirmActionModal
        request={request('Archive')}
        onCancel={() => {}}
        onConfirm={onConfirm}
        compositePreview={{
          ...livePreview,
          counts: { all: 0, olderThan30d: 0, olderThan90d: 0, olderThan180d: 0, olderThan365d: 0 },
        }}
      />,
    );

    expect(screen.getByText(/We check again right before anything moves/)).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: /Archive/ });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  // QA-senders-20260901-09: the headline pluralised the noun ("1 email")
  // but not the verb ("currently match"), on the one screen whose job is
  // to be trusted.
  it('agrees the verb with the noun at a singular count (QA-senders-20260901-09)', () => {
    const { container } = render(
      <ConfirmActionModal
        request={request('Archive')}
        onCancel={() => {}}
        onConfirm={() => {}}
        compositePreview={{
          ...livePreview,
          counts: { all: 1, olderThan30d: 1, olderThan90d: 1, olderThan180d: 1, olderThan365d: 1 },
        }}
      />,
    );

    expect(
      screen.getByRole('heading', { name: `Archive emails from ${sender.name}?` }),
    ).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Archive impact' })).toHaveTextContent(
      '1 email will leave your inbox and stay in Gmail.',
    );
    expect(container.textContent).not.toMatch(/1\s*emails/);
  });

  // QA-senders-20260901-10: a 375px sheet can't be reached by a keyboard
  // shortcut, so the hints only added to the distance between the reader
  // and the confirm button.
  it('drops the Esc / ⌘⏎ keyboard hints in the mobile sheet variant', () => {
    render(
      <ConfirmActionModal
        variant="sheet"
        request={request('Archive')}
        onCancel={() => {}}
        onConfirm={() => {}}
        compositePreview={livePreview}
      />,
    );

    expect(screen.queryByText('Esc')).toBeNull();
    expect(screen.queryByText('⌘⏎')).toBeNull();
    expect(screen.getByRole('button', { name: /Cancel/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Archive/ })).toBeInTheDocument();
  });

  it('counts emails, not senders, while the emails-cleared meter is on', () => {
    meterSummary.current = {
      metered: true,
      limit: 1000,
      used: 100,
      remaining: 900,
      resetAt: '2026-11-09T00:00:00.000Z',
    };
    render(
      <ConfirmActionModal
        request={request('Archive')}
        onCancel={() => {}}
        onConfirm={() => {}}
        compositePreview={livePreview}
        cleanupQuota={{ remaining: 12, resetsAt: '2026-08-27T10:00:00.000Z' }}
      />,
    );
    expect(screen.getByTestId('meter-preview-line')).toHaveTextContent(
      'This clears 4 emails. You have 900 free this month.',
    );
    expect(screen.queryByText(/cleanup action/)).not.toBeInTheDocument();
    meterSummary.current = undefined;
  });

  it('uses the deck confirm when the email meter cannot cover the clear', () => {
    meterSummary.current = {
      metered: true,
      limit: 1000,
      used: 999,
      remaining: 1,
      resetAt: '2026-11-09T00:00:00.000Z',
    };
    render(
      <ConfirmActionModal
        request={request('Archive')}
        onCancel={() => {}}
        onConfirm={() => {}}
        compositePreview={livePreview}
      />,
    );
    expect(screen.getByRole('button', { name: 'Get Plus' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: fillStory(WS1_COPY['cap.plus.link']) }),
    ).not.toBeInTheDocument();
    meterSummary.current = undefined;
  });

  it('states quota usage when the action fits, from server-supplied numbers (A3)', () => {
    render(
      <ConfirmActionModal
        request={request('Archive')}
        onCancel={() => {}}
        onConfirm={() => {}}
        compositePreview={livePreview}
        cleanupQuota={{ remaining: 12, resetsAt: '2026-08-27T10:00:00.000Z' }}
      />,
    );
    expect(
      screen.getByText(/This clears 1 email. You have 12 free this month/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Archive/ })).toBeEnabled();
  });

  it('swaps confirm for a truthful upgrade action when the quota cannot cover a bulk (A3)', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const second = makeSender({ id: 'sender-q2', displayName: 'Quota Two', email: 'q2@x.com' });
    const bulkRequest: ActionRequest = { verb: 'Archive', senders: [sender, second] };
    const bulkData = {
      senders: [
        { senderId: sender.id, name: sender.name, counts: buckets, protected: false },
        { senderId: second.id, name: second.name, counts: buckets, protected: false },
      ],
      totals: buckets,
      protectedCount: 0,
    };
    render(
      <ConfirmActionModal
        request={bulkRequest}
        onCancel={onCancel}
        onConfirm={onConfirm}
        bulkPreview={{ data: bulkData, loading: false, error: false }}
        cleanupQuota={{ remaining: 1, resetsAt: null }}
      />,
    );

    expect(
      screen.getByText(/This clears 2 emails. You have 1 free left this month/),
    ).toBeInTheDocument();
    // No enabled confirm anywhere; the primary CTA is the upgrade action.
    expect(screen.queryByRole('button', { name: /Archive 2 senders|^📥/ })).not.toBeInTheDocument();
    const upgrade = screen.getByRole('button', { name: fillStory(WS1_COPY['cap.plus.link']) });
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(upgrade);
    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('lets a quota-capped bulk RUN, and says what it left behind (A3)', () => {
    // Covers the modal's HALF of the free-tier dead-end fix: the copy for
    // an already-trimmed request, and that confirm fires. The trimming
    // itself lives in `requestAction` and is proved by the senders-screen
    // test ("caps an over-quota bulk…") — a trimmed request satisfies the
    // quota by construction, so this test alone cannot show the block was
    // lifted.
    const onConfirm = vi.fn();
    const cappedRequest: ActionRequest = {
      verb: 'Archive',
      senders: [sender],
      quotaCappedFrom: 40,
    };
    render(
      <ConfirmActionModal
        request={cappedRequest}
        onCancel={() => {}}
        onConfirm={onConfirm}
        compositePreview={livePreview}
        cleanupQuota={{ remaining: 1, resetsAt: null }}
      />,
    );

    // D226: every count the user reads must be the count that RUNS. The
    // title comes off the request's senders, not `selectedCount -
    // skipped` — those agreed only before the quota cap gave a request a
    // second reason to cover fewer senders than the selection.
    expect(
      screen.getByRole('heading', { name: `Archive emails from ${sender.name}?` }),
    ).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Archive impact' })).toHaveTextContent(
      '4 emails will leave your inbox and stay in Gmail.',
    );
    expect(screen.queryByText(/from 40 senders/)).not.toBeInTheDocument();
    expect(screen.getByText(/This covers 1 of the 40 senders you picked/)).toBeInTheDocument();
    expect(screen.getByText(/all your free total allows this month/)).toBeInTheDocument();
    // The whole point: confirm is live, and firing it calls through.
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
    expect(onConfirm).toHaveBeenCalled();
    expect(
      screen.queryByRole('button', { name: fillStory(WS1_COPY['cap.plus.link']) }),
    ).not.toBeInTheDocument();
  });

  it('reports the combined eligibility+quota narrowing without mixing the two (D226)', () => {
    // 5 selected, 1 protected -> 4 eligible, allowance of 2 -> act on 2.
    // (The bulk preview covers exactly the capped senders, as it does in
    // the real flow, which is what keeps `unitsNeeded` and
    // `actionableCount` in agreement.)
    // Every number here means something different, and the round that
    // added this case got the NOUN wrong: `quotaCappedFrom` holds the
    // ELIGIBLE total, so calling it the selection told the user they had
    // selected 2 when they selected 3. The two coincide whenever a
    // request is only over quota, which is why the wording survived.
    const second = makeSender({ id: 'sender-c2', displayName: 'Combo Two', email: 'c2@x.com' });
    const combined: ActionRequest = {
      verb: 'Archive',
      senders: [sender, second],
      selectedCount: 5,
      actionableCount: 2,
      quotaCappedFrom: 4,
      skipped: { protectedCount: 1, peopleCount: 0 },
    };
    const bulkData = {
      senders: [
        { senderId: sender.id, name: sender.name, counts: buckets, protected: false },
        { senderId: second.id, name: second.name, counts: buckets, protected: false },
      ],
      totals: buckets,
      protectedCount: 0,
    };
    render(
      <ConfirmActionModal
        request={combined}
        onCancel={() => {}}
        onConfirm={() => {}}
        bulkPreview={{ data: bulkData, loading: false, error: false }}
        cleanupQuota={{ remaining: 2, resetsAt: null }}
      />,
    );

    // The capped total is the ELIGIBLE count, and says so.
    expect(screen.getByText(/This covers 2 of the 4 senders you picked/)).toBeInTheDocument();
    expect(screen.queryByText(/4 senders you selected/)).not.toBeInTheDocument();
    // The title is the acted-on count, stated by the caller.
    expect(
      screen.getByRole('heading', { name: 'Archive emails from 2 senders?' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Archive impact' })).toHaveTextContent(
      '4 emails will leave your inbox and stay in Gmail.',
    );
    // And the scope line keeps the real selection total intact.
    expect(screen.getByLabelText('Senders included in this bulk action')).toHaveTextContent(
      '5 selected · 2 in this preview · 1 Protected excluded',
    );
    expect(screen.getByLabelText('Senders included in this bulk action')).toBeVisible();
  });

  it('renders no quota line on an unlimited tier', () => {
    render(
      <ConfirmActionModal
        request={request('Archive')}
        onCancel={() => {}}
        onConfirm={() => {}}
        compositePreview={livePreview}
        cleanupQuota={{ remaining: null, resetsAt: null }}
      />,
    );
    expect(screen.queryByText(/left this month/)).not.toBeInTheDocument();
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
    expect(screen.getAllByText(/Couldn’t load the preview/i)).toHaveLength(1);
  });

  it('fails closed with retry copy when the required preview is unavailable', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmActionModal
        request={request('Archive')}
        onCancel={() => {}}
        onConfirm={onConfirm}
        compositePreviewError={true}
      />,
    );

    expect(screen.getByRole('button', { name: /Archive/ })).toBeDisabled();
    // Said once, beside the Retry preview button — never body AND footer.
    expect(screen.getAllByText(/Couldn’t load the preview/i)).toHaveLength(1);
    expect(screen.queryByText(/archive whatever/i)).not.toBeInTheDocument();
  });

  it('keeps a single-sender unsubscribe closed when the preview failed, and keeps Archive and Delete off', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmActionModal
        request={request('Unsubscribe')}
        onCancel={() => {}}
        onConfirm={onConfirm}
        compositePreviewError={true}
      />,
    );

    const confirm = screen.getByRole('button', { name: 'Unsubscribe' });
    expect(confirm).toBeDisabled();
    // The preview never resolved, so Archive and Delete stay off and
    // do not claim a zero count.
    expect(screen.getByRole('radio', { name: '+ Archive' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: '+ Delete' })).toBeDisabled();
    expect(screen.queryByRole('radio', { name: /0 emails/ })).toBeNull();
    expect(screen.queryByRole('combobox', { name: /How far back|Email age/i })).toBeNull();
    fireEvent.click(confirm);
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
    expect(onConfirm).not.toHaveBeenCalled();
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

    expect(
      screen.getByText('Inbox only. We check again right before anything moves.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Show 1 of 4$/ })).toBeInTheDocument();
    expect(screen.queryByText(/will move to Archive/i)).not.toBeInTheDocument();
    const account = screen.getByRole('note', { name: 'Gmail account: active@gmail.com' });
    expect(account.closest('details')).toBeNull();
    expect(account).toBeVisible();
  });

  it('says unsubscribing is free once a backlog move is the selection', () => {
    render(
      <ConfirmActionModal
        request={request('Unsubscribe')}
        onCancel={() => {}}
        onConfirm={() => {}}
        compositePreview={livePreview}
      />,
    );

    expect(screen.getByText('Unsubscribing is free and doesn’t count.')).toBeInTheDocument();
    expect(screen.queryByText(/past email uses a second one/i)).toBeNull();
    expect(screen.queryByText(/Uses 2 of your/)).toBeNull();
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

    // D245: the exact reason, not just the state — said once. The
    // "Delete anyway" button carries the consent, so the line does not.
    expect(screen.getByText(/you marked it Protected/)).toHaveTextContent(
      /^Protected — you marked it Protected\.$/,
    );
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

    expect(screen.getByRole('radiogroup', { name: 'Email you already have' })).toBeInTheDocument();
    expect(screen.getAllByText('Unsubscribe only')).toHaveLength(1);
    expect(screen.getByRole('radio', { name: '+ Archive 4' })).toBeEnabled();
    expect(screen.getByRole('radio', { name: '+ Delete 4' })).toBeEnabled();
    expect(screen.getByText('+ Archive 4')).toBeInTheDocument();
    expect(screen.getByText('+ Delete 4')).toBeInTheDocument();
    expect(
      screen.queryByRole('radio', { name: /Leave alone|Archive them|Delete them/i }),
    ).toBeNull();
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

  // Shipped live (2026-08-21): picking a backlog verb rendered
  // "Also: [object Object]" in the lead paragraph of a DESTRUCTIVE
  // confirm. The lead built its two halves from `presentation.primary`
  // (through `actionEffectCopy`) and `presentation.secondary` (raw — a
  // `PresentedAction` object), then guarded the pair with a hand-written
  // `copy is string` predicate that only tested `!== null`. That
  // predicate is an assertion, not a narrowing, so the object reached
  // `join` with nothing in the type system to stop it. Nothing asserted
  // on the assembled string, which is why it survived to production.
  it.each([
    [
      'archive',
      '+ Archive 4',
      'Unsubscribe from Acme Newsletter and archive 4 emails?',
      backlogMail('archive', 4),
      'Unsubscribe + Archive',
    ],
    [
      'delete',
      '+ Delete 4',
      'Unsubscribe from Acme Newsletter and delete 4 emails?',
      backlogMail('delete', 4),
      'Unsubscribe + Delete 4 emails',
    ],
  ] as const)(
    'renders deck copy for the backlog verb when %s is picked',
    (mode, radioName, heading, backlogFact, button) => {
      const onConfirm = vi.fn();
      const { container } = render(
        <ConfirmActionModal
          request={request('Unsubscribe')}
          onCancel={() => {}}
          onConfirm={onConfirm}
          compositePreview={livePreview}
        />,
      );

      fireEvent.click(screen.getByRole('radio', { name: radioName }));

      expect(container.textContent).not.toContain('[object Object]');
      expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
      expect(container.textContent).toContain(backlogFact);
      expect(container.textContent).toContain(
        'Future emails: we’ll send Acme Newsletter a one-click unsubscribe request.',
      );
      expect(container.textContent).toContain('Whether their email stops is up to the sender.');
      fireEvent.click(screen.getByRole('button', { name: button }));
      expect(onConfirm).toHaveBeenCalledWith({
        secondary: { type: mode, olderThanDays: null },
        archiveHistoric: mode === 'archive',
        senderIds: [sender.id],
      });
    },
  );
});

// The founder's 2026-07-27 report: a Delete preview reading "71 /mo"
// above five window chips that all said 0, and "0 emails currently match
// (older than 180 days)". Both numbers were true — the sender mails 71×
// a month and every one is already archived (verified against the dev DB:
// ealerts.bankofamerica.com, monthly 71, INBOX-now 0). The preview owed
// the reader that reconciliation.
describe('ConfirmActionModal — arrival volume vs INBOX-now counts', () => {
  const emptyInbox = {
    all: 0,
    olderThan30d: 0,
    olderThan90d: 0,
    olderThan180d: 0,
    olderThan365d: 0,
  };

  // The arrival figure rides the LIST ROW, not the preview — one field,
  // one window (ADR-0037). `monthlyVolume` is what the senders card
  // renders as "N in the last 90 days", so the modal and the card that opened it
  // cannot show different numbers.
  function renderDelete(counts: typeof emptyInbox, monthlyVolume: number | null) {
    return render(
      <ConfirmActionModal
        request={{ verb: 'Delete', senders: [makeSender({ monthlyVolume })] }}
        onCancel={() => {}}
        onConfirm={() => {}}
        compositePreview={{ ...livePreview, counts }}
      />,
    );
  }

  it('says nothing is left to move when both Inbox and archived are empty', () => {
    render(
      <ConfirmActionModal
        request={{ verb: 'Delete', senders: [makeSender()] }}
        onCancel={() => {}}
        onConfirm={() => {}}
        compositePreview={{
          ...livePreview,
          counts: emptyInbox,
          allMail: { counts: emptyInbox, recentMessages: subjects },
        }}
      />,
    );
    expect(screen.getByText(/No emails left to move to Trash/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Delete/ })).toBeDisabled();
  });

  it('explains a zero count instead of leaving it to contradict the volume figure', () => {
    renderDelete(emptyInbox, 71);
    expect(
      screen.getByText(
        /Nothing from this sender in your inbox now · 71 arrived in the last 90 days\. Delete only acts on email still in the inbox\./,
      ),
    ).toBeTruthy();
    // No claim about the mail's history or fate — we store only current labels.
    expect(screen.queryByText(/moved out of it|already archived|already deleted/)).toBeNull();
  });

  it('hides the window chips when no window can change the outcome', () => {
    renderDelete(emptyInbox, 71);
    expect(screen.queryByRole('combobox', { name: /How far back|Email age/i })).toBeNull();
    // …and drops the qualifier that described the now-absent control.
    expect(screen.queryByText(/older than 180 days/)).toBeNull();
  });

  it('names the window on the arrival figure and never renders a bare /mo', () => {
    const { container } = renderDelete(emptyInbox, 71);
    expect(container.textContent).toMatch(/71\s*in the last 90 days/);
    // "/mo" is the retired unit (ADR-0037). A number with no window is
    // how the card's 396 and the modal's 134 coexisted for one sender.
    expect(container.textContent).not.toMatch(/\/mo/);
  });

  it('carries the received total so the arrival figure has a denominator', () => {
    const { container } = renderDelete(emptyInbox, 71);
    // Same two facts, same words, as the senders card that opened this
    // modal: "N in the last 90 days · N received" (sender-card.tsx).
    expect(container.textContent).toMatch(/144\s*received/);
  });

  it('leaves INBOX-now to the chip row rather than printing a second copy', () => {
    // The strip is arrival-scoped only. A duplicated inbox count could
    // disagree with the live chips directly beneath it.
    const { container } = renderDelete({ ...emptyInbox, all: 9 }, 71);
    expect(container.textContent).not.toMatch(/9\s*in inbox/);
  });

  it('renders an unknown arrival volume as "—", never a factual 0', () => {
    const { container } = renderDelete(emptyInbox, null);
    expect(container.textContent).toMatch(/—\s*in the last 90 days/);
    expect(container.textContent).not.toMatch(/0\s*in the last 90 days/);
  });

  it('keeps the chips and points at a wider window when only THIS window is empty', () => {
    render(
      <ConfirmActionModal
        request={request('Delete')}
        onCancel={() => {}}
        onConfirm={() => {}}
        compositePreview={{
          ...livePreview,
          counts: { ...emptyInbox, all: 30, olderThan30d: 30 },
        }}
      />,
    );
    // The inbox is NOT empty, so the window row stays — widening it is a
    // real next step and the copy must not claim an empty inbox.
    expect(screen.getByRole('combobox', { name: /How far back|Email age/i })).toBeTruthy();
    expect(
      screen.getByText(
        /None of the 30 inbox emails from this sender are older than the 6 months\+ window\. Widen the window to include them\./,
      ),
    ).toBeTruthy();
  });

  it('stays silent when the selected window matches mail', () => {
    render(
      <ConfirmActionModal
        request={request('Delete')}
        onCancel={() => {}}
        onConfirm={() => {}}
        compositePreview={livePreview}
      />,
    );
    expect(screen.queryByText(/Nothing from this sender is in your inbox/)).toBeNull();
    expect(screen.queryByText(/Widen the window/)).toBeNull();
  });

  it('never narrates the inbox from a stale cache mid-refetch', () => {
    render(
      <ConfirmActionModal
        request={request('Delete')}
        onCancel={() => {}}
        onConfirm={() => {}}
        compositePreview={{ ...livePreview, counts: emptyInbox }}
        compositePreviewLoading
      />,
    );
    expect(screen.queryByText(/Nothing from this sender is in your inbox/)).toBeNull();
  });
});

// Later is the third verb whose entire effect is moving current inbox
// mail, and it counts as a cleanup action. Confirming it on an empty
// inbox spent one of the Free tier's 50 monthly actions to do nothing —
// Archive and Delete were blocked, Later was not (live smoke 2026-07-27).
describe('ConfirmActionModal — no-op confirm gate', () => {
  const emptyInbox = {
    all: 0,
    olderThan30d: 0,
    olderThan90d: 0,
    olderThan180d: 0,
    olderThan365d: 0,
  };
  const emptyPreview = { ...livePreview, counts: emptyInbox };

  it.each(['Archive', 'Delete', 'Later'] as const)(
    'blocks %s when nothing in the inbox can move',
    (verb) => {
      render(
        <ConfirmActionModal
          request={request(verb)}
          onCancel={() => {}}
          onConfirm={() => {}}
          compositePreview={emptyPreview}
        />,
      );
      expect(screen.getByRole('button', { name: new RegExp(verb) })).toBeDisabled();
    },
  );

  // The notice under the 0 is the disabled reason. A lead describing the
  // move, and a footer charging a cleanup action, are both about an
  // action that cannot run.
  it.each(['Archive', 'Later'] as const)(
    'says the dead-end zero once for %s: no lead, no cleanup-action charge',
    (verb) => {
      render(
        <ConfirmActionModal
          request={request(verb)}
          onCancel={() => {}}
          onConfirm={() => {}}
          compositePreview={emptyPreview}
          cleanupQuota={{ remaining: 12, resetsAt: null }}
        />,
      );
      expect(document.getElementById('dm-confirm-lead')).toBeNull();
      expect(screen.queryByText(/cleanup action/)).toBeNull();
      expect(screen.getByText(/in your inbox now/)).toBeInTheDocument();
    },
  );

  it('keeps the lead while a control on the sheet can still change the zero', () => {
    // 9 in the inbox, none inside the default Delete window → widen it.
    render(
      <ConfirmActionModal
        request={request('Delete')}
        onCancel={() => {}}
        onConfirm={() => {}}
        compositePreview={{ ...livePreview, counts: { ...emptyInbox, all: 9 } }}
      />,
    );
    expect(document.getElementById('dm-confirm-lead')).not.toBeNull();
  });

  it('keeps Unsubscribe confirmable at a zero backlog — it cuts future mail', () => {
    render(
      <ConfirmActionModal
        request={request('Unsubscribe')}
        onCancel={() => {}}
        onConfirm={() => {}}
        compositePreview={emptyPreview}
      />,
    );
    expect(screen.getByRole('button', { name: /Unsubscribe/ })).toBeEnabled();
  });

  it('still confirms Later when the inbox actually has mail to move', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmActionModal
        request={request('Later')}
        onCancel={() => {}}
        onConfirm={onConfirm}
        compositePreview={livePreview}
      />,
    );
    const confirm = screen.getByRole('button', { name: /Later/ });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

// On Unsubscribe + a backlog secondary the zero count describes the
// SECONDARY. Naming the primary produced "Unsubscribe only acts on mail
// still in the inbox" — flatly false, and false about the one verb that
// never touches inbox mail (live smoke 2026-07-27).
describe('ConfirmActionModal — a zero inbox leaves unsubscribe confirmable', () => {
  const emptyPreview = {
    ...livePreview,
    counts: { all: 0, olderThan30d: 0, olderThan90d: 0, olderThan180d: 0, olderThan365d: 0 },
  };

  it('disables Archive and Delete and confirms unsubscribe only', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmActionModal
        request={request('Unsubscribe')}
        onCancel={() => {}}
        onConfirm={onConfirm}
        compositePreview={emptyPreview}
      />,
    );

    expect(screen.getByRole('radio', { name: '+ Archive 0' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: '+ Delete 0' })).toBeDisabled();
    expect(screen.queryByText(/Unsubscribe only acts on email still in the inbox/)).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'Include archived email' })).toBeNull();
    const confirm = screen.getByRole('button', { name: 'Unsubscribe' });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith({
      secondary: null,
      archiveHistoric: false,
      senderIds: [sender.id],
    });
  });
});

it('pluralizes the scope notice on a bulk sheet', () => {
  const second = makeSender({ id: 'sender-b2', displayName: 'Beta', email: 'b@beta.com' });
  const empty = {
    all: 0,
    olderThan30d: 0,
    olderThan90d: 0,
    olderThan180d: 0,
    olderThan365d: 0,
  };
  render(
    <ConfirmActionModal
      request={{ verb: 'Archive', senders: [sender, second] }}
      onCancel={() => {}}
      onConfirm={() => {}}
      bulkPreview={{
        data: {
          senders: [
            { senderId: sender.id, name: sender.name, counts: empty, protected: false },
            { senderId: second.id, name: second.name, counts: empty, protected: false },
          ],
          totals: empty,
          protectedCount: 0,
        },
        loading: false,
        error: false,
      }}
    />,
  );
  expect(screen.getByText(/Nothing from these senders in your inbox now\./)).toBeTruthy();
  // Bulk has no single arrival figure — it must not invent one.
  expect(screen.queryByText(/arrived in the last 90 days/)).toBeNull();
});

// B/C/D — the trust affordances added 2026-07-27 after the founder's
// screenshots showed four identical window chips and a dateless sample.
describe('ConfirmActionModal — preview trust affordances', () => {
  // github.com shape: newest inbox mail is 182d old, so All/30d/90d/180d
  // all match 2,908 and only 1yr+ narrows.
  const tiedCounts = {
    all: 2908,
    olderThan30d: 2908,
    olderThan90d: 2908,
    olderThan180d: 2908,
    olderThan365d: 59,
  };

  it('explains a tied window row instead of leaving 4 identical chips (B)', () => {
    // The age MUST come from the INBOX-scoped sample, not
    // `sender.lastSeenDays` (all-labels). Measured on the dev mailbox
    // 2026-07-27, jobs-noreply@linkedin.com had lastSeenDays 3 while its
    // newest INBOX message was 2,784 days old — the old wiring printed
    // "3 days old" about a 7-year-old inbox.
    const inbox182dAgo = new Date(Date.now() - 182 * 86_400_000).toISOString();
    render(
      <ConfirmActionModal
        request={request('Archive')}
        onCancel={() => {}}
        onConfirm={() => {}}
        compositePreview={{
          ...livePreview,
          // Deliberately contradicts the inbox sample: if the copy ever
          // reads this field again, the assertion below fails.
          sender: { ...livePreview.sender, lastSeenDays: 3 },
          counts: tiedCounts,
          recentMessages: {
            ...subjects,
            all: [{ subject: 'Oldest still in inbox', date: inbox182dAgo }],
          },
        }}
      />,
    );
    expect(
      screen.getByText(
        /Nothing newer than 182 days, so every window through 6 months\+ matches the same 2,908\./,
      ),
    ).toBeTruthy();
    // The chips themselves stay: merging them would let "All inbox" stand
    // in for "6 months+", which can diverge at execution.
    expect(screen.getByRole('combobox', { name: /How far back|Email age/i })).toBeTruthy();
  });

  it('stays quiet when every window narrows something (B)', () => {
    render(
      <ConfirmActionModal
        request={request('Archive')}
        onCancel={() => {}}
        onConfirm={() => {}}
        compositePreview={livePreview}
      />,
    );
    expect(screen.queryByText(/matches the same/)).toBeNull();
  });

  it('dates every row in the current-matches sample (C)', () => {
    render(
      <ConfirmActionModal
        request={request('Archive')}
        onCancel={() => {}}
        onConfirm={() => {}}
        compositePreview={livePreview}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Show \d/ }));
    const row = screen.getByText('Latest message').closest('div')!;
    // Rendered from LOCAL calendar parts so it agrees with the date Gmail
    // shows; asserting the literal UTC slice would bake in a TZ assumption.
    const d = new Date('2026-06-20T09:00:00.000Z');
    const two = (n: number) => String(n).padStart(2, '0');
    const localDay = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
    expect(row.textContent).toContain(localDay);
    // ISO order, not a locale format that flips D/M.
    expect(localDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(row.querySelector('time')?.getAttribute('dateTime')).toBe('2026-06-20T09:00:00.000Z');
  });

  it('renders the LOCAL day, not the UTC day, for a late-evening message', () => {
    // 2026-06-20T04:00Z is still 2026-06-19 in any US timezone. Whatever
    // the runner's zone, the rendered day must equal the local day.
    const late = '2026-06-20T04:00:00.000Z';
    render(
      <ConfirmActionModal
        request={request('Archive')}
        onCancel={() => {}}
        onConfirm={() => {}}
        compositePreview={{
          ...livePreview,
          recentMessages: { ...subjects, all: [{ subject: 'Late night', date: late }] },
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Show \d/ }));
    const d = new Date(late);
    const two = (n: number) => String(n).padStart(2, '0');
    expect(screen.getByText('Late night').closest('div')!.textContent).toContain(
      `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`,
    );
  });

  it('offers a Gmail search scoped to the same window (D)', () => {
    render(
      <ConfirmActionModal
        request={request('Delete')}
        onCancel={() => {}}
        onConfirm={() => {}}
        compositePreview={livePreview}
        mailboxEmail="chintan@example.com"
      />,
    );
    const link = screen.getByRole('link', { name: /Check in Gmail/ });
    const href = decodeURIComponent(link.getAttribute('href') ?? '');
    // Quoted, matching `buildFromSearchLink` — an unquoted address breaks
    // Gmail search on any address containing a `+` or a dot-heavy local part.
    expect(href).toContain(`from:"${sender.email}"`);
    expect(href).toContain('in:inbox');
    // Delete defaults to the 6-month window — the link must carry it.
    expect(href).toContain('older_than:180d');
    // Never promises the counts match; Gmail is day-granular and live.
    expect(link.getAttribute('title')).toMatch(/Approximate/i);
  });

  it('drops the window term from the Gmail link when no window applies (D)', () => {
    render(
      <ConfirmActionModal
        request={request('Later')}
        onCancel={() => {}}
        onConfirm={() => {}}
        compositePreview={livePreview}
        mailboxEmail="chintan@example.com"
      />,
    );
    const href = decodeURIComponent(
      screen.getByRole('link', { name: /Check in Gmail/ }).getAttribute('href') ?? '',
    );
    expect(href).toContain('in:inbox');
    expect(href).not.toContain('older_than');
  });

  it('offers no Gmail link before the preview resolves (D)', () => {
    render(
      <ConfirmActionModal
        request={request('Delete')}
        onCancel={() => {}}
        onConfirm={() => {}}
        mailboxEmail="chintan@example.com"
      />,
    );
    expect(screen.queryByRole('link', { name: /Check in Gmail/ })).toBeNull();
  });
});

describe('ConfirmActionModal — ADR-0028 reach (Inbox only / Inbox + archived)', () => {
  const reachRow = () => screen.queryByRole('checkbox', { name: 'Include archived email' });

  it('keeps Include archived email visible and disabled when the archived count is missing', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmActionModal
        request={request('Delete')}
        onCancel={() => {}}
        onConfirm={onConfirm}
        compositePreview={livePreview}
      />,
    );
    const includeArchived = screen.getByRole('checkbox', { name: 'Include archived email' });
    expect(includeArchived).not.toBeChecked();
    expect(includeArchived).toBeDisabled();
    expect(screen.getByText(WS5_COPY['f1.preview.archived.unavailable'])).toBeInTheDocument();
    fireEvent.click(includeArchived);
    expect(includeArchived).not.toBeChecked();

    const confirm = screen.getByRole('button', { name: 'Delete' });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0]?.[0]).not.toHaveProperty('reach');
  });

  it('stays fail-closed when the archived count disappears after Include archived email is on', () => {
    const onConfirm = vi.fn();
    const pending = request('Delete');
    const { rerender } = render(
      <ConfirmActionModal
        request={pending}
        onCancel={() => {}}
        onConfirm={onConfirm}
        compositePreview={livePreviewWithAllMail}
      />,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include archived email' }));
    expect(screen.getByRole('checkbox', { name: 'Include archived email' })).toBeChecked();

    rerender(
      <ConfirmActionModal
        request={pending}
        onCancel={() => {}}
        onConfirm={onConfirm}
        compositePreview={livePreview}
      />,
    );
    const includeArchived = screen.getByRole('checkbox', { name: 'Include archived email' });
    expect(includeArchived).toBeEnabled();
    expect(includeArchived).toBeChecked();
    expect(screen.getByText(WS5_COPY['f1.preview.archived.unavailable'])).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Delete impact' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(includeArchived);
    expect(includeArchived).not.toBeChecked();
    const confirm = screen.getByRole('button', { name: 'Delete' });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0]?.[0]).not.toHaveProperty('reach');
  });

  it.each(['Archive', 'Later'] as const)('offers no reach choice on %s', (verb) => {
    render(
      <ConfirmActionModal
        request={request(verb)}
        onCancel={() => {}}
        onConfirm={() => {}}
        compositePreview={livePreviewWithAllMail}
      />,
    );
    expect(reachRow()).toBeNull();
  });

  it('defaults Delete with Include archived email off, and the headline uses the inbox count', () => {
    render(
      <ConfirmActionModal
        request={request('Delete')}
        onCancel={() => {}}
        onConfirm={() => {}}
        compositePreview={livePreviewWithAllMail}
      />,
    );
    const includeArchived = screen.getByRole('checkbox', { name: 'Include archived email' });
    expect(includeArchived).not.toBeChecked();
    expect(includeArchived).toHaveStyle({ minHeight: '48px' });
    expect(screen.getByRole('region', { name: 'Delete impact' })).toHaveTextContent(
      '1 email will move to Gmail Trash.',
    );
    expect(screen.queryByText('Both choices cover the same emails right now.')).toBeNull();
  });

  it('confirms with reach all_mail only after the archived chip is chosen', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmActionModal
        request={request('Delete')}
        onCancel={() => {}}
        onConfirm={onConfirm}
        compositePreview={livePreviewWithAllMail}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Delete/ }));
    expect(onConfirm).toHaveBeenLastCalledWith(expect.not.objectContaining({ reach: 'all_mail' }));

    fireEvent.click(screen.getByRole('checkbox', { name: 'Include archived email' }));
    fireEvent.click(screen.getByRole('button', { name: /Delete/ }));
    expect(onConfirm).toHaveBeenLastCalledWith(expect.objectContaining({ reach: 'all_mail' }));
  });

  it('switches the headline, chip labels and count source to the all-mail set', () => {
    render(
      <ConfirmActionModal
        request={request('Delete')}
        onCancel={() => {}}
        onConfirm={() => {}}
        compositePreview={livePreviewWithAllMail}
      />,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include archived email' }));
    // 180d default window over the all-mail buckets — the figure appears
    // on both the chip and the title, so assert the pair.
    expect(screen.getByRole('region', { name: 'Delete impact' })).toHaveTextContent(
      '700 emails will move to Gmail Trash.',
    );
    expect(screen.getByRole('checkbox', { name: 'Include archived email' })).toBeChecked();
    expect(
      screen.getByText(
        'Inbox and archived email (older than 180 days). We check again right before anything moves.',
      ),
    ).toBeInTheDocument();
    // The un-windowed option stops claiming "inbox" once the reach is wider.
    expect(screen.getByRole('option', { name: 'Any age' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /All inbox/ })).toBeNull();
    // The widened scope + the per-message undo promise (ADR-0028 §5:
    // "Undo restores each message to where it was") are stated where
    // the choice is made.
    expect(screen.getByText('Trash, Spam, Drafts, Chat')).toBeInTheDocument();
    expect(screen.getByText(/^Puts each email back where it was$/)).toBeInTheDocument();
  });

  it('drops in:inbox from the Gmail verify link at all-mail reach', () => {
    render(
      <ConfirmActionModal
        request={request('Delete')}
        onCancel={() => {}}
        onConfirm={() => {}}
        compositePreview={livePreviewWithAllMail}
        mailboxEmail="chintan@example.com"
      />,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include archived email' }));
    const href = decodeURIComponent(
      screen.getByRole('link', { name: /Check in Gmail/ }).getAttribute('href') ?? '',
    );
    expect(href).toContain(`from:"${sender.email}"`);
    expect(href).not.toContain('in:inbox');
  });

  it('points the empty-inbox notice at the archived chip when archived mail exists', () => {
    const emptyInbox: CompositeActionPreviewResult = {
      ...livePreviewWithAllMail,
      counts: { all: 0, olderThan30d: 0, olderThan90d: 0, olderThan180d: 0, olderThan365d: 0 },
      recentMessages: {
        all: [],
        olderThan30d: [],
        olderThan90d: [],
        olderThan180d: [],
        olderThan365d: [],
      },
    };
    render(
      <ConfirmActionModal
        request={request('Delete')}
        onCancel={() => {}}
        onConfirm={() => {}}
        compositePreview={emptyInbox}
      />,
    );
    // The window chips are suppressed (five zeros), but the reach row is
    // exactly the escape hatch and must stay visible.
    expect(screen.queryByRole('combobox', { name: /How far back|Email age/i })).toBeNull();
    expect(reachRow()).not.toBeNull();
    expect(
      screen.getByText('Turn on Include archived email to reach 977 archived emails.'),
    ).toBeInTheDocument();
    // With the reach control on screen, the notice must NOT claim Delete
    // "only acts on" inbox mail — the next sentence disproves it.
    expect(screen.getByText(/Delete acts on inbox email by default/)).toBeInTheDocument();
    expect(screen.queryByText(/only acts on email still in the inbox/)).toBeNull();
    // Flipping the chip clears the inbox-scope narration AND arms the
    // exact figure the chip advertised: the hidden 180d default resets
    // to "All mail", so the user gets 977, not a silently-shaved 700.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include archived email' }));
    expect(screen.queryByText(/in your inbox now/)).toBeNull();
    expect((screen.getByRole('option', { name: 'Any age' }) as HTMLOptionElement).selected).toBe(
      true,
    );
    expect(screen.getByRole('region', { name: 'Delete impact' })).toHaveTextContent(
      '977 emails will move to Gmail Trash.',
    );
    expect(screen.getByRole('button', { name: /Delete/ })).toBeEnabled();
  });

  it('still blocks confirm when the all-mail set is empty too', () => {
    const nothingAnywhere: CompositeActionPreviewResult = {
      ...livePreviewWithAllMail,
      counts: { all: 0, olderThan30d: 0, olderThan90d: 0, olderThan180d: 0, olderThan365d: 0 },
      allMail: {
        counts: { all: 0, olderThan30d: 0, olderThan90d: 0, olderThan180d: 0, olderThan365d: 0 },
        recentMessages: {
          all: [],
          olderThan30d: [],
          olderThan90d: [],
          olderThan180d: [],
          olderThan365d: [],
        },
      },
    };
    render(
      <ConfirmActionModal
        request={request('Delete')}
        onCancel={() => {}}
        onConfirm={() => {}}
        compositePreview={nothingAnywhere}
      />,
    );
    // Matching zeros hide the checkbox. Confirm stays blocked either way.
    expect(reachRow()).toBeNull();
    expect(screen.queryByText('Both choices cover the same emails right now.')).toBeNull();
    expect(screen.getByRole('heading', { name: /Nothing in your inbox from/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Delete/ })).toBeDisabled();
  });

  it('resets to Inbox only when the modal reopens for a new request', () => {
    const first = request('Delete');
    const { rerender } = render(
      <ConfirmActionModal
        request={first}
        onCancel={() => {}}
        onConfirm={() => {}}
        compositePreview={livePreviewWithAllMail}
      />,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include archived email' }));
    expect(screen.getByRole('checkbox', { name: 'Include archived email' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    rerender(
      <ConfirmActionModal
        request={request('Delete')}
        onCancel={() => {}}
        onConfirm={() => {}}
        compositePreview={livePreviewWithAllMail}
      />,
    );
    expect(screen.getByRole('checkbox', { name: 'Include archived email' })).not.toBeChecked();
  });
});

// 2026-08-31 — the Unsubscribe composite's "Delete them" secondary
// re-dispatches as its own single-sender Delete on the wire
// (senders-screen.tsx / sender-detail-page.tsx enqueue it as
// `primary: {type: 'delete', ...}`), so it can carry the same ADR-0028
// reach the direct Delete modal offers. Before this, the secondary was
// silently pinned to inbox-only with no chip to explain why — a sender
// with 753 total mail and 2 in the inbox showed "2 emails currently
// match" with no way to reach the other 751 (founder report
// 2026-08-31).
describe('ConfirmActionModal — unsubscribe cleanup scope defaults', () => {
  it('offers reach only on Delete, with Inbox only as the default', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmActionModal
        request={request('Unsubscribe')}
        onCancel={() => {}}
        onConfirm={onConfirm}
        compositePreview={livePreviewWithAllMail}
      />,
    );
    expect(screen.queryByRole('checkbox', { name: 'Include archived email' })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'Include archived email' })).toBeNull();
    expect(screen.getByRole('combobox', { name: /How far back|Email age/i })).toHaveValue('all');

    fireEvent.click(screen.getByRole('radio', { name: '+ Delete 4' }));
    expect(screen.getByRole('checkbox', { name: 'Include archived email' })).not.toBeChecked();
    expect(
      screen.getByRole('heading', {
        name: 'Unsubscribe from Acme Newsletter and delete 4 emails?',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Deleted email sits in Gmail Trash, and Gmail deletes it for good after 30 days, or sooner if you empty Trash\./,
      ),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: /^Unsubscribe \+ Delete(?: [\d,]+ emails?)?$/ }),
    );
    expect(onConfirm).toHaveBeenCalledWith({
      secondary: { type: 'delete', olderThanDays: null },
      archiveHistoric: false,
      senderIds: [sender.id],
    });
    expect(onConfirm.mock.calls[0]?.[0]).not.toHaveProperty('reach');
  });
});

describe('ConfirmActionModal — ADR-0028 reach on a bulk selection (amendment 2026-09-19)', () => {
  const second = makeSender({ id: 'sender-2', displayName: 'Beta Digest', email: 'b@beta.com' });
  const secondOneClick = makeSender({
    id: 'sender-2',
    displayName: 'Beta Digest',
    email: 'b@beta.com',
    unsubscribeMethod: 'one_click',
  });
  const doubled = (b: typeof buckets) => ({
    all: b.all * 2,
    olderThan30d: b.olderThan30d * 2,
    olderThan90d: b.olderThan90d * 2,
    olderThan180d: b.olderThan180d * 2,
    olderThan365d: b.olderThan365d * 2,
  });
  const bulkDataFor = (senders: ActionRequest['senders'], withAllMail: boolean) => ({
    senders: senders.map((s) => ({
      senderId: s.id,
      name: s.name,
      counts: buckets,
      ...(withAllMail ? { allMailCounts: allMailBuckets } : {}),
      protected: false,
    })),
    totals: doubled(buckets),
    ...(withAllMail ? { allMailTotals: doubled(allMailBuckets) } : {}),
    protectedCount: 0,
  });
  const reachRow = () => screen.queryByRole('checkbox', { name: 'Include archived email' });

  it('offers the reach choice on a bulk Delete and confirms all_mail only once chosen', () => {
    const onConfirm = vi.fn();
    const senders = [sender, second];
    render(
      <ConfirmActionModal
        request={{ verb: 'Delete', senders }}
        onCancel={() => {}}
        onConfirm={onConfirm}
        bulkPreview={{ data: bulkDataFor(senders, true), loading: false, error: false }}
      />,
    );
    expect(reachRow()).not.toBeNull();
    const archived = screen.getByRole('checkbox', { name: 'Include archived email' });
    expect(archived).not.toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: /Delete/ }));
    expect(onConfirm).toHaveBeenLastCalledWith(expect.not.objectContaining({ reach: 'all_mail' }));

    expect(screen.getByRole('region', { name: 'Delete impact' })).toHaveTextContent(
      'will move to Gmail Trash.',
    );
    fireEvent.click(archived);
    expect(screen.getByRole('region', { name: 'Delete impact' })).toHaveTextContent(
      '1,400 emails will move to Gmail Trash.',
    );
    expect(
      screen.getByText(
        'Inbox and archived email (older than 180 days). We check again right before anything moves.',
      ),
    ).toBeInTheDocument();
    // The subtitle follows the chip — it must not keep describing inbox mail only.
    expect(screen.queryByText('They move to Gmail Trash.')).toBeNull();
    expect(screen.getByRole('region', { name: 'Delete impact' })).toHaveTextContent(
      'Inbox and archived email',
    );
    fireEvent.click(screen.getByRole('button', { name: /Delete/ }));
    expect(onConfirm).toHaveBeenLastCalledWith(expect.objectContaining({ reach: 'all_mail' }));
  });

  it('never claims the whole selection is empty while a Protected sender went uncounted', () => {
    // Bulk totals exclude Protected senders, so a zero there says nothing
    // about THEIR mail — "no email from these senders" would be a claim
    // the preview never measured.
    const zero = { all: 0, olderThan30d: 0, olderThan90d: 0, olderThan180d: 0, olderThan365d: 0 };
    const senders = [sender, second];
    const data = (protectedCount: number) => ({
      senders: [
        {
          senderId: sender.id,
          name: sender.name,
          counts: zero,
          allMailCounts: zero,
          protected: false,
        },
        {
          senderId: second.id,
          name: second.name,
          counts: protectedCount ? buckets : zero,
          allMailCounts: protectedCount ? allMailBuckets : zero,
          protected: protectedCount > 0,
        },
      ],
      totals: zero,
      allMailTotals: zero,
      protectedCount,
    });
    const { rerender } = render(
      <ConfirmActionModal
        request={{ verb: 'Delete', senders }}
        onCancel={() => {}}
        onConfirm={() => {}}
        bulkPreview={{ data: data(1), loading: false, error: false }}
      />,
    );
    expect(screen.queryByText(/There is no email from these senders/)).toBeNull();
    // The fallback notice names only the senders the zero covers.
    expect(screen.queryByText(/Nothing from these senders/)).toBeNull();
    expect(screen.getByText(/Nothing from the unprotected senders/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Delete/ })).toBeDisabled();

    // With nothing excluded, the zero DOES cover the whole selection.
    rerender(
      <ConfirmActionModal
        request={{ verb: 'Delete', senders }}
        onCancel={() => {}}
        onConfirm={() => {}}
        bulkPreview={{ data: data(0), loading: false, error: false }}
      />,
    );
    expect(
      screen.getByText(/There is no email from these senders in Inbox or archived/),
    ).toBeInTheDocument();
  });

  it('keeps a bulk unsubscribe on the inbox count with no reach choice', () => {
    const onConfirm = vi.fn();
    const senders = [oneClickSender, secondOneClick];
    render(
      <ConfirmActionModal
        request={{ verb: 'Unsubscribe', senders }}
        onCancel={() => {}}
        onConfirm={onConfirm}
        bulkPreview={{ data: bulkDataFor(senders, true), loading: false, error: false }}
      />,
    );
    expect(screen.queryByRole('checkbox', { name: 'Include archived email' })).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: '+ Delete 8' }));
    fireEvent.click(screen.getByRole('radio', { name: '+ Archive 8' }));
    fireEvent.click(screen.getByRole('button', { name: 'Unsubscribe + Archive' }));
    expect(onConfirm).toHaveBeenCalledWith({
      secondary: { type: 'archive', olderThanDays: null },
      archiveHistoric: true,
      senderIds: senders.map((row) => row.id),
    });
    expect(onConfirm.mock.calls[0]?.[0]).not.toHaveProperty('reach');
  });

  it('disables Include archived email on a bulk Delete when the all-mail totals are missing', () => {
    const onConfirm = vi.fn();
    const senders = [sender, second];
    render(
      <ConfirmActionModal
        request={{ verb: 'Delete', senders }}
        onCancel={() => {}}
        onConfirm={onConfirm}
        bulkPreview={{ data: bulkDataFor(senders, false), loading: false, error: false }}
      />,
    );
    const includeArchived = screen.getByRole('checkbox', { name: 'Include archived email' });
    expect(includeArchived).toBeDisabled();
    expect(includeArchived).not.toBeChecked();
    expect(screen.getByText(WS5_COPY['f1.preview.archived.unavailable'])).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Delete/ }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0]?.[0]).not.toHaveProperty('reach');
  });

  it.each(['Archive', 'Later'] as const)('offers no bulk reach choice on %s', (verb) => {
    const senders = [sender, second];
    render(
      <ConfirmActionModal
        request={{ verb, senders }}
        onCancel={() => {}}
        onConfirm={() => {}}
        bulkPreview={{ data: bulkDataFor(senders, true), loading: false, error: false }}
      />,
    );
    expect(reachRow()).toBeNull();
  });

  it('confirms a bulk unsubscribe delete at the chosen reach', () => {
    const onConfirm = vi.fn();
    const senders = [oneClickSender, secondOneClick];
    render(
      <ConfirmActionModal
        request={{ verb: 'Unsubscribe', senders }}
        onCancel={() => {}}
        onConfirm={onConfirm}
        bulkPreview={{ data: bulkDataFor(senders, true), loading: false, error: false }}
      />,
    );
    expect(reachRow()).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: '+ Delete 8' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include archived email' }));
    expect(screen.queryByText(/^Inbox \+ archived now/)).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: /^Unsubscribe \+ Delete(?: [\d,]+ emails?)?$/ }),
    );
    expect(onConfirm).toHaveBeenCalledWith({
      secondary: { type: 'delete', olderThanDays: null },
      archiveHistoric: false,
      reach: 'all_mail',
      senderIds: senders.map((row) => row.id),
    });
  });
});

// ─────────────── D248 — per-channel unsubscribe preview ────────────────
describe('ConfirmActionModal — unsubscribe preview lines (no capability breakdown)', () => {
  function unsubRequest(methods: Array<'one_click' | 'mailto' | 'none' | null>): ActionRequest {
    return {
      verb: 'Unsubscribe',
      senders: methods.map((unsubscribeMethod, i) =>
        makeSender({ id: `s-${i}`, displayName: `Sender ${i}`, unsubscribeMethod }),
      ),
    };
  }

  function counted(action: ActionRequest, all = 0) {
    return {
      data: {
        senders: action.senders.map((s) => ({
          senderId: s.id,
          name: s.name,
          counts: { ...buckets, all },
          protected: false,
        })),
        totals: { ...buckets, all },
        protectedCount: 0,
      },
      loading: false,
      error: false,
    };
  }

  it('names each sender’s future path and has no breakdown list', () => {
    const action = unsubRequest(['one_click', 'mailto', 'none', null]);
    const { container } = render(
      <ConfirmActionModal
        request={action}
        onCancel={() => {}}
        onConfirm={() => {}}
        bulkPreview={counted(action)}
      />,
    );

    expect(screen.queryByLabelText('Unsubscribe breakdown')).toBeNull();
    expect(screen.queryByText(/No sendable unsubscribe for these senders/)).toBeNull();
    const text = container.textContent ?? '';
    expect(text).toContain('Future emails: we’ll send Sender 0 a one-click unsubscribe request.');
    expect(text).toContain(
      'Future emails: we’ll open a prefilled email in Gmail for you to send to Sender 1.',
    );
    expect(text).not.toContain('Gmail draft');
    expect(text).toContain(
      'Future emails: Sender 2 has no unsubscribe link, so we can’t send a request.',
    );
    expect(text).not.toContain('6 senders');
    expect(text).not.toMatch(/we unsubscribe/i);
  });

  it('does not describe an un-indexed sender as having no channel', () => {
    const action = unsubRequest(['one_click', null]);
    const { container } = render(
      <ConfirmActionModal
        request={action}
        onCancel={() => {}}
        onConfirm={() => {}}
        bulkPreview={counted(action)}
      />,
    );

    const text = container.textContent ?? '';
    expect(text).toContain('Future emails: we’ll send Sender 0 a one-click unsubscribe request.');
    expect(text).not.toContain('No unsubscribe');
    expect(text).not.toContain('Not checked yet');
    expect(text).not.toContain('Sender 1 has no unsubscribe link');
  });

  it('still confirms a single mailto sender — the compose hand-off lives there', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmActionModal
        request={unsubRequest(['mailto'])}
        onCancel={() => {}}
        onConfirm={onConfirm}
      />,
    );

    const confirm = screen.getByRole('button', { name: 'Unsubscribe' });
    expect(confirm).toBeEnabled();
    expect(
      screen.getByText(
        'Future emails: we’ll open a prefilled email in Gmail for you to send to Sender 0.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Gmail draft/)).toBeNull();
    expect(screen.queryByText(/No sendable unsubscribe for these senders/)).toBeNull();
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith({
      secondary: null,
      archiveHistoric: false,
      senderIds: ['s-0'],
    });
  });

  it('still confirms when the selection has no one-click sender', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmActionModal
        request={unsubRequest(['mailto', 'none', null])}
        onCancel={() => {}}
        onConfirm={onConfirm}
      />,
    );

    const confirm = screen.getByRole('button', { name: 'Unsubscribe' });
    expect(confirm).toBeEnabled();
    expect(screen.queryByText(/No sendable unsubscribe for these senders/)).toBeNull();
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith({
      secondary: null,
      archiveHistoric: false,
      senderIds: ['s-0', 's-1', 's-2'],
    });
  });

  it('confirms archive when one sender is one-click and the inbox count is known', () => {
    const onConfirm = vi.fn();
    const action = unsubRequest(['one_click', 'mailto', null]);
    render(
      <ConfirmActionModal
        request={action}
        onCancel={() => {}}
        onConfirm={onConfirm}
        bulkPreview={{
          data: {
            senders: action.senders.map((s) => ({
              senderId: s.id,
              name: s.name,
              counts: buckets,
              protected: false,
            })),
            totals: buckets,
            protectedCount: 0,
          },
          loading: false,
          error: false,
        }}
      />,
    );

    const confirm = screen.getByRole('button', { name: 'Unsubscribe + Archive' });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith({
      secondary: { type: 'archive', olderThanDays: null },
      archiveHistoric: true,
      senderIds: action.senders.map((row) => row.id),
    });
  });

  it('describes the one-click request and the sender with no link', () => {
    const action = unsubRequest(['one_click', 'none']);
    render(
      <ConfirmActionModal
        request={action}
        onCancel={() => {}}
        onConfirm={() => {}}
        bulkPreview={counted(action)}
      />,
    );

    expect(
      screen.getByText(/Future emails: we’ll send Sender 0 a one-click unsubscribe request\./),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Future emails: Sender 1 has no unsubscribe link, so we can’t send a request\./,
      ),
    ).toBeInTheDocument();
  });
});

/**
 * Founder report 2026-08-25. A Later preview on `ealerts.bankofamerica.com`
 * read "0 emails currently match" under a strip reading "200 in the last 90 days ·
 * 6,668 received", and the only way to find out where the mail actually
 * was, was to open Gmail.
 *
 * `mailLocationCopy` has its own suite in @declutrmail/shared. These cover
 * the JOIN — which verbs get the line, which suppress it, and what it is
 * handed — because a green producer suite and a mocked consumer can both
 * pass while the wiring between them is wrong (CLAUDE.md §8).
 */
describe('ConfirmActionModal — where the sender’s mail actually is', () => {
  /** Coherent counts: received ⊇ all-mail ⊇ inbox. */
  const coherent: CompositeActionPreviewResult = {
    ...livePreview,
    counts: { ...buckets, all: 4 },
    allMail: { counts: { ...allMailBuckets, all: 977 }, recentMessages: subjects },
  };
  const coherentSender = makeSender({ totalReceived: 1000 });

  it('partitions the mail on Later, summing to the "received" figure on the strip', () => {
    render(
      <ConfirmActionModal
        request={{ verb: 'Later', senders: [coherentSender] }}
        onCancel={() => {}}
        onConfirm={() => {}}
        compositePreview={coherent}
      />,
    );
    // 4 in inbox + 973 elsewhere + 23 binned = 1,000 received.
    expect(screen.getByTestId('mail-location-line')).toHaveTextContent(
      '4 in your inbox · 973 elsewhere in Gmail',
    );
  });

  it('says it on Archive too — the question is not Delete-specific', () => {
    render(
      <ConfirmActionModal
        request={{ verb: 'Archive', senders: [coherentSender] }}
        onCancel={() => {}}
        onConfirm={() => {}}
        compositePreview={coherent}
      />,
    );
    expect(screen.getByTestId('mail-location-line')).toBeInTheDocument();
  });

  it('stays silent against an API with no all-mail block (deploy skew)', () => {
    // `livePreview.allMail` is null. Half a split is a number with an
    // implied denominator — worse than no line at all.
    render(
      <ConfirmActionModal
        request={request('Later')}
        onCancel={() => {}}
        onConfirm={() => {}}
        compositePreview={livePreview}
      />,
    );
    expect(screen.queryByTestId('mail-location-line')).not.toBeInTheDocument();
  });

  it('yields to Delete’s reach hint rather than printing the same figure twice', () => {
    // ADR-0028 gives Delete chips that already name the archived count
    // and offer the control. Two lines, one number, a line apart.
    const emptyInbox: CompositeActionPreviewResult = {
      ...coherent,
      counts: { all: 0, olderThan30d: 0, olderThan90d: 0, olderThan180d: 0, olderThan365d: 0 },
    };
    render(
      <ConfirmActionModal
        request={{ verb: 'Delete', senders: [coherentSender] }}
        onCancel={() => {}}
        onConfirm={() => {}}
        compositePreview={emptyInbox}
      />,
    );
    expect(screen.getByText(/Turn on Include archived email to reach/)).toBeInTheDocument();
    expect(screen.queryByTestId('mail-location-line')).not.toBeInTheDocument();
  });

  it('stays silent on a bulk sheet, which has no per-sender all-mail set to split', () => {
    const second = makeSender({ id: 'sender-2', displayName: 'Beta Digest', email: 'b@beta.com' });
    render(
      <ConfirmActionModal
        request={{ verb: 'Archive', senders: [coherentSender, second] }}
        onCancel={() => {}}
        onConfirm={() => {}}
        bulkPreview={{
          data: {
            senders: [
              {
                senderId: coherentSender.id,
                name: coherentSender.name,
                counts: buckets,
                protected: false,
              },
              { senderId: second.id, name: second.name, counts: buckets, protected: false },
            ],
            totals: buckets,
            protectedCount: 0,
          },
          loading: false,
          error: false,
        }}
      />,
    );
    expect(screen.queryByTestId('mail-location-line')).not.toBeInTheDocument();
  });
});

/**
 * Prod 2026-08-25: an initial sync reissued every `senders.id`, so the
 * preview 404'd for ids the open page still held and "Retry preview"
 * refetched the same dead id forever. The id churn is fixed at the
 * source (`deriveSenderId`); this is the other half — a retry control
 * must only appear where retrying can change the outcome.
 */
describe('ConfirmActionModal — a preview failure that retrying cannot fix', () => {
  it('offers a way out instead of a retry that provably loops', () => {
    const onRetryPreview = vi.fn();
    const onRefreshSenders = vi.fn();
    render(
      <ConfirmActionModal
        request={request('Later')}
        onCancel={() => {}}
        onConfirm={() => {}}
        compositePreviewError={true}
        previewSenderGone={true}
        onRetryPreview={onRetryPreview}
        onRefreshSenders={onRefreshSenders}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Retry preview' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh senders' }));
    expect(onRefreshSenders).toHaveBeenCalledTimes(1);
    expect(onRetryPreview).not.toHaveBeenCalled();
  });

  it('names the stale list as the cause, not a generic load failure', () => {
    render(
      <ConfirmActionModal
        request={request('Later')}
        onCancel={() => {}}
        onConfirm={() => {}}
        compositePreviewError={true}
        previewSenderGone={true}
        onRefreshSenders={() => {}}
      />,
    );
    // Said once — the inline panel carries it; the footer stays empty
    // beside the Refresh senders button.
    expect(screen.getAllByText(/no email in this Gmail account anymore/)).toHaveLength(1);
    expect(screen.queryByText(/Couldn’t load the preview/)).not.toBeInTheDocument();
  });

  it('still offers Retry preview for a failure that MIGHT clear on its own', () => {
    // The mutual exclusion matters in both directions: a transient
    // network failure keeps the retry it can actually recover from.
    const onRetryPreview = vi.fn();
    render(
      <ConfirmActionModal
        request={request('Later')}
        onCancel={() => {}}
        onConfirm={() => {}}
        compositePreviewError={true}
        onRetryPreview={onRetryPreview}
        onRefreshSenders={() => {}}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Refresh senders' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry preview' }));
    expect(onRetryPreview).toHaveBeenCalledTimes(1);
  });

  it('keeps confirm locked in the gone state — nothing can be moved', () => {
    render(
      <ConfirmActionModal
        request={request('Later')}
        onCancel={() => {}}
        onConfirm={() => {}}
        compositePreviewError={true}
        previewSenderGone={true}
        onRefreshSenders={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /Later/ })).toBeDisabled();
  });
});

// Founder screenshot review 2026-08-27. Every finding below was visible
// on the live D226 preview and every one of them passed CI: the facts
// were individually true, so nothing asserted on what the ASSEMBLED
// screen claimed. These tests assert the assembly.
describe('ConfirmActionModal — composite preview tells one story (D226, D245)', () => {
  function renderComposite() {
    return render(
      <ConfirmActionModal
        request={request('Unsubscribe')}
        onCancel={() => {}}
        onConfirm={() => {}}
        compositePreview={livePreview}
        cleanupQuota={{ remaining: 49, resetsAt: '2026-09-01T00:00:00.000Z' }}
      />,
    );
  }

  it('says the backlog unsubscribe is free instead of charging a second action', () => {
    const { container } = renderComposite();
    expect(container.textContent).toContain('Unsubscribing is free and doesn’t count.');
    expect(container.textContent).not.toContain('Uses 2 of your 49');
    expect(container.textContent).not.toContain('past email uses a second one');
  });

  // Archive's `unchanged` facts are true standalone and false beside an
  // unsubscribe. Rendered verbatim, the screen ended "…sends a supported
  // one-click unsubscribe request. Also: … The sender is not unsubscribed."
  it('never claims the sender is not unsubscribed on an Unsubscribe preview', () => {
    const { container } = renderComposite();
    expect(container.textContent).not.toContain('The sender is not unsubscribed');
  });

  // Same class: the secondary's future-mail fact contradicts the primary's.
  it('never claims future email is unchanged when the primary unsubscribes', () => {
    const { container } = renderComposite();
    expect(container.textContent).not.toContain('Future email is unchanged');
  });

  // "unless you choose a separate action for it" is stale the moment a
  // backlog verb is picked — they already chose one.
  it('drops the "unless you choose a separate action" hedge once a backlog verb is picked', () => {
    const { container } = renderComposite();
    expect(container.textContent).not.toContain('unless you choose a separate action');
  });

  // The Details value follows the chooser: "Leave alone" is selected, so
  // "Stays where it is" is exact — the hedge was only needed while the
  // sentence had to cover both choices.
  it('says past email stays put when the backlog is left alone', () => {
    const onConfirm = vi.fn();
    const { container } = render(
      <ConfirmActionModal
        request={request('Unsubscribe')}
        onCancel={() => {}}
        onConfirm={onConfirm}
        compositePreview={livePreview}
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Unsubscribe only' }));
    expect(container.textContent).toContain('Email you already have stays where it is.');
    expect(screen.queryByText('Unsubscribing is free and doesn’t count.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Unsubscribe' }));
    expect(onConfirm).toHaveBeenCalledWith({
      secondary: null,
      archiveHistoric: false,
      senderIds: [sender.id],
    });
  });
});

describe('ConfirmActionModal — each fact is stated once (D226)', () => {
  function occurrences(haystack: string, needle: string): number {
    return haystack.split(needle).length - 1;
  }

  // Screenshot 1: the two-sentence lead under the title reappeared
  // verbatim inside the match card, because the unsub-alone branch
  // re-rendered `currentMail.summary` + the channel summary that the
  // lead paragraph had already assembled.
  it('states the unsubscribe effect once, not twice', () => {
    const { container } = render(
      <ConfirmActionModal
        request={request('Unsubscribe')}
        onCancel={() => {}}
        onConfirm={() => {}}
        compositePreview={livePreview}
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Unsubscribe only' }));
    expect(
      occurrences(container.textContent ?? '', 'Email you already have stays where it is.'),
    ).toBe(1);
  });

  // `recoveryFacts` emitted BOTH `activityUndo.summary` and
  // `finality.summary` for Unsubscribe — two spellings of one fact —
  // and the footer then printed the whole block again. Three prints of
  // "cannot be undone" on one screen. `staticActionPreviewCopy` already
  // skips finality for exactly this reason; this asserts the parity.
  it('states unsubscribe finality once per screen', () => {
    const { container } = render(
      <ConfirmActionModal
        request={request('Unsubscribe')}
        onCancel={() => {}}
        onConfirm={() => {}}
        compositePreview={livePreview}
        cleanupQuota={{ remaining: 49, resetsAt: null }}
      />,
    );
    const text = container.textContent ?? '';
    // One spelling survives — the note's, shared with Triage's sheet.
    // `activityUndo` and `finality` used to render back to back, twice over.
    expect(occurrences(text, 'can’t be recalled')).toBe(1);
    expect(occurrences(text, 'cannot be undone')).toBe(0);
    expect(occurrences(text, 'cannot be recalled')).toBe(0);
  });

  it.each(['Archive', 'Later', 'Delete'] as const)(
    'states the %s undo route once per screen',
    (verb) => {
      const { container } = render(
        <ConfirmActionModal
          request={request(verb)}
          onCancel={() => {}}
          onConfirm={() => {}}
          compositePreview={livePreview}
          cleanupQuota={{ remaining: 49, resetsAt: null }}
        />,
      );
      // Delete deliberately says "DeclutrMail Undo is available from
      // Activity…" so the next sentence can contrast Gmail Trash
      // recovery; Archive and Later say "Undo from Activity…".
      expect(occurrences(container.textContent ?? '', 'from Activity')).toBe(1);
    },
  );

  // One number, one phrasing. Archive alone once said "currently match
  // for Archive."; the composite said "currently match Archive action."
  it('phrases the match count the same way alone and as a backlog action', () => {
    const alone = render(
      <ConfirmActionModal
        request={request('Archive')}
        onCancel={() => {}}
        onConfirm={() => {}}
        compositePreview={livePreview}
      />,
    );
    expect(alone.container.textContent).toContain(
      'IncludesInbox only. We check again right before anything moves.',
    );
    alone.unmount();

    render(
      <ConfirmActionModal
        request={request('Unsubscribe')}
        onCancel={() => {}}
        onConfirm={() => {}}
        compositePreview={livePreview}
      />,
    );
    expect(screen.getByText(backlogMail('archive', 4))).toBeInTheDocument();
    expect(
      screen.queryByText('Inbox only. We check again right before anything moves.'),
    ).toBeNull();
  });
});

describe('ConfirmActionModal — unsubscribe has no current-match sample (D226)', () => {
  it('hides the sample when the backlog is left alone', () => {
    render(
      <ConfirmActionModal
        request={request('Unsubscribe')}
        onCancel={() => {}}
        onConfirm={() => {}}
        compositePreview={livePreview}
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Unsubscribe only' }));
    expect(screen.getByText('Email you already have stays where it is.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Show \d/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Check in Gmail/ })).toBeNull();
  });

  it('keeps the sample hidden once a backlog verb is picked', () => {
    render(
      <ConfirmActionModal
        request={request('Unsubscribe')}
        onCancel={() => {}}
        onConfirm={() => {}}
        compositePreview={livePreview}
        mailboxEmail="chintan.a.thakkar@gmail.com"
      />,
    );
    expect(screen.getByText(backlogMail('archive', 4))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Show \d/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Check in Gmail/ })).toBeNull();
  });
});

// QA-delete-20260829-02 — the title a reader sees before every other line on
// the surface named Delete without naming its actual destination, unlike
// Triage's equivalent header ("Move inbox email from X to Gmail Trash").
describe('ConfirmActionModal — Delete title names its destination', () => {
  it('says the mail moves to Gmail Trash, not just "Delete"', () => {
    render(
      <ConfirmActionModal
        request={request('Delete')}
        onCancel={() => {}}
        onConfirm={() => {}}
        compositePreview={livePreview}
      />,
    );
    // The stable title names the sender; the impact summary names the destination.
    expect(screen.getByRole('region', { name: 'Delete impact' })).toHaveTextContent(
      '1 email will move to Gmail Trash.',
    );
    expect(screen.getByRole('region', { name: 'Delete impact' })).toHaveTextContent(
      /move to Gmail Trash/,
    );
    expect(document.getElementById('dm-confirm-lead')).toHaveTextContent(
      'Future email is unchanged.',
    );
  });
});

// QA-archive-20260901-01: preserve the explicit action and live scope.
// Archive now names the sender in the title and states the live count once,
// in the impact summary beside the final action.
describe('ConfirmActionModal — Archive names the sender and previews the live impact (QA-archive-20260901-01)', () => {
  it('names the sender and puts the live email count in the impact summary', () => {
    render(
      <ConfirmActionModal
        request={request('Archive')}
        onCancel={() => {}}
        onConfirm={() => {}}
        compositePreview={livePreview}
      />,
    );
    expect(
      screen.getByRole('heading', { name: `Archive emails from ${sender.name}?` }),
    ).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Archive impact' })).toHaveTextContent(
      '4 emails will leave your inbox and stay in Gmail.',
    );
  });

  it('names the verb and the real sender count for a bulk selection', () => {
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
    render(
      <ConfirmActionModal
        request={bulkRequest}
        onCancel={() => {}}
        onConfirm={() => {}}
        bulkPreview={{ data: bulkData, loading: false, error: false }}
      />,
    );
    expect(
      screen.getByRole('heading', { name: 'Archive emails from 2 senders?' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Archive impact' })).toHaveTextContent(
      '4 emails will leave your inbox and stay in Gmail.',
    );
  });

  // Codex review 2026-09-03: `request.actionableCount` is a snapshot
  // stated by the caller before the live bulk preview resolved. If the
  // preview then independently flags one of those senders Protected, the
  // eyebrow/title must drop to the live actionable count — never the
  // stale caller-stated one — because that's the set
  // `enqueueBulkComposite` actually commits to.
  it('drops to the live actionable count when the bulk preview newly flags a sender Protected', () => {
    const second = makeSender({ id: 'sender-3', displayName: 'Gamma News', email: 'c@gamma.com' });
    const bulkRequest: ActionRequest = {
      verb: 'Archive',
      senders: [sender, second],
      actionableCount: 2,
    };
    const bulkData = {
      senders: [
        { senderId: sender.id, name: sender.name, counts: buckets, protected: true },
        { senderId: second.id, name: second.name, counts: buckets, protected: false },
      ],
      totals: buckets,
      protectedCount: 1,
    };
    render(
      <ConfirmActionModal
        request={bulkRequest}
        onCancel={() => {}}
        onConfirm={() => {}}
        bulkPreview={{ data: bulkData, loading: false, error: false }}
      />,
    );
    expect(
      screen.getByRole('heading', { name: 'Archive emails from 1 sender?' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Archive impact' })).toHaveTextContent(
      '4 emails will leave your inbox and stay in Gmail.',
    );
    expect(screen.queryByText(/2 senders/)).toBeNull();
    // …and the one it skipped is said once, in the note.
    expect(screen.getByText(/1 Protected sender is skipped\./)).toBeInTheDocument();
  });

  it('keeps cached inclusion out of the scope disclosure while preview refreshes', () => {
    const second = makeSender({ id: 'sender-refresh', displayName: 'Refresh Target' });
    render(
      <ConfirmActionModal
        request={{ verb: 'Archive', senders: [sender, second], selectedCount: 2 }}
        onCancel={() => {}}
        onConfirm={() => {}}
        bulkPreview={{
          data: {
            senders: [
              { senderId: sender.id, name: sender.name, counts: buckets, protected: false },
              { senderId: second.id, name: second.name, counts: buckets, protected: true },
            ],
            totals: buckets,
            protectedCount: 1,
          },
          loading: true,
          error: false,
        }}
      />,
    );
    const summary = screen.getByLabelText('Senders included in this bulk action');
    expect(summary).toBeVisible();
    expect(summary).toHaveTextContent('2 selected · Checking inclusion…');
    expect(summary).not.toHaveTextContent('in this preview');
    expect(summary).not.toHaveTextContent('Protected excluded');
    expect(screen.getByRole('button', { name: 'Archive' })).toBeDisabled();
  });

  it('shows selection without an endless inclusion check for a narrowed pure unsubscribe', () => {
    const oneClick = makeSender({ unsubscribeMethod: 'one_click' });
    render(
      <ConfirmActionModal
        request={{
          verb: 'Unsubscribe',
          senders: [oneClick],
          selectedCount: 2,
          skipped: { peopleCount: 1, protectedCount: 0 },
        }}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(screen.queryByLabelText('Senders included in this bulk action')).toBeNull();
    expect(screen.queryByText(/Checking inclusion/)).toBeNull();
    expect(
      screen.getByRole('heading', { name: 'Unsubscribe from Acme Newsletter?' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unsubscribe' })).toBeEnabled();
  });

  it('names unavailable inclusion without pretending a terminal preview failure is still loading', () => {
    const second = makeSender({ id: 'sender-unavailable' });
    render(
      <ConfirmActionModal
        request={{ verb: 'Archive', senders: [sender, second] }}
        onCancel={() => {}}
        onConfirm={() => {}}
        bulkPreview={{ data: undefined, loading: false, error: true }}
      />,
    );
    const summary = screen.getByLabelText('Senders included in this bulk action');
    expect(summary).toHaveTextContent('2 selected · Inclusion unavailable');
    expect(summary).not.toHaveTextContent('Checking inclusion');
    expect(screen.getByRole('button', { name: /^Archive$/ })).toBeDisabled();
  });

  it.each([
    { retained: true, skipped: 1 },
    { retained: false, skipped: 2 },
  ])(
    'counts protected skips once when the originally protected row is retained=$retained',
    ({ retained, skipped }) => {
      const protectedSender = makeSender({
        id: 'protected-sender',
        protectionFlags: {
          isProtected: retained,
          protectionReason: retained ? 'user_defined' : null,
          protectionSetAt: null,
        },
      });
      render(
        <ConfirmActionModal
          request={{
            verb: 'Delete',
            senders: [sender, protectedSender],
            selectedCount: retained ? 2 : 3,
            actionableCount: retained ? 1 : 2,
            // If retained=false, a different protected sender was dropped
            // upstream; this row became protected during the live preview.
            skipped: { protectedCount: 1, peopleCount: 0 },
          }}
          onCancel={() => {}}
          onConfirm={() => {}}
          bulkPreview={{
            data: {
              senders: [
                { senderId: sender.id, name: sender.name, counts: buckets, protected: false },
                {
                  senderId: protectedSender.id,
                  name: protectedSender.name,
                  counts: buckets,
                  protected: true,
                },
              ],
              totals: buckets,
              protectedCount: 1,
            },
            loading: false,
            error: false,
          }}
        />,
      );
      expect(screen.getByRole('region', { name: 'Delete impact' })).toHaveTextContent(
        '1 email will move to Gmail Trash.',
      );
      expect(
        screen.getByText(
          new RegExp(`${skipped} Protected sender${skipped === 1 ? ' is' : 's are'} skipped\\.`),
        ),
      ).toBeInTheDocument();
      expect(screen.getByLabelText('Senders included in this bulk action')).toBeVisible();
      expect(screen.getByLabelText('Senders included in this bulk action')).toHaveTextContent(
        `${retained ? 2 : 3} selected · 1 in this preview · ${skipped} Protected excluded`,
      );
    },
  );

  // Codex review 2026-09-03, round 2: `nothingToActOn` only blocks verbs
  // that move CURRENT inbox mail, and is deliberately silent for
  // Unsubscribe (it cuts future mail, not a count). But the live bulk
  // preview can independently resolve to zero actionable senders for ANY
  // bulk verb, Unsubscribe included, when every queued sender went
  // Protected since the request was built — nothing else caught that.
  it('blocks unsubscribe-only when every sender in the preview is Protected', () => {
    const one = makeSender({
      id: 'sender-u1',
      displayName: 'Weekly Digest',
      unsubscribeMethod: 'one_click',
    });
    const two = makeSender({
      id: 'sender-u2',
      displayName: 'Promo Blast',
      unsubscribeMethod: 'one_click',
    });
    const bulkRequest: ActionRequest = { verb: 'Unsubscribe', senders: [one, two] };
    const bulkData = {
      senders: [
        { senderId: one.id, name: one.name, counts: buckets, protected: true },
        { senderId: two.id, name: two.name, counts: buckets, protected: true },
      ],
      totals: buckets,
      protectedCount: 2,
    };
    const onConfirm = vi.fn();
    render(
      <ConfirmActionModal
        request={bulkRequest}
        onCancel={() => {}}
        onConfirm={onConfirm}
        bulkPreview={{ data: bulkData, loading: false, error: false }}
      />,
    );
    expect(screen.getByRole('radio', { name: '+ Archive 0' })).toBeDisabled();
    expect(
      screen.getByRole('heading', {
        name: 'All 2 selected senders are Protected. Remove their Protected status to include them.',
      }),
    ).toBeVisible();
    expect(screen.queryByText(/No sendable unsubscribe/)).toBeNull();
    const confirm = screen.getByRole('button', { name: 'Unsubscribe' });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  // Codex review 2026-09-03, round 3: `nothingActionableBulk` above only
  // becomes true once `bulkPreview.data` exists — it says nothing about
  // BEFORE that, and pure Unsubscribe was the one verb `requiresLivePreview`
  // deliberately excluded (D226's "moves nothing" exemption, correct for
  // the single-sender mailto path but not for bulk membership). So bulk
  // Unsubscribe confirm was reachable the instant the modal opened, before
  // the live preview had even started, let alone resolved — committing to
  // the stale queue count with no eligibility check at all.
  it('does not confirm unsubscribe only while the live preview is still loading', () => {
    const one = makeSender({
      id: 'sender-u3',
      displayName: 'Daily Roundup',
      unsubscribeMethod: 'one_click',
    });
    const two = makeSender({
      id: 'sender-u4',
      displayName: 'Flash Sale',
      unsubscribeMethod: 'one_click',
    });
    const bulkRequest: ActionRequest = {
      verb: 'Unsubscribe',
      senders: [one, two],
      actionableCount: 2,
    };
    const onConfirm = vi.fn();
    render(
      <ConfirmActionModal
        request={bulkRequest}
        onCancel={() => {}}
        onConfirm={onConfirm}
        bulkPreview={{ data: undefined, loading: true, error: false }}
      />,
    );
    expect(screen.getByRole('radio', { name: '+ Archive' })).toBeDisabled();
    expect(screen.queryByRole('radio', { name: /0 emails/ })).toBeNull();
    expect(screen.queryByText(/Loading preview/i)).toBeNull();
    const confirm = screen.getByRole('button', { name: 'Unsubscribe' });
    expect(confirm).toBeDisabled();
    fireEvent.keyDown(window, { key: 'Enter' });
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  // Codex review 2026-09-03, round 4: `nothingActionableBulk` treated
  // every non-Protected sender as actionable for Unsubscribe too, but
  // `enqueueBulkUnsubscribe` only counts CURRENT one-click senders — a
  // mailto sender is recorded, never sent. A mixed selection whose sole
  // one-click sender goes Protected leaves only a mailto row: not
  // Protected, so the old gate read it as 1 actionable and left confirm
  // enabled, but the server has zero executable senders and 409s
  // NO_ACTIONABLE_SENDERS.
  it('keeps a remaining mailto sender confirmable after the one-click sender is Protected', () => {
    const oneClick = makeSender({
      id: 'sender-u5',
      displayName: 'Weekly Newsletter',
      unsubscribeMethod: 'one_click',
    });
    const mailto = makeSender({
      id: 'sender-u6',
      displayName: 'Support Updates',
      unsubscribeMethod: 'mailto',
    });
    const bulkRequest: ActionRequest = { verb: 'Unsubscribe', senders: [oneClick, mailto] };
    const bulkData = {
      senders: [
        { senderId: oneClick.id, name: oneClick.name, counts: buckets, protected: true },
        { senderId: mailto.id, name: mailto.name, counts: buckets, protected: false },
      ],
      totals: buckets,
      protectedCount: 1,
    };
    const onConfirm = vi.fn();
    render(
      <ConfirmActionModal
        request={bulkRequest}
        onCancel={() => {}}
        onConfirm={onConfirm}
        bulkPreview={{ data: bulkData, loading: false, error: false }}
      />,
    );
    expect(screen.queryByText(/No sendable unsubscribe for these senders/)).toBeNull();
    expect(screen.queryByText(/Every selected sender is now Protected/)).toBeNull();
    expect(
      screen.getByText(
        /Future emails: we’ll open a prefilled email in Gmail for you to send to Support Updates\./,
      ),
    ).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: 'Unsubscribe + Archive' });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith({
      secondary: { type: 'archive', olderThanDays: null },
      archiveHistoric: true,
      senderIds: [mailto.id],
    });
  });

  it('offers a refresh when every sender of an Archive dropped out', () => {
    const a = makeSender({ id: 'sender-a1', displayName: 'Alpha' });
    const b = makeSender({ id: 'sender-b1', displayName: 'Beta' });
    const onRefreshSenders = vi.fn();
    render(
      <ConfirmActionModal
        request={{ verb: 'Archive', senders: [a, b] }}
        onCancel={() => {}}
        onConfirm={vi.fn()}
        onRefreshSenders={onRefreshSenders}
        bulkPreview={{
          data: {
            senders: [a, b].map((x) => ({
              senderId: x.id,
              name: x.name,
              counts: buckets,
              protected: true,
            })),
            totals: buckets,
            protectedCount: 2,
          },
          loading: false,
          error: false,
        }}
      />,
    );
    expect(
      screen.getByText('Every sender you picked is now Protected or has no email left.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh senders' }));
    expect(onRefreshSenders).toHaveBeenCalledTimes(1);
  });
});

// Founder report 2026-09-20 — "no clue if the request was submitted". The
// modal used to vanish BEFORE the request was sent, so a slow enqueue and
// an instant one looked identical.
describe('ConfirmActionModal — submitting', () => {
  it('holds the modal on "Submitting…", refuses a second confirm — and can still be left', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmActionModal
        request={request('Archive')}
        onCancel={onCancel}
        onConfirm={onConfirm}
        compositePreview={livePreview}
        submitting
      />,
    );
    expect(screen.getByRole('button', { name: /Submitting…/ })).toBeDisabled();
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
    expect(onConfirm).not.toHaveBeenCalled();
    // A request that hangs must never seal the user inside the overlay:
    // Cancel and Esc close the UI only; if the request lands, the rows say so.
    expect(screen.getByRole('button', { name: /Cancel/ })).toBeEnabled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

// Production-main parity: period and supported reach remain explicit even
// when the preview snapshot gives every option the same count.
describe('ConfirmActionModal — explicit period and scope choices', () => {
  const flat = { all: 7, olderThan30d: 7, olderThan90d: 7, olderThan180d: 7, olderThan365d: 7 };

  it.each(['Archive', 'Delete'] as const)(
    'keeps the %s period editable when all counts tie',
    (verb) => {
      const onConfirm = vi.fn();
      render(
        <ConfirmActionModal
          request={request(verb)}
          onCancel={() => {}}
          onConfirm={onConfirm}
          compositePreview={{ ...livePreview, counts: flat }}
        />,
      );
      const period = screen.getByRole('combobox', { name: /How far back|Email age/i });
      expect(period).toHaveValue(verb === 'Delete' ? '180' : 'all');
      fireEvent.click(
        screen.getByRole('button', {
          name: new RegExp(`^${verb}$`),
        }),
      );
      expect(onConfirm).toHaveBeenLastCalledWith(
        expect.objectContaining({ olderThanDays: verb === 'Delete' ? 180 : null }),
      );
      fireEvent.change(period, { target: { value: '365' } });
      fireEvent.click(
        screen.getByRole('button', {
          name: new RegExp(`^${verb}$`),
        }),
      );
      expect(onConfirm).toHaveBeenLastCalledWith(expect.objectContaining({ olderThanDays: 365 }));
    },
  );

  it('hides Include archived email when inbox and all-mail counts match', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmActionModal
        request={request('Delete')}
        onCancel={() => {}}
        onConfirm={onConfirm}
        compositePreview={{
          ...livePreview,
          counts: flat,
          allMail: { counts: flat, recentMessages: subjects },
        }}
      />,
    );
    expect(screen.queryByRole('checkbox', { name: 'Include archived email' })).toBeNull();
    expect(screen.queryByText('Both choices cover the same emails right now.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenLastCalledWith(expect.not.objectContaining({ reach: 'all_mail' }));
  });

  it.each(['archive', 'delete'] as const)(
    'defaults Unsubscribe + %s to all inbox mail even when age buckets tie',
    (secondary) => {
      const onConfirm = vi.fn();
      render(
        <ConfirmActionModal
          request={request('Unsubscribe')}
          onCancel={() => {}}
          onConfirm={onConfirm}
          compositePreview={{
            ...livePreview,
            counts: flat,
            allMail: { counts: flat, recentMessages: subjects },
          }}
        />,
      );
      expect(screen.getByRole('combobox', { name: /How far back|Email age/i })).toHaveValue('all');
      expect(screen.queryByRole('checkbox', { name: 'Include archived email' })).toBeNull();
      fireEvent.click(
        screen.getByRole('radio', {
          name: secondary === 'archive' ? '+ Archive 7' : '+ Delete 7',
        }),
      );
      fireEvent.click(
        screen.getByRole('button', {
          name: secondary === 'archive' ? 'Unsubscribe + Archive' : 'Unsubscribe + Delete 7 emails',
        }),
      );
      expect(onConfirm).toHaveBeenCalledWith({
        secondary: { type: secondary, olderThanDays: null },
        archiveHistoric: secondary === 'archive',
        senderIds: [sender.id],
      });
    },
  );

  it('titles a window-only zero with the window, and names the way out', () => {
    render(
      <ConfirmActionModal
        request={request('Delete')}
        onCancel={() => {}}
        onConfirm={() => {}}
        compositePreview={{
          ...livePreview,
          counts: { all: 9, olderThan30d: 9, olderThan90d: 0, olderThan180d: 0, olderThan365d: 0 },
        }}
      />,
    );
    expect(
      screen.getByRole('heading', { name: `Nothing older than 6 months from ${sender.name}` }),
    ).toBeInTheDocument();
    expect(document.getElementById('dm-confirm-lead')).toHaveTextContent(/Widen the window/);
    expect(screen.getByRole('combobox', { name: /How far back|Email age/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Delete/ })).toBeDisabled();
  });

  it('switches the count when a different window is chosen', () => {
    render(
      <ConfirmActionModal
        request={request('Delete')}
        onCancel={() => {}}
        onConfirm={() => {}}
        compositePreview={livePreview}
      />,
    );
    expect(screen.getByRole('region', { name: 'Delete impact' })).toHaveTextContent(
      '1 email will move to Gmail Trash.',
    );
    fireEvent.change(screen.getByRole('combobox', { name: /How far back|Email age/i }), {
      target: { value: '30' },
    });
    expect(screen.getByRole('region', { name: 'Delete impact' })).toHaveTextContent(
      '3 emails will move to Gmail Trash.',
    );
    expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled();
  });
});

describe('ConfirmActionModal — Senders Archive layout A', () => {
  it('keeps Email age visible at Any age even with an empty inbox', () => {
    render(
      <ConfirmActionModal
        request={request('Archive')}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        compositePreview={{
          ...livePreview,
          counts: { all: 0, olderThan30d: 0, olderThan90d: 0, olderThan180d: 0, olderThan365d: 0 },
        }}
      />,
    );
    expect(screen.getByRole('combobox', { name: 'Email age' })).toHaveValue('all');
    expect(screen.getByRole('button', { name: 'Archive' })).toBeDisabled();
  });

  it('keeps Any age and inbox-only submission even when archived email is available', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmActionModal
        request={request('Archive')}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
        compositePreview={livePreviewWithAllMail}
      />,
    );
    expect(screen.getByRole('combobox', { name: 'Email age' })).toHaveValue('all');
    expect(screen.queryByRole('checkbox', { name: 'Include archived email' })).toBeNull();
    expect(document.querySelector('time[datetime]')).toBeNull();
    const impact = screen.getByRole('region', { name: 'Archive impact' });
    expect(impact).toHaveTextContent('4 emails will leave your inbox and stay in Gmail.');
    expect(impact).toHaveTextContent('Inbox only · Any age');
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription(
      /4 emails will leave your inbox and stay in Gmail/,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(onConfirm).toHaveBeenCalledWith({ olderThanDays: null, archiveHistoric: false });
  });

  it('keeps age editable after a zero match and restores the default on reopen', () => {
    const pending = request('Archive');
    const props = { request: pending, onCancel: vi.fn(), onConfirm: vi.fn() };
    const preview = { ...livePreview, counts: { ...buckets, olderThan365d: 0 } };
    const { rerender } = render(<ConfirmActionModal {...props} compositePreview={preview} />);
    const age = screen.getByRole('combobox', { name: 'Email age' });
    fireEvent.change(age, { target: { value: '365' } });
    expect(
      screen.getByRole('heading', {
        name: `No emails older than 1 year from ${sender.name}`,
      }),
    ).toBeVisible();
    expect(screen.getByRole('region', { name: 'Archive impact' })).toHaveTextContent(
      'No emails match this scope.',
    );
    expect(screen.getByRole('button', { name: 'Archive' })).toBeDisabled();
    expect(document.querySelector('time[datetime]')).not.toBeNull();
    fireEvent.change(age, { target: { value: '30' } });
    expect(screen.getByRole('region', { name: 'Archive impact' })).toHaveTextContent(
      '3 emails will leave your inbox and stay in Gmail.',
    );
    expect(screen.getByRole('button', { name: 'Archive' })).toBeEnabled();
    rerender(<ConfirmActionModal {...props} request={null} compositePreview={preview} />);
    rerender(<ConfirmActionModal {...props} compositePreview={preview} />);
    expect(screen.getByRole('combobox', { name: 'Email age' })).toHaveValue('all');
  });

  it('hides cached counts and blocks confirmation while the live preview is unavailable', () => {
    const props = { request: request('Archive'), onCancel: vi.fn(), onConfirm: vi.fn() };
    const { rerender } = render(<ConfirmActionModal {...props} compositePreview={livePreview} />);
    rerender(
      <ConfirmActionModal {...props} compositePreview={livePreview} compositePreviewLoading />,
    );
    expect(screen.queryByRole('region', { name: 'Archive impact' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Archive' })).toBeDisabled();
    rerender(
      <ConfirmActionModal {...props} compositePreview={livePreview} compositePreviewError />,
    );
    expect(screen.queryByRole('region', { name: 'Archive impact' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Archive' })).toBeDisabled();
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
    expect(props.onConfirm).not.toHaveBeenCalled();
  });
});

describe('ConfirmActionModal — Delete layout A and other actions', () => {
  it('keeps the 180-day inbox-only payload while showing one impact and a short button', () => {
    const onConfirm = vi.fn();
    const before = Date.now();
    render(
      <ConfirmActionModal
        request={request('Delete')}
        onCancel={() => {}}
        onConfirm={onConfirm}
        compositePreview={livePreviewWithAllMail}
      />,
    );
    expect(
      screen.getByRole('heading', { name: `Delete emails from ${sender.name}?` }),
    ).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Email age' })).toHaveValue('180');
    expect(screen.getByRole('option', { name: 'Older than 180 days' })).toBeVisible();
    expect(screen.getByRole('option', { name: 'Older than 90 days' })).toBeVisible();
    expect(screen.getByRole('checkbox', { name: 'Include archived email' })).not.toBeChecked();
    const impact = screen.getByRole('region', { name: 'Delete impact' });
    expect(impact).toHaveTextContent('1 email will move to Gmail Trash.');
    expect(impact).toHaveTextContent('Inbox only · Older than 180 days');
    expect(screen.getAllByText('1 email will move to Gmail Trash.')).toHaveLength(1);
    expect(screen.getByRole('alertdialog')).toHaveAccessibleDescription(
      /1 email will move to Gmail Trash/,
    );
    const cutoff = Date.parse(document.querySelector('time[datetime]')!.getAttribute('datetime')!);
    expect(cutoff).toBeGreaterThanOrEqual(before - 180 * 86_400_000);
    expect(cutoff).toBeLessThanOrEqual(Date.now() - 180 * 86_400_000);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledWith({ olderThanDays: 180, archiveHistoric: false });
  });

  it('removes the impact during a stale refetch and reports only the fresh count', () => {
    const pending = request('Delete');
    const props = { request: pending, onCancel: vi.fn(), onConfirm: vi.fn() };
    const { rerender } = render(<ConfirmActionModal {...props} compositePreview={livePreview} />);
    expect(screen.getByRole('region', { name: 'Delete impact' })).toHaveTextContent('1 email');
    rerender(
      <ConfirmActionModal {...props} compositePreview={livePreview} compositePreviewLoading />,
    );
    expect(screen.queryByRole('region', { name: 'Delete impact' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
    rerender(
      <ConfirmActionModal
        {...props}
        compositePreview={{ ...livePreview, counts: { ...buckets, olderThan180d: 2 } }}
      />,
    );
    expect(screen.getByRole('region', { name: 'Delete impact' })).toHaveTextContent(
      '2 emails will move to Gmail Trash.',
    );
  });

  it.each(['Unsubscribe', 'Later'] as const)('keeps %s on its existing presentation', (verb) => {
    render(
      <ConfirmActionModal
        request={request(verb)}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        compositePreview={livePreview}
      />,
    );
    expect(screen.queryByRole('region', { name: 'Delete impact' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Email age' })).toBeNull();
    if (verb !== 'Later')
      expect(screen.getByRole('combobox', { name: /How far back/i })).toHaveValue('all');
  });
});

it('records a loaded preview once, not loading, failed, or closed renders', () => {
  track.mockClear();
  const props = { request: request('Archive'), onConfirm: vi.fn(), onCancel: vi.fn() };
  const { rerender } = render(<ConfirmActionModal {...props} />);
  expect(track).not.toHaveBeenCalled();
  rerender(<ConfirmActionModal {...props} compositePreviewError />);
  expect(track).not.toHaveBeenCalled();
  rerender(<ConfirmActionModal {...props} compositePreview={livePreview} />);
  rerender(<ConfirmActionModal {...props} compositePreview={livePreview} />);
  expect(track).toHaveBeenCalledExactlyOnceWith('action_preview_viewed', {
    verb: 'archive',
    journey: 'daily',
  });
  rerender(<ConfirmActionModal {...props} request={null} />);
  rerender(<ConfirmActionModal {...props} compositePreview={livePreview} />);
  expect(track).toHaveBeenCalledTimes(2);
});
