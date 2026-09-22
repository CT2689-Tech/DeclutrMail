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

    expect(screen.getByText(/rechecked when it runs/)).toBeInTheDocument();
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

    expect(screen.getByRole('heading', { name: 'Archive 1 email?' })).toBeInTheDocument();
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
      screen.getByText(/Uses 1 of your 12 cleanup actions left this month/),
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
      screen.getByText(/This needs 2 cleanup actions but only 1 is left this month/),
    ).toBeInTheDocument();
    // No enabled confirm anywhere; the primary CTA is the upgrade action.
    expect(screen.queryByRole('button', { name: /Archive 2 senders|^📥/ })).not.toBeInTheDocument();
    const upgrade = screen.getByRole('button', { name: /Upgrade for unlimited cleanup/ });
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
    expect(screen.getByRole('heading', { name: 'Archive 4 emails?' })).toBeInTheDocument();
    expect(screen.queryByText(/from 40 senders/)).not.toBeInTheDocument();
    expect(screen.getByText(/1 of 40 eligible senders/)).toBeInTheDocument();
    expect(screen.getByText(/all you have left this month/)).toBeInTheDocument();
    // The whole point: confirm is live, and firing it calls through.
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
    expect(onConfirm).toHaveBeenCalled();
    expect(
      screen.queryByRole('button', { name: /Upgrade for unlimited cleanup/ }),
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
    expect(screen.getByText(/2 of 4 eligible senders/)).toBeInTheDocument();
    expect(screen.queryByText(/4 senders you selected/)).not.toBeInTheDocument();
    // The title is the acted-on count, stated by the caller.
    expect(
      screen.getByRole('heading', { name: 'Archive 4 emails from 2 senders?' }),
    ).toBeInTheDocument();
    // And the scope line keeps the real selection total intact.
    expect(screen.getByLabelText('Senders included in this bulk action')).toHaveTextContent(
      '5 selected, 4 eligible, 1 skipped',
    );
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
    expect(screen.getAllByText(/Couldn't load the preview/i)).toHaveLength(1);
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
    expect(screen.getAllByText(/Couldn't load the preview/i)).toHaveLength(1);
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

    expect(screen.getByText(/^Inbox now, rechecked when it runs$/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Show 1 of 4$/ })).toBeInTheDocument();
    expect(screen.queryByText(/will move to Archive/i)).not.toBeInTheDocument();
    // In the collapsed Details disclosure (ADR-0042) — present, one click away.
    expect(
      screen.getByRole('note', { name: 'Gmail account: active@gmail.com' }),
    ).toBeInTheDocument();
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

    expect(screen.getByText(/past email uses a second one/i)).toBeInTheDocument();
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

    // D245: the exact reason, not just the state.
    expect(screen.getByText(/This action applies anyway/)).toHaveTextContent(
      /Protected — you marked it Protected/,
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
      'Archive them',
      /Unsubscribe and archive 4 emails\?/,
      'Moves out of your inbox, stays in Gmail',
    ],
    ['Delete them', /Unsubscribe and delete 4 emails\?/, 'Email in Inbox moves to Gmail Trash'],
  ] as const)(
    'renders real copy for the backlog verb when %s is picked',
    (label, heading, backlogFact) => {
      const { container } = render(
        <ConfirmActionModal
          request={request('Unsubscribe')}
          onCancel={() => {}}
          onConfirm={() => {}}
          compositePreview={livePreview}
        />,
      );

      fireEvent.click(screen.getByRole('radio', { name: label }));

      expect(container.textContent).not.toContain('[object Object]');
      expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
      expect(container.textContent).toContain(backlogFact);
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
  // renders as "N in last 90d", so the modal and the card that opened it
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
    expect(screen.queryByRole('combobox', { name: /How far back/i })).toBeNull();
    // …and drops the qualifier that described the now-absent control.
    expect(screen.queryByText(/older than 180 days/)).toBeNull();
  });

  it('names the window on the arrival figure and never renders a bare /mo', () => {
    const { container } = renderDelete(emptyInbox, 71);
    expect(container.textContent).toMatch(/71\s*in last 90d/);
    // "/mo" is the retired unit (ADR-0037). A number with no window is
    // how the card's 396 and the modal's 134 coexisted for one sender.
    expect(container.textContent).not.toMatch(/\/mo/);
  });

  it('carries the received total so the arrival figure has a denominator', () => {
    const { container } = renderDelete(emptyInbox, 71);
    // Same two facts, same words, as the senders card that opened this
    // modal: "N in last 90d · N received" (sender-card.tsx).
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
    expect(container.textContent).toMatch(/—\s*in last 90d/);
    expect(container.textContent).not.toMatch(/0\s*in last 90d/);
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
    expect(screen.getByRole('combobox', { name: /How far back/i })).toBeTruthy();
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
describe('ConfirmActionModal — composite notice names the acting verb', () => {
  const emptyPreview = {
    ...livePreview,
    counts: { all: 0, olderThan30d: 0, olderThan90d: 0, olderThan180d: 0, olderThan365d: 0 },
  };

  it.each([
    ['Delete them', 'Delete'],
    ['Archive them', 'Archive'],
  ])('names %s as the verb the zero belongs to', (chip, expectedVerb) => {
    render(
      <ConfirmActionModal
        request={request('Unsubscribe')}
        onCancel={() => {}}
        onConfirm={() => {}}
        compositePreview={emptyPreview}
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: chip }));

    expect(
      screen.getByText(new RegExp(`\\. ${expectedVerb} only acts on email still in the inbox\\.$`)),
    ).toBeTruthy();
    expect(screen.queryByText(/Unsubscribe only acts on email still in the inbox/)).toBeNull();
    // The primary still does real work, so confirm stays available.
    expect(screen.getByRole('button', { name: /Unsubscribe/ })).toBeEnabled();
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
    expect(screen.getByRole('combobox', { name: /How far back/i })).toBeTruthy();
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
  const reachRow = () => screen.queryByRole('radiogroup', { name: /Where it applies/i });

  it('offers no reach choice against an API without the allMail block', () => {
    render(
      <ConfirmActionModal
        request={request('Delete')}
        onCancel={() => {}}
        onConfirm={() => {}}
        compositePreview={livePreview}
      />,
    );
    expect(reachRow()).toBeNull();
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

  it('defaults Delete to Inbox only and labels both chips with window-scoped counts', () => {
    render(
      <ConfirmActionModal
        request={request('Delete')}
        onCancel={() => {}}
        onConfirm={() => {}}
        compositePreview={livePreviewWithAllMail}
      />,
    );
    const inboxChip = screen.getByRole('radio', { name: /Inbox only/ });
    const archivedChip = screen.getByRole('radio', { name: /Inbox \+ archived/ });
    expect(inboxChip).toHaveAttribute('aria-checked', 'true');
    expect(archivedChip).toHaveAttribute('aria-checked', 'false');
    // Delete defaults to the 180d window — each chip carries ITS reach's
    // count for that window, so the pair is comparable at a glance.
    expect(inboxChip.textContent).toContain('1');
    expect(archivedChip.textContent).toContain('700');
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

    fireEvent.click(screen.getByRole('radio', { name: /Inbox \+ archived/ }));
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
    fireEvent.click(screen.getByRole('radio', { name: /Inbox \+ archived/ }));
    // 180d default window over the all-mail buckets — the figure appears
    // on both the chip and the title, so assert the pair.
    expect(screen.getByRole('heading', { name: 'Delete 700 emails?' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Inbox \+ archived/ })).toHaveTextContent('700');
    expect(screen.getByText(/^Inbox \+ archived now.*rechecked when it runs$/)).toBeInTheDocument();
    // The un-windowed option stops claiming "inbox" once the reach is wider.
    expect(screen.getByRole('option', { name: /All mail/ })).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('radio', { name: /Inbox \+ archived/ }));
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
    expect(screen.queryByRole('combobox', { name: /How far back/i })).toBeNull();
    expect(reachRow()).not.toBeNull();
    expect(
      screen.getByText(/Switch to "Inbox \+ archived" to reach 977 archived emails\./),
    ).toBeInTheDocument();
    // With the reach control on screen, the notice must NOT claim Delete
    // "only acts on" inbox mail — the next sentence disproves it.
    expect(screen.getByText(/Delete acts on inbox email by default/)).toBeInTheDocument();
    expect(screen.queryByText(/only acts on email still in the inbox/)).toBeNull();
    // Flipping the chip clears the inbox-scope narration AND arms the
    // exact figure the chip advertised: the hidden 180d default resets
    // to "All mail", so the user gets 977, not a silently-shaved 700.
    fireEvent.click(screen.getByRole('radio', { name: /Inbox \+ archived/ }));
    expect(screen.queryByText(/in your inbox now/)).toBeNull();
    expect((screen.getByRole('option', { name: /All mail/ }) as HTMLOptionElement).selected).toBe(
      true,
    );
    expect(screen.getByRole('heading', { name: 'Delete 977 emails?' })).toBeInTheDocument();
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
    // Scope stays inspectable even at zero; neither selection can arm a
    // mutation without matching mail.
    expect(reachRow()).not.toBeNull();
    expect(screen.getByRole('heading', { name: /Nothing in your inbox from/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Delete/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: /Inbox \+ archived/ }));
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
    fireEvent.click(screen.getByRole('radio', { name: /Inbox \+ archived/ }));
    expect(screen.getByRole('radio', { name: /Inbox \+ archived/ })).toHaveAttribute(
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
    expect(screen.getByRole('radio', { name: /Inbox only/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
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
describe('ConfirmActionModal — ADR-0028 reach on the Unsubscribe+Delete secondary', () => {
  it('offers no reach choice while the secondary is Leave alone or Archive', () => {
    render(
      <ConfirmActionModal
        request={request('Unsubscribe')}
        onCancel={() => {}}
        onConfirm={() => {}}
        compositePreview={livePreviewWithAllMail}
      />,
    );
    expect(screen.queryByRole('radiogroup', { name: /Where it applies/i })).toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: 'Archive them' }));
    expect(screen.queryByRole('radiogroup', { name: /Where it applies/i })).toBeNull();
  });

  it('offers the reach chip once "Delete them" is chosen, and reads the all-mail count', () => {
    render(
      <ConfirmActionModal
        request={request('Unsubscribe')}
        onCancel={() => {}}
        onConfirm={() => {}}
        compositePreview={livePreviewWithAllMail}
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Delete them' }));

    const inboxChip = screen.getByRole('radio', { name: /Inbox only/ });
    const archivedChip = screen.getByRole('radio', { name: /Inbox \+ archived/ });
    expect(inboxChip).toHaveAttribute('aria-checked', 'true');
    // Defaults to inbox-only, same safe default as primary Delete. The
    // secondary's window defaults to "All" (unwindowed), so this is the
    // full inbox bucket (`buckets.all` = 4), not a 180d-narrowed figure.
    expect(screen.getByText(/^Inbox now, rechecked when it runs$/)).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Unsubscribe and delete 4 emails?' }),
    ).toBeInTheDocument();
    expect(inboxChip).toHaveTextContent('4');

    fireEvent.click(archivedChip);
    expect(archivedChip).toHaveAttribute('aria-checked', 'true');
    // "977" on the title and on the chip's own badge.
    expect(
      screen.getByRole('heading', { name: 'Unsubscribe and delete 977 emails?' }),
    ).toBeInTheDocument();
    expect(archivedChip).toHaveTextContent('977');
  });

  it('forwards secondary.reach only when Delete them is the active secondary at all-mail reach', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmActionModal
        request={request('Unsubscribe')}
        onCancel={() => {}}
        onConfirm={onConfirm}
        compositePreview={livePreviewWithAllMail}
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Delete them' }));
    fireEvent.click(screen.getByRole('button', { name: /Unsubscribe/ }));
    expect(onConfirm).toHaveBeenLastCalledWith(expect.not.objectContaining({ reach: 'all_mail' }));

    fireEvent.click(screen.getByRole('radio', { name: /Inbox \+ archived/ }));
    fireEvent.click(screen.getByRole('button', { name: /Unsubscribe/ }));
    expect(onConfirm).toHaveBeenLastCalledWith(
      expect.objectContaining({
        reach: 'all_mail',
        secondary: expect.objectContaining({ type: 'delete' }),
      }),
    );
  });

  it('drops the reach choice again once the secondary switches away from Delete', () => {
    render(
      <ConfirmActionModal
        request={request('Unsubscribe')}
        onCancel={() => {}}
        onConfirm={() => {}}
        compositePreview={livePreviewWithAllMail}
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Delete them' }));
    fireEvent.click(screen.getByRole('radio', { name: /Inbox \+ archived/ }));
    fireEvent.click(screen.getByRole('radio', { name: 'Archive them' }));
    expect(screen.queryByRole('radiogroup', { name: /Where it applies/i })).toBeNull();
    // The count shown for Archive is the inbox-only bucket (`buckets.all`
    // = 4), not a stale all-mail figure left over from the Delete chip
    // choice.
    expect(screen.getByText(/^Inbox now, rechecked when it runs$/)).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Unsubscribe and archive 4 emails?' }),
    ).toBeInTheDocument();
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
  const reachRow = () => screen.queryByRole('radiogroup', { name: /Where it applies/i });

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
    // Each chip carries the AGGREGATE for its reach at the default window.
    const archived = screen.getByRole('radio', { name: /Inbox \+ archived/ });
    expect(archived).toHaveTextContent((allMailBuckets.olderThan180d * 2).toLocaleString('en-US'));

    fireEvent.click(screen.getByRole('button', { name: /Delete/ }));
    expect(onConfirm).toHaveBeenLastCalledWith(expect.not.objectContaining({ reach: 'all_mail' }));

    expect(screen.getByText('They move to Gmail Trash.')).toBeInTheDocument();
    fireEvent.click(archived);
    expect(screen.getByText(/^Inbox \+ archived now.*rechecked when it runs$/)).toBeInTheDocument();
    // The subtitle follows the chip — it must not keep describing inbox mail only.
    expect(screen.queryByText('They move to Gmail Trash.')).toBeNull();
    expect(
      screen.getByText(/Inbox and archived email both move to Gmail Trash/),
    ).toBeInTheDocument();
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

  it('re-arms Inbox only when "Delete them" is re-chosen after switching away', () => {
    const senders = [oneClickSender, secondOneClick];
    render(
      <ConfirmActionModal
        request={{ verb: 'Unsubscribe', senders }}
        onCancel={() => {}}
        onConfirm={() => {}}
        bulkPreview={{ data: bulkDataFor(senders, true), loading: false, error: false }}
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Delete them' }));
    fireEvent.click(screen.getByRole('radio', { name: /Inbox \+ archived/ }));
    fireEvent.click(screen.getByRole('radio', { name: 'Archive them' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Delete them' }));
    // The wider destructive scope is never carried over silently.
    expect(screen.getByRole('radio', { name: /Inbox only/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('offers no bulk reach choice against an API without the all-mail totals', () => {
    const senders = [sender, second];
    render(
      <ConfirmActionModal
        request={{ verb: 'Delete', senders }}
        onCancel={() => {}}
        onConfirm={() => {}}
        bulkPreview={{ data: bulkDataFor(senders, false), loading: false, error: false }}
      />,
    );
    expect(reachRow()).toBeNull();
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

  it('offers the reach choice on a bulk Unsubscribe only once "Delete them" is chosen', () => {
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
    fireEvent.click(screen.getByRole('radio', { name: 'Delete them' }));
    expect(reachRow()).not.toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: /Inbox \+ archived/ }));
    // The headline names the widened scope on the secondary path too.
    expect(screen.getByText(/^Inbox \+ archived now.*rechecked when it runs$/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Unsubscribe/ }));
    expect(onConfirm).toHaveBeenLastCalledWith(
      expect.objectContaining({
        reach: 'all_mail',
        secondary: expect.objectContaining({ type: 'delete' }),
      }),
    );
  });
});

// ─────────────── D248 — per-channel unsubscribe preview ────────────────
describe('ConfirmActionModal — unsubscribe capability breakdown (D248)', () => {
  function unsubRequest(methods: Array<'one_click' | 'mailto' | 'none' | null>): ActionRequest {
    return {
      verb: 'Unsubscribe',
      senders: methods.map((unsubscribeMethod, i) =>
        makeSender({ id: `s-${i}`, displayName: `Sender ${i}`, unsubscribeMethod }),
      ),
    };
  }

  function breakdown(): string {
    return screen.getByLabelText('Unsubscribe breakdown').textContent ?? '';
  }

  it('breaks a mixed selection down per state instead of one aggregate', () => {
    render(
      <ConfirmActionModal
        request={unsubRequest(['one_click', 'one_click', 'mailto', 'mailto', 'none', null])}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );

    const text = breakdown();
    expect(text).toContain('2 senders, we unsubscribe for you');
    expect(text).toContain('2 senders, you send the email yourself');
    expect(text).toMatch(/No unsubscribe1 sender(?!s)/);
    expect(text).toMatch(/Not checked yet1 sender(?!s)/);
    // No single figure may span the four groups.
    expect(text).not.toContain('6 senders');
  });

  // The regression this decision exists to prevent: an un-indexed
  // sender must never be described as offering no unsubscribe.
  it('reads an un-indexed sender as not-yet-checked, never as no-channel', () => {
    render(
      <ConfirmActionModal
        request={unsubRequest(['one_click', null, null])}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );

    const text = breakdown();
    expect(text).toMatch(/Not checked yet2 senders/);
    expect(text).not.toContain('No unsubscribe');
  });

  // The zero-one-click gate is a BATCH rule. At n=1 this modal is also
  // the mandatory preview for the single-sender flow — the only path
  // that produces D230's compose hand-off — so gating it there would
  // disable confirm for a mailto sender whose row control correctly
  // invited the user in, and claim no channel exists when one does.
  it('still confirms a single mailto sender — the compose hand-off lives there', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmActionModal
        request={unsubRequest(['mailto'])}
        onCancel={() => {}}
        onConfirm={onConfirm}
      />,
    );

    const confirm = screen.getByRole('button', { name: /Unsubscribe/ });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/No sendable unsubscribe for these senders/)).toBeNull();
    // It still says what will happen: the user sends this one.
    expect(document.getElementById('dm-confirm-lead')?.textContent).toContain(
      'DeclutrMail opens a prefilled Gmail draft; you send it.',
    );
  });

  it('does not offer the action when the selection has no one-click sender', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmActionModal
        request={unsubRequest(['mailto', 'none', null])}
        onCancel={() => {}}
        onConfirm={onConfirm}
      />,
    );

    const confirm = screen.getByRole('button', { name: /Unsubscribe/ });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText(/No sendable unsubscribe for these senders/)).toBeInTheDocument();
  });

  it('offers the action as soon as one sender is one-click', () => {
    const onConfirm = vi.fn();
    const request = unsubRequest(['one_click', 'mailto', null]);
    render(
      <ConfirmActionModal
        request={request}
        onCancel={() => {}}
        onConfirm={onConfirm}
        // Codex review 2026-09-03 round 3: bulk Unsubscribe now requires
        // the live bulk preview before confirm unlocks (the real caller,
        // senders-screen.tsx, always supplies one for bulk Unsubscribe —
        // "Unsubscribe also starts this read in the background").
        bulkPreview={{
          data: {
            senders: request.senders.map((s) => ({
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

    const confirm = screen.getByRole('button', { name: /Unsubscribe/ });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('describes the one-click request the batch will actually send', () => {
    render(
      <ConfirmActionModal
        request={unsubRequest(['one_click', 'none'])}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );

    expect(document.getElementById('dm-confirm-lead')?.textContent).toContain(
      'DeclutrMail sends a supported one-click unsubscribe request',
    );
  });
});

/**
 * Founder report 2026-08-25. A Later preview on `ealerts.bankofamerica.com`
 * read "0 emails currently match" under a strip reading "200 in last 90d ·
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
      '4 in your inbox · 973 elsewhere in Gmail · 23 in Trash or Spam',
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
    expect(screen.getByText(/Switch to "Inbox \+ archived"/)).toBeInTheDocument();
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
    expect(screen.getAllByText(/no longer in this mailbox/)).toHaveLength(1);
    expect(screen.queryByText(/Couldn't load the preview/)).not.toBeInTheDocument();
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
  function renderComposite(backlog: 'Archive them' | 'Delete them' = 'Archive them') {
    const view = render(
      <ConfirmActionModal
        request={request('Unsubscribe')}
        onCancel={() => {}}
        onConfirm={() => {}}
        compositePreview={livePreview}
        cleanupQuota={{ remaining: 49, resetsAt: '2026-09-01T00:00:00.000Z' }}
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: backlog }));
    return view;
  }

  // The server charges two units for an unsubscribe carrying a backlog
  // action (`includesBacklogAction ? 2 : 1`), and the modal's own chip
  // row said so — while the footer eight lines below said "Uses 1".
  // A Free user with one action left read a preview promising it fits.
  it('counts the backlog action in the quota the footer states', () => {
    const { container } = renderComposite();
    expect(container.textContent).toContain('Uses 2 of your 49 cleanup actions left this month');
    expect(container.textContent).not.toContain('Uses 1 of your 49');
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
    const { container } = render(
      <ConfirmActionModal
        request={request('Unsubscribe')}
        onCancel={() => {}}
        onConfirm={() => {}}
        compositePreview={livePreview}
      />,
    );
    expect(container.textContent).toContain('Past emailStays where it is');
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
    expect(occurrences(container.textContent ?? '', 'Stays where it is')).toBe(1);
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
    expect(alone.container.textContent).toContain('CountInbox now, rechecked when it runs');
    alone.unmount();

    render(
      <ConfirmActionModal
        request={request('Unsubscribe')}
        onCancel={() => {}}
        onConfirm={() => {}}
        compositePreview={livePreview}
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Archive them' }));
    expect(screen.getByText(/^Inbox now, rechecked when it runs$/)).toBeInTheDocument();
  });
});

describe('ConfirmActionModal — the sample panel covers only mail that moves (D226)', () => {
  // "Show what currently matches (5 of 4)" rendered on an Unsubscribe
  // with the backlog left alone — inviting inspection of mail the
  // action will not touch.
  it('hides the current-match sample when the backlog is left alone', () => {
    render(
      <ConfirmActionModal
        request={request('Unsubscribe')}
        onCancel={() => {}}
        onConfirm={() => {}}
        compositePreview={livePreview}
      />,
    );
    expect(screen.queryByRole('button', { name: /^Show \d/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Check in Gmail/ })).toBeNull();
  });

  it('shows it again once a backlog verb is picked', () => {
    render(
      <ConfirmActionModal
        request={request('Unsubscribe')}
        onCancel={() => {}}
        onConfirm={() => {}}
        compositePreview={livePreview}
        mailboxEmail="chintan.a.thakkar@gmail.com"
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Archive them' }));
    expect(screen.getByRole('button', { name: /^Show \d/ })).toBeInTheDocument();
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
    // The count is the title; the destination is the sentence under it.
    expect(screen.getByRole('heading', { name: 'Delete 1 email?' })).toBeInTheDocument();
    expect(document.getElementById('dm-confirm-lead')).toHaveTextContent(/move to Gmail Trash/);
  });
});

// QA-archive-20260901-01: this modal's eyebrow was the one D226 preview
// surface that dropped the verb entirely ("Preview · before anything
// changes"), while Triage's identical sheets both name it. Shares the
// same `n` the H3 title one line below already states, so the two never
// drift from each other.
describe('ConfirmActionModal — the title names the verb and the count (QA-archive-20260901-01)', () => {
  it('names the verb and the live email count for a single sender', () => {
    render(
      <ConfirmActionModal
        request={request('Archive')}
        onCancel={() => {}}
        onConfirm={() => {}}
        compositePreview={livePreview}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Archive 4 emails?' })).toBeInTheDocument();
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
      screen.getByRole('heading', { name: 'Archive 4 emails from 2 senders?' }),
    ).toBeInTheDocument();
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
      screen.getByRole('heading', { name: 'Archive 4 emails from 1 sender?' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/2 senders/)).toBeNull();
    // …and the one it skipped is said once, in the note.
    expect(screen.getByText(/1 Protected sender is skipped\./)).toBeInTheDocument();
  });

  // Codex review 2026-09-03, round 2: `nothingToActOn` only blocks verbs
  // that move CURRENT inbox mail, and is deliberately silent for
  // Unsubscribe (it cuts future mail, not a count). But the live bulk
  // preview can independently resolve to zero actionable senders for ANY
  // bulk verb, Unsubscribe included, when every queued sender went
  // Protected since the request was built — nothing else caught that.
  it('disables bulk Unsubscribe confirm when the live preview resolves with every sender Protected', () => {
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
    const confirm = screen.getByRole('button', { name: /Unsubscribe/ });
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
  it('disables bulk Unsubscribe confirm while the live preview is still loading, before any result is known', () => {
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
    const confirm = screen.getByRole('button', { name: /Unsubscribe/ });
    expect(confirm).toBeDisabled();
    // Bulk Unsubscribe hides the summary panel, so the footer carries it.
    expect(screen.getAllByText(/Loading preview/i)).toHaveLength(1);
    fireEvent.click(confirm);
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
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
  it('disables bulk Unsubscribe confirm when only a mailto sender remains executable (one-click sender went Protected)', () => {
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
    const confirm = screen.getByRole('button', { name: /Unsubscribe/ });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText(/Every selected sender is now Protected or gone/i)).toBeInTheDocument();
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
      const period = screen.getByRole('combobox', { name: /How far back/i });
      expect(period).toHaveValue(verb === 'Delete' ? '180' : 'all');
      fireEvent.click(screen.getByRole('button', { name: new RegExp(`${verb} 7`) }));
      expect(onConfirm).toHaveBeenLastCalledWith(
        expect.objectContaining({ olderThanDays: verb === 'Delete' ? 180 : null }),
      );
      fireEvent.change(period, { target: { value: '365' } });
      fireEvent.click(screen.getByRole('button', { name: new RegExp(`${verb} 7`) }));
      expect(onConfirm).toHaveBeenLastCalledWith(expect.objectContaining({ olderThanDays: 365 }));
    },
  );

  it('keeps Delete reach explicit when inbox and all-mail counts tie', () => {
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
    const wider = screen.getByRole('radio', { name: /Inbox \+ archived/ });
    expect(screen.getByRole('radio', { name: /Inbox only/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    fireEvent.click(wider);
    fireEvent.click(screen.getByRole('button', { name: /Delete 7/ }));
    expect(onConfirm).toHaveBeenLastCalledWith(
      expect.objectContaining({ reach: 'all_mail', olderThanDays: 180 }),
    );
  });

  it.each(['archive', 'delete'] as const)(
    'preserves tied-count period choices for Unsubscribe + %s',
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
      fireEvent.click(
        screen.getByRole('radio', {
          name: secondary === 'archive' ? 'Archive them' : 'Delete them',
        }),
      );
      fireEvent.change(screen.getByRole('combobox', { name: /How far back/i }), {
        target: { value: '90' },
      });
      if (secondary === 'delete')
        fireEvent.click(screen.getByRole('radio', { name: /Inbox \+ archived/ }));
      else
        expect(
          screen.queryByRole('radiogroup', { name: /Where it applies/ }),
        ).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /Unsubscribe/ }));
      expect(onConfirm).toHaveBeenLastCalledWith(
        expect.objectContaining({
          secondary: { type: secondary, olderThanDays: 90 },
          ...(secondary === 'delete' ? { reach: 'all_mail' } : {}),
        }),
      );
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
    expect(screen.getByRole('combobox', { name: /How far back/i })).toBeInTheDocument();
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
    expect(screen.getByRole('heading', { name: 'Delete 1 email?' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: /How far back/i }), {
      target: { value: '30' },
    });
    expect(screen.getByRole('heading', { name: 'Delete 3 emails?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete 3' })).toBeEnabled();
  });
});
