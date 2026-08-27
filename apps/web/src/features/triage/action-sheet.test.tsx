// Tests for the triage action sheet (D34, D226).
//
// SSR-only — same constraint as the rest of `apps/web`'s tests
// (no jsdom). What we lock in:
//
//   - When `open=true`, the sheet renders with the mandatory
//     `<ActionPreview mode="modal">` body (D226 — preview is not
//     skippable).
//   - When `open=false`, nothing renders.
//   - The remember-preference toggle copy includes the verb name
//     (so a refactor that strips the per-verb hint fails).
//   - The store's remember-preference reducer round-trips per verb
//     (independent of the sheet's local state) — that's the
//     contract the screen relies on when persisting the toggle.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { UNIFORM_UNDO_WINDOW_DAYS } from '@declutrmail/shared/entitlements/undo-window';
import { QueryWrapper, createTestQueryClient } from '@/test/query-wrapper';
import { installFetchStub, resetFetchStub } from '@/test/fetch-stub';
import { ActionSheet } from './action-sheet';
import { TRIAGE_QUEUE } from './data';
import { resetTriageStore, useTriageStore, type RememberableVerb } from './store';

beforeEach(() => {
  resetTriageStore();
});

const row = TRIAGE_QUEUE[0]!; // Groupon — high-confidence Archive

describe('ActionSheet — D226 mandatory preview surface', () => {
  it('renders the modal title + preview body when open=true', () => {
    const html = renderToStaticMarkup(
      <ActionSheet
        open={true}
        verb="Archive"
        row={row}
        inboxCount={2}
        mailboxEmail="active@gmail.com"
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    // Sheet chrome
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    // Sender name in the title
    expect(html).toContain(row.senderName);
    // Mandatory preview region (D226) — the ActionPreview component
    // exposes a `role="region"` with an aria-label that names the
    // verb + sender. That label is the load-bearing signal the sheet
    // can't silently strip.
    expect(html).toContain(`aria-label="Preview · Archive ${row.senderName}"`);
    expect(html).toContain('Why do I review this before confirming?');
    expect(html).toContain('Cancel changes nothing');
    expect(html).toContain('aria-label="Gmail account: active@gmail.com"');
  });

  it('renders nothing when open=false', () => {
    const html = renderToStaticMarkup(
      <ActionSheet
        open={false}
        verb="Archive"
        row={row}
        inboxCount={2}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(html).toBe('');
  });

  it('renders nothing when open=true but row is null', () => {
    const html = renderToStaticMarkup(
      <ActionSheet
        open={true}
        verb="Archive"
        row={null}
        inboxCount={2}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(html).toBe('');
  });

  it('blocks confirmation and offers retry when the live preview is unavailable', () => {
    const html = renderToStaticMarkup(
      <ActionSheet
        open={true}
        verb="Archive"
        row={row}
        inboxCount="unavailable"
        onCancel={() => {}}
        onConfirm={() => {}}
        onRetryPreview={() => {}}
      />,
    );

    expect(html).toContain('Retry preview');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Archive/);
  });

  it('blocks confirmation while the live preview is still loading', () => {
    const html = renderToStaticMarkup(
      <ActionSheet
        open={true}
        verb="Archive"
        row={row}
        inboxCount="loading"
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );

    expect(html).toContain('Counting the inbox');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Archive/);
  });
});

describe('ActionSheet — D34 remember-preference toggle copy', () => {
  it('mentions the verb name so the user knows what they are persisting', () => {
    for (const verb of ['Archive', 'Unsubscribe', 'Later'] as const) {
      const html = renderToStaticMarkup(
        <ActionSheet
          open={true}
          verb={verb}
          row={row}
          inboxCount={2}
          onCancel={() => {}}
          onConfirm={() => {}}
        />,
      );
      expect(html).toContain('Show this in the row next time');
    }
  });

  it('flags that the preview still shows inline when the sheet is skipped', () => {
    const html = renderToStaticMarkup(
      <ActionSheet
        open={true}
        verb="Archive"
        row={row}
        inboxCount={2}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    // The toggle's body copy must mention the inline preview — that's
    // the D226 guarantee the toggle can't silently break.
    expect(html.toLowerCase()).toContain('same preview will appear below the sender');
  });

  it('keeps Delete in the full confirmation sheet and states both recovery paths', () => {
    const html = renderToStaticMarkup(
      <ActionSheet
        open={true}
        verb="Delete"
        row={row}
        inboxCount={2}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );

    expect(html).toContain(`aria-label="Preview · Delete ${row.senderName}"`);
    expect(html).toContain('Gmail Trash');
    expect(html).toContain('Activity Undo');
    expect(html).toContain('up to 30 days');
    expect(html).not.toContain('Show this in the row next time');
  });

  it('states the undo window on a Delete sheet instead of hedging', () => {
    const html = renderToStaticMarkup(
      <ActionSheet
        open={true}
        verb="Delete"
        row={row}
        inboxCount={2}
        mailboxEmail="active@gmail.com"
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    // Scoped to the footer's own clause. Two things would otherwise make
    // this pass whether or not the footer is fixed: `renderToStaticMarkup`
    // escapes the apostrophe to `&#x27;`, so a literal-apostrophe
    // `toContain("your plan's window")` never matches either version; and
    // "30 days" already appears twice elsewhere on this sheet regardless
    // of this footer — the mandatory preview's own (already-derived, per
    // Task 1) "Undo from Activity for 30 days.", and Gmail's unrelated
    // "up to 30 days" retention clause two sentences later.
    expect(html).not.toContain('Activity Undo uses your plan');
    if (UNIFORM_UNDO_WINDOW_DAYS === null) return;
    expect(html).toContain(`Activity Undo uses the ${UNIFORM_UNDO_WINDOW_DAYS}-day window`);
  });
});

describe('ActionSheet — live-preview confirm gate', () => {
  it.each(['Archive', 'Later'] as const)(
    'blocks %s click and keyboard confirmation until the live preview resolves',
    (verb) => {
      const onConfirm = vi.fn();
      const wakeAt = verb === 'Later' ? new Date(Date.now() + 86_400_000).toISOString() : undefined;
      const { rerender } = render(
        <ActionSheet
          open={true}
          verb={verb}
          row={row}
          inboxCount="loading"
          wakeAt={wakeAt ?? null}
          onCancel={() => {}}
          onConfirm={onConfirm}
        />,
      );

      const confirm = screen.getByRole('button', { name: new RegExp(`^${verb}`) });
      expect(confirm).toBeDisabled();
      fireEvent.click(confirm);
      fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
      expect(onConfirm).not.toHaveBeenCalled();

      rerender(
        <ActionSheet
          open={true}
          verb={verb}
          row={row}
          inboxCount={2}
          wakeAt={wakeAt ?? null}
          onCancel={() => {}}
          onConfirm={onConfirm}
        />,
      );

      const readyConfirm = screen.getByRole('button', { name: new RegExp(`^${verb}`) });
      expect(readyConfirm).toBeEnabled();
      fireEvent.click(readyConfirm);
      fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
      expect(onConfirm).toHaveBeenCalledTimes(2);
    },
  );

  it('keeps a pure unsubscribe request confirmable when the backlog move is off', () => {
    const onConfirm = vi.fn();
    const { rerender } = render(
      <ActionSheet
        open={true}
        verb="Unsubscribe"
        row={row}
        inboxCount="unavailable"
        onCancel={() => {}}
        onConfirm={onConfirm}
      />,
    );

    const confirm = screen.getByRole('button', { name: /^Unsubscribe/ });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
    expect(onConfirm).toHaveBeenCalledTimes(2);
    expect(onConfirm).toHaveBeenLastCalledWith({
      archiveHistoric: false,
      rememberPreference: false,
      wakeAt: null,
    });

    fireEvent.click(screen.getByRole('checkbox', { name: /Also archive the/i }));
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
    expect(onConfirm).toHaveBeenCalledTimes(2);

    rerender(
      <ActionSheet
        open={true}
        verb="Unsubscribe"
        row={row}
        inboxCount={2}
        onCancel={() => {}}
        onConfirm={onConfirm}
      />,
    );

    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenLastCalledWith({
      archiveHistoric: true,
      rememberPreference: false,
      wakeAt: null,
    });
    expect(screen.getByText(/uses a second cleanup action/i)).toBeInTheDocument();
  });

  it('labels a resolved count as current and warns that execution re-checks Gmail', () => {
    render(
      <ActionSheet
        open={true}
        verb="Archive"
        row={row}
        inboxCount={2}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );

    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText(/emails in Inbox now/i)).toBeInTheDocument();
    expect(screen.getByText(/Rechecked when it runs/i)).toBeInTheDocument();
    expect(screen.queryByText(/will move out of the inbox/i)).not.toBeInTheDocument();
  });
});

describe('ActionSheet — toggle a11y and checked parity (2026-08-12)', () => {
  // Unsubscribe is the one verb that renders BOTH toggles.
  function renderUnsubSheet() {
    return render(
      <ActionSheet
        open={true}
        verb="Unsubscribe"
        row={row}
        inboxCount={2}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
  }

  it('exposes both toggles as checkboxes whose aria-checked tracks state', () => {
    renderUnsubSheet();

    const backlog = screen.getByRole('checkbox', { name: /Also archive the/i });
    expect(backlog).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(backlog);
    expect(backlog).toHaveAttribute('aria-checked', 'true');

    const remember = screen.getByRole('checkbox', {
      name: 'Show this in the row next time',
    });
    expect(remember).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(remember);
    expect(remember).toHaveAttribute('aria-checked', 'true');
  });

  it('a checked remember toggle fills like the checked backlog toggle', () => {
    // The remember toggle used to stay visually mute when checked while
    // the backlog toggle above it filled — a checked choice that reads
    // as unselected. Pin the parity on the checked treatment.
    renderUnsubSheet();
    const backlog = screen.getByRole('checkbox', { name: /Also archive the/i });
    const remember = screen.getByRole('checkbox', {
      name: 'Show this in the row next time',
    });
    fireEvent.click(backlog);
    fireEvent.click(remember);
    expect(remember.style.background).toBe(backlog.style.background);
    expect(remember.style.border).toBe(backlog.style.border);
  });
});

describe('Store — remember-preference persists per verb (round-trip)', () => {
  it.each<RememberableVerb>(['Archive', 'Unsubscribe', 'Later'])(
    'toggling %s in the store round-trips to true and back',
    (verb) => {
      expect(useTriageStore.getState().rememberPreference[verb]).toBe(false);
      useTriageStore.getState().setRememberPreference(verb, true);
      expect(useTriageStore.getState().rememberPreference[verb]).toBe(true);
      useTriageStore.getState().setRememberPreference(verb, false);
      expect(useTriageStore.getState().rememberPreference[verb]).toBe(false);
    },
  );
});

describe('ActionSheet — Protected acknowledgement (D245/D42)', () => {
  const protectedRow = { ...TRIAGE_QUEUE[0]!, protectionReason: 'replied' as const };
  const plainRow = TRIAGE_QUEUE.find((r) => r.protectionReason === null)!;

  function renderSheet(row: (typeof TRIAGE_QUEUE)[number]) {
    // The notice carries the Unprotect control, which is a real
    // mutation — so the sheet now needs a query client, the same way it
    // has one in the app (mounted at the root layout).
    return render(
      <QueryWrapper client={createTestQueryClient()}>
        <ActionSheet
          open
          verb="Archive"
          row={row}
          inboxCount={12}
          onCancel={() => {}}
          onConfirm={() => {}}
        />
      </QueryWrapper>,
    );
  }

  it('names the protection and says "anyway" on the confirm', () => {
    // triage-screen.tsx sends `override: true` for exactly this row. An
    // override the user is never told about is the same defect class this
    // codebase keeps fixing, so the mandatory D226 preview states it.
    renderSheet(protectedRow);
    expect(screen.getByRole('status')).toHaveTextContent(/Protected/);
    expect(screen.getByRole('button', { name: /Archive anyway/i })).toBeInTheDocument();
  });

  it('states that the protection SURVIVES the action, and offers Unprotect', () => {
    // The trap: acting on a Protected sender leaves the shield intact,
    // so every future bulk and Autopilot run keeps skipping them while
    // this action feels finished. The preview has to say so — and offer
    // the separate control, because bundling removal into the verb has
    // no undo kind and would forge a D245 sticky override.
    renderSheet(protectedRow);
    expect(screen.getByRole('status')).toHaveTextContent(
      /stays Protected, so bulk and automatic cleanup will keep skipping it/i,
    );
    expect(screen.getByRole('button', { name: /^Unprotect$/i })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/Automatic protection won’t re-apply/i);
  });

  it('closes the pending action when the in-sheet Unprotect succeeds', async () => {
    // `onUnprotected={onCancel}` is load-bearing, not tidiness: the
    // mutation invalidates the triage queue, the refetch drops this
    // now-unprotected sender, and the sheet's `row` resolves to null —
    // which unmounts the modal mid-flow while the pending action
    // SURVIVES in the store. Closing deliberately leaves the user
    // somewhere they chose. This pins the wiring so a refactor that
    // drops the prop fails here instead of in production.
    installFetchStub([
      {
        method: 'PATCH',
        path: /\/api\/senders\/[^/]+\/policy/,
        respond: () =>
          new Response(
            JSON.stringify({
              data: {
                senderId: protectedRow.senderId,
                policyType: null,
                isProtected: false,
                protectionReason: null,
              },
              meta: {},
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      },
    ]);
    const onCancel = vi.fn();
    render(
      <QueryWrapper client={createTestQueryClient()}>
        <ActionSheet
          open
          verb="Archive"
          row={protectedRow}
          inboxCount={12}
          onCancel={onCancel}
          onConfirm={() => {}}
        />
      </QueryWrapper>,
    );

    await userEvent.click(screen.getByRole('button', { name: /^Unprotect$/i }));

    await waitFor(() => expect(onCancel).toHaveBeenCalledOnce());
    resetFetchStub();
  });

  it('does not restate what the verb reaches — the preview owns that', () => {
    // An earlier draft opened the notice with "Archive moves matching
    // inbox mail now.", a second hand-rolled reach description inches
    // below the canonical one. It had already drifted: Delete's real
    // copy names Gmail Trash and the notice's did not. The preview
    // states reach; the notice states the consequence.
    renderSheet(protectedRow);
    const notice = screen.getByRole('status').textContent ?? '';
    expect(notice).not.toMatch(/moves matching inbox email/i);
    expect(notice).not.toMatch(/Archive/);
  });

  it('speaks to future mail for Unsubscribe — the partial case', () => {
    render(
      <QueryWrapper client={createTestQueryClient()}>
        <ActionSheet
          open
          verb="Unsubscribe"
          row={protectedRow}
          inboxCount={12}
          onCancel={() => {}}
          onConfirm={() => {}}
        />
      </QueryWrapper>,
    );
    // Unsubscribe stops future delivery rather than moving the backlog,
    // so what the protection keeps shielding is whatever still arrives.
    expect(screen.getByRole('status')).toHaveTextContent(/keep skipping whatever still arrives/i);
  });

  it('says nothing about protection for an unprotected row', () => {
    // Two-sided: a notice only ever observed present is not a verified notice.
    const { container } = renderSheet(plainRow);
    expect(container.textContent).not.toMatch(/stays Protected/);
    expect(screen.queryByRole('button', { name: /anyway/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Unprotect$/i })).toBeNull();
  });
});

describe('ActionSheet — zero-count no-op gate', () => {
  // A verb that moves inbox email with a resolved count of zero moves
  // nothing, yet still burns a cleanup action on Free. Senders already
  // refused this (`nothingToActOn`, confirm-action-modal.tsx); triage did
  // not, so the two surfaces disagreed about the same decision.
  it.each(['Archive', 'Later', 'Delete'] as const)(
    'blocks %s click and keyboard confirmation at a resolved count of zero',
    (verb) => {
      const onConfirm = vi.fn();
      const wakeAt = verb === 'Later' ? new Date(Date.now() + 86_400_000).toISOString() : null;
      const { rerender } = render(
        <ActionSheet
          open={true}
          verb={verb}
          row={row}
          inboxCount={0}
          wakeAt={wakeAt}
          onCancel={() => {}}
          onConfirm={onConfirm}
        />,
      );

      const confirm = screen.getByRole('button', { name: new RegExp(`^${verb}`) });
      expect(confirm).toBeDisabled();
      fireEvent.click(confirm);
      fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
      expect(onConfirm).not.toHaveBeenCalled();
      // The gate has to SAY why, or a dead button reads as a broken one.
      expect(screen.getByText(/nothing to act on/i)).toBeInTheDocument();

      // One matching email is enough to make it real work again.
      rerender(
        <ActionSheet
          open={true}
          verb={verb}
          row={row}
          inboxCount={1}
          wakeAt={wakeAt}
          onCancel={() => {}}
          onConfirm={onConfirm}
        />,
      );
      const readyConfirm = screen.getByRole('button', { name: new RegExp(`^${verb}`) });
      expect(readyConfirm).toBeEnabled();
      fireEvent.click(readyConfirm);
      expect(onConfirm).toHaveBeenCalledTimes(1);
    },
  );

  it('still confirms Unsubscribe at zero — it cuts future mail, not the inbox', () => {
    // Deliberate asymmetry, matching senders' `primaryActsOnInbox`: an
    // unsubscribe at an empty inbox is the whole point of unsubscribing.
    const onConfirm = vi.fn();
    render(
      <ActionSheet
        open={true}
        verb="Unsubscribe"
        row={row}
        inboxCount={0}
        onCancel={() => {}}
        onConfirm={onConfirm}
      />,
    );

    const confirm = screen.getByRole('button', { name: /^Unsubscribe/ });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/nothing to act on/i)).toBeNull();
  });
});

describe('ActionSheet — Later return-time picker', () => {
  // The picker used to be mounted on `selectedWakeAt !== null` — a
  // control gated on its own value. Later always opens with a default
  // (`defaultLaterWakeAtIso`, never null), so the dead end was reached by
  // CLEARING the field: the change handler stores null for an unparseable
  // value, which unmounted the input that had just been edited. What was
  // left was a disabled confirm, a footer asking for a return time, and
  // no control anywhere on screen to supply one.
  it('renders the time input when no return time is set yet', () => {
    render(
      <ActionSheet
        open={true}
        verb="Later"
        row={row}
        inboxCount={2}
        wakeAt={null}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );

    const input = screen.getByLabelText('Later return time');
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue('');
    expect(screen.getByRole('button', { name: /^Later/ })).toBeDisabled();
    expect(screen.getByText(/needs a future return time/i)).toBeInTheDocument();
  });

  it('arms confirm once a future time is picked in that input', () => {
    const onConfirm = vi.fn();
    render(
      <ActionSheet
        open={true}
        verb="Later"
        row={row}
        inboxCount={2}
        wakeAt={null}
        onCancel={() => {}}
        onConfirm={onConfirm}
      />,
    );

    const future = new Date(Date.now() + 86_400_000);
    const pad = (n: number) => String(n).padStart(2, '0');
    fireEvent.change(screen.getByLabelText('Later return time'), {
      target: {
        value: `${future.getFullYear()}-${pad(future.getMonth() + 1)}-${pad(future.getDate())}T${pad(future.getHours())}:${pad(future.getMinutes())}`,
      },
    });

    const confirm = screen.getByRole('button', { name: /^Later/ });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0]![0].wakeAt).not.toBeNull();
  });

  it('survives the user clearing the field — the real path into the dead end', () => {
    const onConfirm = vi.fn();
    render(
      <ActionSheet
        open={true}
        verb="Later"
        row={row}
        inboxCount={2}
        wakeAt={new Date(Date.now() + 86_400_000).toISOString()}
        onCancel={() => {}}
        onConfirm={onConfirm}
      />,
    );

    // Opens with the default, as Later always does.
    expect(screen.getByRole('button', { name: /^Later/ })).toBeEnabled();

    // The user clears it: `new Date('')` is NaN, so the handler stores null.
    fireEvent.change(screen.getByLabelText('Later return time'), { target: { value: '' } });

    const input = screen.getByLabelText('Later return time');
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue('');
    expect(screen.getByRole('button', { name: /^Later/ })).toBeDisabled();

    // …and the same input takes a new time, so the state is escapable.
    const future = new Date(Date.now() + 172_800_000);
    const pad = (n: number) => String(n).padStart(2, '0');
    fireEvent.change(input, {
      target: {
        value: `${future.getFullYear()}-${pad(future.getMonth() + 1)}-${pad(future.getDate())}T${pad(future.getHours())}:${pad(future.getMinutes())}`,
      },
    });
    expect(screen.getByRole('button', { name: /^Later/ })).toBeEnabled();
  });

  it('refuses a return time in the past', () => {
    const onConfirm = vi.fn();
    render(
      <ActionSheet
        open={true}
        verb="Later"
        row={row}
        inboxCount={2}
        wakeAt={new Date(Date.now() - 60_000).toISOString()}
        onCancel={() => {}}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByRole('button', { name: /^Later/ })).toBeDisabled();
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

// Codex stop-time review, 2026-08-27: the quota line added in #651 was
// bundled inside `previewDetail`, which `triage-screen.tsx` returns as
// `undefined` until the composite preview resolves. Unsubscribe with the
// backlog left alone is the ONE verb whose confirm does not wait for that
// preview (`requiresLivePreview`), so the cost was absent at exactly the
// moment it could be spent. The allowance comes from `auth.me`, not from
// the preview, so it never had a reason to wait.
describe('ActionSheet — the cleanup cost is stated whenever it can be spent', () => {
  it.each(['loading', 'unavailable'] as const)(
    'states the cost on an Unsubscribe whose preview is %s and whose confirm is armed',
    (inboxCount) => {
      render(
        <ActionSheet
          open={true}
          verb="Unsubscribe"
          row={row}
          inboxCount={inboxCount}
          quotaRemaining={34}
          onCancel={() => {}}
          onConfirm={() => {}}
        />,
      );
      // The bypass: this confirm is armed without a resolved preview.
      expect(screen.getByRole('button', { name: /^Unsubscribe/ })).toBeEnabled();
      expect(
        screen.getByText(/Uses 1 of your 34 cleanup actions left this month/),
      ).toBeInTheDocument();
    },
  );

  it('still states the cost once the preview resolves', () => {
    render(
      <ActionSheet
        open={true}
        verb="Archive"
        row={row}
        inboxCount={12}
        quotaRemaining={34}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(
      screen.getByText(/Uses 1 of your 34 cleanup actions left this month/),
    ).toBeInTheDocument();
  });

  it('says nothing on a tier that does not meter cleanup actions', () => {
    render(
      <ActionSheet
        open={true}
        verb="Archive"
        row={row}
        inboxCount={12}
        quotaRemaining={null}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(screen.queryByText(/cleanup action/)).toBeNull();
  });
});
