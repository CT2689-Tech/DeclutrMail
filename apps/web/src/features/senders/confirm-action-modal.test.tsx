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

    expect(screen.getByText(/emails currently match/)).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: /Archive/ });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
    expect(onConfirm).not.toHaveBeenCalled();
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
    expect(screen.getByText('Archive mail from 1 sender')).toBeInTheDocument();
    expect(screen.queryByText(/from 40 senders/)).not.toBeInTheDocument();
    expect(screen.getByText(/Acting on 1 of the 40 eligible senders/)).toBeInTheDocument();
    expect(screen.getByText(/The rest stay untouched/)).toBeInTheDocument();
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
    expect(screen.getByText(/Acting on 2 of the 4 eligible senders/)).toBeInTheDocument();
    expect(screen.queryByText(/4 senders you selected/)).not.toBeInTheDocument();
    // The title is the acted-on count, stated by the caller.
    expect(screen.getByText('Archive mail from 2 senders')).toBeInTheDocument();
    // And the scope line keeps the real selection total intact.
    expect(screen.getByLabelText('Senders included in this bulk action')).toHaveTextContent(
      '5 selected · 4 eligible · 1 skipped',
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
    expect(screen.getAllByText(/close and retry/i).length).toBeGreaterThan(0);
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

  // Shipped live (2026-08-21): picking a backlog verb rendered
  // "Also: [object Object]" in the lead paragraph of a DESTRUCTIVE
  // confirm. The lead built its two halves from `presentation.primary`
  // (through `actionEffectCopy`) and `presentation.secondary` (raw — a
  // `PresentedAction` object), then guarded the pair with a hand-written
  // `copy is string` predicate that only tested `!== null`. That
  // predicate is an assertion, not a narrowing, so the object reached
  // `join` with nothing in the type system to stop it. Nothing asserted
  // on the assembled string, which is why it survived to production.
  it.each(['Archive them', 'Delete them'] as const)(
    'renders real copy after "Also:" when the %s backlog verb is picked',
    (label) => {
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
      expect(container.textContent).toMatch(/Also: \S/);
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

  it('explains a zero count instead of leaving it to contradict the volume figure', () => {
    renderDelete(emptyInbox, 71);
    expect(
      screen.getByText(
        /Nothing from this sender is in your inbox right now — though 71 arrived in the last 90 days\. Delete only acts on mail still in the inbox\./,
      ),
    ).toBeTruthy();
    // No claim about the mail's history or fate — we store only current labels.
    expect(screen.queryByText(/moved out of it|already archived|already deleted/)).toBeNull();
  });

  it('hides the window chips when no window can change the outcome', () => {
    renderDelete(emptyInbox, 71);
    expect(screen.queryByRole('radiogroup', { name: /How far back/i })).toBeNull();
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
    expect(screen.getByRole('radiogroup', { name: /How far back/i })).toBeTruthy();
    expect(
      screen.getByText(
        /30 emails from this sender are in your inbox, but none are older than 180 days\. Widen the window to include them\./,
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
      screen.getByText(new RegExp(`\\. ${expectedVerb} only acts on mail still in the inbox\\.$`)),
    ).toBeTruthy();
    expect(screen.queryByText(/Unsubscribe only acts on mail still in the inbox/)).toBeNull();
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
  expect(screen.getByText(/Nothing from these senders is in your inbox right now\./)).toBeTruthy();
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
        /Every window through 6 months\+ matches the same 2,908 — this sender's newest inbox email is 182 days old, so those windows exclude nothing\./,
      ),
    ).toBeTruthy();
    // The chips themselves stay: merging them would let "All inbox" stand
    // in for "6 months+", which can diverge at execution.
    expect(screen.getByRole('radiogroup', { name: /How far back/i })).toBeTruthy();
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
    fireEvent.click(screen.getByRole('button', { name: /Show what currently matches/ }));
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
    fireEvent.click(screen.getByRole('button', { name: /Show what currently matches/ }));
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
    const link = screen.getByRole('link', { name: /Check these in Gmail first/ });
    const href = decodeURIComponent(link.getAttribute('href') ?? '');
    // Quoted, matching `buildFromSearchLink` — an unquoted address breaks
    // Gmail search on any address containing a `+` or a dot-heavy local part.
    expect(href).toContain(`from:"${sender.email}"`);
    expect(href).toContain('in:inbox');
    // Delete defaults to the 6-month window — the link must carry it.
    expect(href).toContain('older_than:180d');
    // Never promises the counts match; Gmail is day-granular and live.
    expect(link.getAttribute('title')).toMatch(/roughly|can differ/i);
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
      screen.getByRole('link', { name: /Check these in Gmail/ }).getAttribute('href') ?? '',
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
    expect(screen.queryByRole('link', { name: /Check these in Gmail/ })).toBeNull();
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
    // on both the chip and the headline, so assert the pair.
    expect(screen.getAllByText('700').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/across inbox \+ archived/)).toBeInTheDocument();
    // The un-windowed chip stops claiming "inbox" once the reach is wider.
    expect(screen.getByRole('radio', { name: /All mail/ })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /All inbox/ })).toBeNull();
    // The exclusions + the per-placement undo promise are stated where
    // the choice is made — and the promise is the CONDITIONAL one the
    // system actually makes (inbox→inbox, archive→archive), never an
    // absolute "back where it was".
    expect(screen.getByText(/Trash, Spam, Drafts and Chat are never touched/)).toBeInTheDocument();
    expect(
      screen.getByText(/inbox mail to the inbox, archived mail to the archive/),
    ).toBeInTheDocument();
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
      screen.getByRole('link', { name: /Check these in Gmail/ }).getAttribute('href') ?? '',
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
    expect(screen.queryByRole('radiogroup', { name: /How far back/i })).toBeNull();
    expect(reachRow()).not.toBeNull();
    expect(
      screen.getByText(/Switch to "Inbox \+ archived" to reach 977 archived emails\./),
    ).toBeInTheDocument();
    // With the reach control on screen, the notice must NOT claim Delete
    // "only acts on" inbox mail — the next sentence disproves it.
    expect(screen.getByText(/Delete acts on inbox mail by default/)).toBeInTheDocument();
    expect(screen.queryByText(/only acts on mail still in the inbox/)).toBeNull();
    // Flipping the chip clears the inbox-scope narration AND arms the
    // exact figure the chip advertised: the hidden 180d default resets
    // to "All mail", so the user gets 977, not a silently-shaved 700.
    fireEvent.click(screen.getByRole('radio', { name: /Inbox \+ archived/ }));
    expect(screen.queryByText(/is in your inbox right now/)).toBeNull();
    expect(screen.getByRole('radio', { name: /All mail/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getAllByText('977').length).toBeGreaterThanOrEqual(1);
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
    expect(text).toContain('2 senders we can unsubscribe for you');
    expect(text).toContain('2 senders need an email you send yourself');
    expect(text).toContain('1 sender offers no unsubscribe');
    expect(text).toContain("1 sender we haven't checked yet");
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
    expect(text).toContain("2 senders we haven't checked yet");
    expect(text).not.toContain('offer no unsubscribe');
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
    expect(
      screen.queryByText(/None of these senders has an unsubscribe DeclutrMail can send/),
    ).toBeNull();
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
    expect(
      screen.getByText(/None of these senders has an unsubscribe DeclutrMail can send/),
    ).toBeInTheDocument();
  });

  it('offers the action as soon as one sender is one-click', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmActionModal
        request={unsubRequest(['one_click', 'mailto', null])}
        onCancel={() => {}}
        onConfirm={onConfirm}
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
      'Where this mail is now: 4 in your inbox · 973 emails elsewhere in Gmail ' +
        '(archived or under a label) · 23 in Trash or Spam.',
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
    // Both surfaces carry it: the inline panel explains the cause, the
    // footer states the consequence beside the locked confirm.
    expect(screen.getAllByText(/no longer in this mailbox/)).toHaveLength(2);
    expect(screen.getByText(/the list you are looking at is out of date/)).toBeInTheDocument();
    expect(screen.queryByText(/Couldn’t load a live preview/)).not.toBeInTheDocument();
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
