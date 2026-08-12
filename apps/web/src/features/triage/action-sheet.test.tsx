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
    expect(screen.getByText(/emails currently match in Inbox/i)).toBeInTheDocument();
    expect(screen.getByText(/Gmail is checked again at execution/i)).toBeInTheDocument();
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
      name: 'Show this preview in the row next time',
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
      name: 'Show this preview in the row next time',
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
    expect(notice).not.toMatch(/moves matching inbox mail/i);
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
