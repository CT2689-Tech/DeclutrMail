/**
 * Focus mode — the default Triage view (one sender at a time).
 *
 * State table (CLAUDE.md §8 "Flow & state completeness"). Every row is a
 * test below unless it names the suite that already owns it.
 *
 * | state / transition              | UI shows                                            | cache / store effect                         | tested |
 * |---------------------------------|-----------------------------------------------------|----------------------------------------------|--------|
 * | loading                         | h1 + ONE card-sized skeleton, no progress/toggle    | none                                         | here   |
 * | error                           | h1 + ErrorState with Retry                          | retry() refetches                            | here   |
 * | empty, never decided            | "Nothing needs a decision right now."               | none                                         | here   |
 * | empty, sync failed              | "last scan didn't finish" + Open Settings           | none                                         | triage-screen.test / empty-state.test |
 * | completion (decided today > 0)  | check, title, 1 sentence, one tally line            | none                                         | here   |
 * | ready                           | first stack item as the card, "1 of N", See all     | none                                         | here   |
 * | ready → verb (mail-moving)      | EXISTING sheet + D226 preview; cancel = no mutation | pendingAction set / cleared                  | here   |
 * | ready → Keep                    | POST keep-intent, no sheet (D40)                    | invalidate on 200                            | here   |
 * | row busy / in-flight            | card aria-busy, verbs disabled, stays until refetch | no optimistic removal (D226)                 | here   |
 * | decided → refetch drops the row | next sender's card; progress advances               | "2 of N" read off the queue itself           | here   |
 * | D34 inline preview              | preview + Confirm INSIDE the card; Esc cancels      | pendingAction surface=inline                 | here   |
 * | protected sender                | Protected mark + evidence why-line                  | override rides the existing dispatch         | here   |
 * | mailto unsubscribe              | D230 callout above the card                         | none                                         | here   |
 * | Skip (button / →)               | next item; wraps; hidden when 1 item; cancels inline| skip list only — nothing written             | here   |
 * | Skip while a sheet is open      | ignored — the sheet owns the keyboard               | none                                         | here   |
 * | batch offer (verdict / domain)  | its OWN card; verb → existing batch sheet           | dismiss → shared session dismissal list      | here   |
 * | See all ↔ One at a time         | list ↔ card; persisted per device                   | localStorage `dm.triage.mode`                | here   |
 * | "Why?"                          | reasoning + band + stats; arms D25 stale refresh    | store.expandedRowId (same as a list expand)  | here   |
 * | mobile (≤480)                   | 44px verb bar, swipe → same onAction, no caption    | none                                         | here   |
 * | mailbox switch                  | skip list + session total reset                     | via useMailboxScopeReset (existing)          | triage-screen.actions.test (pending reset) |
 * | 409 no-active / select-mailbox  | owned by the app chrome — this screen never mounts  | —                                            | app-chrome-layout.test |
 * | tier-gated                      | owned by `TierGate` around the route                | —                                            | tier-gate tests |
 * | onboarding journeys             | list only, no header — unchanged                    | preference ignored                           | here   |
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { QueryClient } from '@tanstack/react-query';
import { tokens, useUiStore } from '@declutrmail/shared';

import {
  addFetchHandlers,
  installFetchStub,
  jsonOk,
  jsonServerError,
  resetFetchStub,
} from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';
import { TRIAGE_QUEUE, TRIAGE_SESSION_STATS, type TriageScreenState } from './data';
import { VERDICT_BATCH_LABELS } from './domain-batch';
import {
  planFocusItems,
  skipFocusItem,
  currentFocusItem,
  focusItemKey,
  heldFocusItem,
} from './focus-plan';
import { isSkipKey } from './focus-stack';
import { resetTriageStore, useTriageStore } from './store';
import { storeTriageMode } from './test-mode';
import { TriageScreen } from './triage-screen';

vi.mock('@/lib/sentry', () => ({ captureFeatureException: vi.fn() }));
vi.mock('@/features/auth/auth-provider', () => ({
  getActiveMailboxEmail: () => 'owner@gmail.com',
  useOptionalAuth: () => ({
    me: {
      activeMailboxId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      user: { email: 'owner@gmail.com' },
      mailboxes: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'owner@gmail.com' }],
    },
  }),
}));

function rowById(id: string) {
  const r = TRIAGE_QUEUE.find((row) => row.id === id);
  if (!r) throw new Error(`fixture missing row ${id}`);
  return r;
}

const GROUPON = rowById('t-groupon'); // archive verdict, unprotected
const LINKEDIN = rowById('t-linkedin'); // unsubscribe, recommended
const SARAH = rowById('t-sarah'); // protected
const AMAZON = TRIAGE_QUEUE.filter((r) => r.id.startsWith('t-amazon-'));

const PREVIEW_BODY = {
  sender: {
    id: GROUPON.senderId,
    name: GROUPON.senderName,
    domain: GROUPON.senderDomain,
    lastSeenDays: 0,
    wroteToCount: 0,
    monthly: 52,
  },
  counts: { all: 47, olderThan30d: 30, olderThan90d: 12, olderThan180d: 5, olderThan365d: 1 },
  recentMessages: {
    all: [],
    olderThan30d: [],
    olderThan90d: [],
    olderThan180d: [],
    olderThan365d: [],
  },
  unsubAvailable: true,
  protected: false,
};

const originalMatchMedia = window.matchMedia;
function setViewportWidth(width: number): void {
  window.matchMedia = ((query: string) => {
    const limit = /\(max-width:\s*(\d+(?:\.\d+)?)px\)/.exec(query);
    return {
      matches: limit != null && width <= Number(limit[1]),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    };
  }) as typeof window.matchMedia;
}

function ready(rows: readonly (typeof TRIAGE_QUEUE)[number][]): TriageScreenState {
  return { kind: 'ready', rows: [...rows], stats: TRIAGE_SESSION_STATS };
}

function renderScreen(
  state: TriageScreenState,
  client: QueryClient = createTestQueryClient(),
  props: { journey?: 'daily' | 'first_relief' } = {},
) {
  const ui = (s: TriageScreenState) => (
    <QueryWrapper client={client}>
      <TriageScreen state={s} {...props} />
    </QueryWrapper>
  );
  const view = render(ui(state));
  return { ...view, setState: (s: TriageScreenState) => view.rerender(ui(s)) };
}

const card = () => screen.getByRole('region', { name: 'Current decision' });
const cardTitle = () => within(card()).getByRole('heading', { level: 2 }).textContent;

beforeEach(() => {
  window.localStorage.clear();
  resetTriageStore();
  setViewportWidth(1280);
  installFetchStub([
    { method: 'GET', path: '/api/actions/preview', respond: () => jsonOk({ data: PREVIEW_BODY }) },
  ]);
});
afterEach(() => {
  resetFetchStub();
  window.matchMedia = originalMatchMedia;
});

// The inline (D34) confirm: the bare verb while the live count loads, verb +
// count once it resolves. The toolbar's own button is "Archive (A)".
const INLINE_ARCHIVE_CONFIRM = /^Archive( [\d,]+)?$/;

describe('focus mode — resting states', () => {
  it('loading: one card-sized skeleton, and neither a count nor a mode toggle', () => {
    renderScreen({ kind: 'loading' });
    expect(screen.getByRole('heading', { level: 1, name: 'Triage' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading triage queue');
    expect(document.querySelectorAll('.dm-skeleton')).toHaveLength(1);
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByRole('button', { name: 'List' })).toBeNull();
  });

  it('error: states the failure and offers Retry', () => {
    const retry = vi.fn();
    renderScreen({ kind: 'error', error: new Error('boom'), retry });
    expect(screen.getByText("Your queue didn't load")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('empty, never decided: the resting state, not the reward screen', () => {
    renderScreen({ kind: 'empty', stats: { ...TRIAGE_SESSION_STATS, decidedToday: 0 } });
    const region = screen.getByRole('region', { name: 'Nothing to decide' });
    expect(within(region).getByText('Nothing needs a decision right now.')).toBeInTheDocument();
    expect(screen.queryByText(/done for now/)).toBeNull();
  });

  it('completion: title, one sentence, and the four tiles as ONE line of numerals', () => {
    renderScreen({
      kind: 'empty',
      stats: {
        ...TRIAGE_SESSION_STATS,
        decidedToday: 9,
        archivedToday: 4,
        unsubscribedToday: 1,
        laterToday: 0,
      },
    });
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(/done for now/);
    const tally = document.querySelector('[data-dm-triage-tally]')!;
    // Singular agrees; a zero entry drops out rather than printing "0 to Later".
    expect(tally.textContent).toBe('9 decided4 archived1 unsubscribe');
  });
});

describe('focus mode — the card', () => {
  it('shows ONE sender: name, address, one big number, the why — and the count once', () => {
    renderScreen(ready([LINKEDIN, GROUPON]));
    expect(cardTitle()).toBe(LINKEDIN.senderName);
    expect(within(card()).getByText(LINKEDIN.senderEmail)).toBeInTheDocument();
    expect(document.querySelector('[data-dm-focus-count]')?.textContent).toBe(
      LINKEDIN.last90dMessages.toLocaleString('en-US'),
    );
    expect(within(card()).getByText('emails in 90 days')).toBeInTheDocument();
    // The big number is the count — the why-line must not repeat it.
    expect(within(card()).queryByText(/messages$/)).toBeNull();
    expect(screen.queryByRole('list', { name: 'Triage queue' })).toBeNull();
    // The second sender is not on screen.
    expect(screen.queryByRole('heading', { name: GROUPON.senderName })).toBeNull();
    expect(screen.getByRole('progressbar', { name: 'Decision 1 of 2' })).toBeInTheDocument();
    expect(screen.getByText('1 of 2')).toBeInTheDocument();
  });

  it('fills the suggested verb only, and keeps all five with their key hints', () => {
    renderScreen(ready([LINKEDIN, GROUPON]));
    const toolbar = screen.getByRole('toolbar', { name: `Decide on ${LINKEDIN.senderName}` });
    const names = within(toolbar)
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label'));
    expect(names).toEqual([
      'Keep (K)',
      'Archive (A)',
      'Unsubscribe (U)',
      'Later (L)',
      'Delete (D)',
    ]);
    const filled = within(toolbar)
      .getAllByRole('button')
      // Unfilled verbs are quiet capsules: transparent or the neutral fill.
      .filter((b) => !['transparent', tokens.color.fill].includes(b.style.background));
    expect(filled.map((b) => b.getAttribute('aria-label'))).toEqual(['Unsubscribe (U)']);
  });

  it('keeps the reasoning behind "Why?" — one tap, wired to the same store slot as a list expand', () => {
    renderScreen(ready([LINKEDIN, GROUPON]));
    expect(screen.queryByText(LINKEDIN.reasoning)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Why?' }));
    expect(screen.getByText(LINKEDIN.reasoning)).toBeInTheDocument();
    expect(document.querySelector('[data-dm-verdict-band]')?.textContent).toContain('strong');
    // This is what arms the D25 stale-read refresh (`useRefreshStaleRead`).
    expect(useTriageStore.getState().expandedRowId).toBe(LINKEDIN.id);
  });

  it('protected sender: the Protected mark and the evidence, in place of a read rate', () => {
    renderScreen(ready([SARAH, GROUPON]));
    expect(cardTitle()).toBe(SARAH.senderName);
    expect(within(card()).getByText('Protected')).toBeInTheDocument();
    expect(within(card()).queryByText(/marked read/)).toBeNull();
  });

  it('registers one-sentence help that does not promise Keep a preview (QA-triage-20260827-08)', () => {
    renderScreen(ready([LINKEDIN]));
    const help = useUiStore.getState().screenHelp;
    expect(help?.id).toBe('triage');
    expect(String(help?.body)).toContain('anything that moves email shows a preview first');
    expect(help?.learnMore?.href).toBe('/help#actions-in-gmail-terms');
  });
});

describe('focus mode — deciding runs the EXISTING lifecycle (D226)', () => {
  it('a mail-moving verb opens the sheet with the mandatory preview; cancelling mutates nothing', async () => {
    const posts: string[] = [];
    addFetchHandlers([
      {
        method: 'POST',
        path: '/api/actions',
        respond: () => {
          posts.push('actions');
          return jsonOk({ data: {} });
        },
      },
    ]);
    renderScreen(ready([GROUPON, LINKEDIN]));
    fireEvent.keyDown(window, { key: 'a' });
    const sheet = await screen.findByRole('dialog');
    await waitFor(() =>
      expect(
        within(sheet).getByRole('heading', { name: 'Archive 47 emails?' }),
      ).toBeInTheDocument(),
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(posts).toEqual([]);
    expect(cardTitle()).toBe(GROUPON.senderName);
  });

  it('Keep: POSTs immediately, the card goes busy and STAYS until the refetch drops it, then the next sender arrives', async () => {
    let release!: (r: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const keeps: unknown[] = [];
    addFetchHandlers([
      {
        method: 'POST',
        path: '/api/actions/keep-intent',
        respond: async (req) => {
          keeps.push(await req.json());
          return pending;
        },
      },
    ]);
    const view = renderScreen(ready([GROUPON, LINKEDIN]));
    fireEvent.click(screen.getByRole('button', { name: 'Keep (K)' }));
    await waitFor(() => expect(keeps).toEqual([{ senderId: GROUPON.senderId }]));

    // In flight — no optimistic removal, and no second dispatch path.
    expect(card()).toHaveAttribute('aria-busy', 'true');
    expect(cardTitle()).toBe(GROUPON.senderName);
    expect(screen.getByRole('button', { name: 'Archive (A)' })).toBeDisabled();
    expect(screen.queryByRole('dialog')).toBeNull();

    release(
      jsonOk({
        data: {
          senderId: GROUPON.senderId,
          recordedAt: new Date().toISOString(),
          activityLogId: '66666666-6666-4666-8666-666666666666',
        },
      }),
    );
    await waitFor(() => expect(card()).toHaveAttribute('aria-busy', 'false'));

    // The server-confirmed refetch is what removes the sender.
    view.setState(ready([LINKEDIN]));
    expect(cardTitle()).toBe(LINKEDIN.senderName);
    // Progress reads the queue itself: one of the session's two has left.
    expect(screen.getByText('2 of 2')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
  });

  it('D34 inline preview renders INSIDE the card with its Confirm; Esc cancels', async () => {
    useTriageStore.getState().setRememberPreference('Archive', true);
    renderScreen(ready([GROUPON, LINKEDIN]));
    fireEvent.keyDown(window, { key: 'a' });
    expect(screen.queryByRole('dialog')).toBeNull();
    const confirm = await within(card()).findByRole('button', { name: INLINE_ARCHIVE_CONFIRM });
    // Fails closed until the live count resolves, then arms.
    await waitFor(() => expect(confirm).not.toBeDisabled());
    expect(within(card()).getByText(/Press A again to confirm/)).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(within(card()).queryByRole('button', { name: INLINE_ARCHIVE_CONFIRM })).toBeNull();
  });

  it('mailto unsubscribe: the D230 callout appears above the card', async () => {
    addFetchHandlers([
      {
        method: 'POST',
        path: '/api/actions/unsubscribe-intent',
        respond: () =>
          jsonOk({
            data: {
              senderId: LINKEDIN.senderId,
              recordedAt: new Date().toISOString(),
              activityLogId: '77777777-7777-4777-8777-777777777777',
              method: 'mailto',
              executionActionId: null,
              mailtoUrl: 'mailto:unsubscribe@linkedin.example?subject=Remove%20me',
            },
          }),
      },
    ]);
    renderScreen(ready([LINKEDIN, GROUPON]));
    fireEvent.keyDown(window, { key: 'u' });
    const sheet = await screen.findByRole('dialog');
    const confirm = within(sheet).getByRole('button', { name: /^Unsubscribe/i });
    await waitFor(() => expect(confirm).not.toBeDisabled());
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
    expect(await screen.findByTestId('unsub-mailto-callout')).toBeInTheDocument();
  });
});

describe('focus mode — Skip', () => {
  it('binds → only — never a letter, a verb key or a chord', () => {
    expect(isSkipKey({ key: 'ArrowRight' })).toBe(true);
    expect(isSkipKey({ key: 's' })).toBe(false);
    expect(isSkipKey({ key: 'ArrowRight' })).toBe(true);
    expect(isSkipKey({ key: 'ArrowRight', metaKey: true })).toBe(false);
    for (const key of ['k', 'a', 'u', 'l', 'd', 'z', '?']) expect(isSkipKey({ key })).toBe(false);
  });

  it('moves to the next sender without deciding, and wraps back round', () => {
    const posts = vi.fn();
    addFetchHandlers([
      { method: 'POST', path: '/api/actions/keep-intent', respond: () => (posts(), jsonOk({})) },
    ]);
    renderScreen(ready([GROUPON, LINKEDIN]));
    fireEvent.click(screen.getByRole('button', { name: 'Skip (→)' }));
    expect(cardTitle()).toBe(LINKEDIN.senderName);
    // Position, not decisions: nothing left the queue.
    expect(screen.getByText('2 of 2')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(cardTitle()).toBe(GROUPON.senderName);
    expect(posts).not.toHaveBeenCalled();
  });

  it('is absent when there is nowhere to skip to', () => {
    renderScreen(ready([GROUPON]));
    expect(screen.queryByRole('button', { name: 'Skip (→)' })).toBeNull();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(cardTitle()).toBe(GROUPON.senderName);
  });

  it('is ignored while a sheet is open — the sender stays under its preview', async () => {
    renderScreen(ready([GROUPON, LINKEDIN]));
    fireEvent.keyDown(window, { key: 'a' });
    await screen.findByRole('dialog');
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(cardTitle()).toBe(GROUPON.senderName);
    expect(useTriageStore.getState().pendingAction?.rowId).toBe(GROUPON.id);
  });

  it('cancels an open inline preview rather than leaving it pending behind another card', async () => {
    useTriageStore.getState().setRememberPreference('Archive', true);
    renderScreen(ready([GROUPON, LINKEDIN]));
    fireEvent.keyDown(window, { key: 'a' });
    await within(card()).findByRole('button', { name: INLINE_ARCHIVE_CONFIRM });
    fireEvent.click(screen.getByRole('button', { name: 'Skip (→)' }));
    expect(useTriageStore.getState().pendingAction).toBeNull();
    expect(cardTitle()).toBe(LINKEDIN.senderName);
  });

  it('plan: a stale skip list can never strand the stack on nothing', () => {
    const items = planFocusItems([GROUPON, LINKEDIN], [], true);
    const all = items.map(focusItemKey);
    expect(currentFocusItem(items, all)).toBe(items[0]);
    expect(skipFocusItem(items, [all[0]!], all[1]!)).toEqual([]);
    expect(currentFocusItem([], [])).toBeNull();
  });
});

describe('focus mode — the card on stage is held', () => {
  it('plan: holds the card while it is in the stack, wherever a re-plan puts it', () => {
    const before = planFocusItems([GROUPON, LINKEDIN], [], true);
    const held = focusItemKey(before[0]!);
    const after = planFocusItems([LINKEDIN, SARAH, GROUPON], [], true);
    expect(after[0]).not.toBe(before[0]);
    const onStage = heldFocusItem(after, [], held);
    expect(onStage && focusItemKey(onStage)).toBe(held);
  });

  it('plan: releases to the first unskipped card once the held one leaves the stack', () => {
    const held = focusItemKey(planFocusItems([GROUPON], [], true)[0]!);
    const after = planFocusItems([LINKEDIN, SARAH], [], true);
    expect(heldFocusItem(after, [], held)).toBe(after[0]);
    expect(heldFocusItem(after, [focusItemKey(after[0]!)], held)).toBe(after[1]);
    expect(heldFocusItem([], [], held)).toBeNull();
  });

  it('plan: a skipped card is not held', () => {
    const items = planFocusItems([GROUPON, LINKEDIN], [], true);
    const held = focusItemKey(items[0]!);
    expect(heldFocusItem(items, [held], held)).toBe(items[1]);
  });

  it('plan: with nothing held it is the first unskipped card', () => {
    const items = planFocusItems([GROUPON, LINKEDIN], [], true);
    expect(heldFocusItem(items, [], null)).toBe(items[0]);
    expect(heldFocusItem(items, [focusItemKey(items[0]!)], null)).toBe(items[1]);
  });

  it('a background refetch that reorders the queue leaves the same sender on stage', () => {
    const view = renderScreen(ready([GROUPON, LINKEDIN]));
    expect(cardTitle()).toBe(GROUPON.senderName);

    view.setState(ready([LINKEDIN, SARAH, GROUPON]));
    expect(cardTitle()).toBe(GROUPON.senderName);
    expect(screen.queryByRole('dialog')).toBeNull();

    // Released only when that sender leaves the queue.
    view.setState(ready([LINKEDIN, SARAH]));
    expect(cardTitle()).toBe(LINKEDIN.senderName);
  });

  it('a failed decision (5xx) does not advance the card, even when the queue comes back reordered', async () => {
    const keeps = vi.fn();
    addFetchHandlers([
      {
        method: 'POST',
        path: '/api/actions/keep-intent',
        respond: () => (keeps(), jsonServerError()),
      },
    ]);
    const view = renderScreen(ready([GROUPON, LINKEDIN]));
    fireEvent.click(screen.getByRole('button', { name: 'Keep (K)' }));
    await waitFor(() => expect(keeps).toHaveBeenCalled());
    await waitFor(() => expect(card()).toHaveAttribute('aria-busy', 'false'));

    // Nothing was recorded, so the sender is still in the queue — the
    // refetch may put it anywhere.
    view.setState(ready([LINKEDIN, GROUPON]));
    expect(cardTitle()).toBe(GROUPON.senderName);
    // Still decidable: the verbs are live again.
    expect(screen.getByRole('button', { name: 'Keep (K)' })).not.toBeDisabled();
  });

  it('Skip releases the hold, so a later refetch cannot drag the skipped sender back', () => {
    const view = renderScreen(ready([GROUPON, LINKEDIN, SARAH]));
    fireEvent.click(screen.getByRole('button', { name: 'Skip (→)' }));
    expect(cardTitle()).toBe(LINKEDIN.senderName);
    view.setState(ready([GROUPON, SARAH, LINKEDIN]));
    expect(cardTitle()).toBe(LINKEDIN.senderName);
  });
});

describe('focus mode — batch offers are their own card', () => {
  it('same-domain run: one card, its verb opens the EXISTING batch sheet, dismiss returns the senders', async () => {
    addFetchHandlers([
      {
        method: 'POST',
        path: '/api/actions/bulk-preview',
        respond: () => jsonOk({ data: { senders: [], totals: { all: 0 } } }),
      },
    ]);
    expect(AMAZON.length).toBeGreaterThanOrEqual(3);
    // The run shares an Archive verdict too, so the same-verdict offer
    // would lead; pass on it the way a user does.
    useTriageStore.getState().dismissBatchDomain(VERDICT_BATCH_LABELS.archive);
    renderScreen(ready(AMAZON));
    const eligible = AMAZON.filter((r) => r.protectionReason === null).length;
    expect(cardTitle()).toBe('senders from amazon.com');
    fireEvent.click(
      screen.getByRole('button', { name: `Archive all ${eligible} senders from amazon.com` }),
    );
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Decide one by one' }));
    expect(useTriageStore.getState().dismissedBatchDomains).toContain('amazon.com');
    expect(cardTitle()).not.toBe('senders from amazon.com');
  });

  it('same-verdict offer leads the stack and offers only its verb', () => {
    const archives = TRIAGE_QUEUE.filter(
      (r) => r.verdict === 'archive' && r.protectionReason === null,
    );
    // Guard the fixture assumption instead of passing vacuously.
    expect(archives.length).toBeGreaterThanOrEqual(3);
    renderScreen(ready(TRIAGE_QUEUE));
    expect(cardTitle()).toBe('senders suggested for Archive');
    expect(
      screen.getByRole('button', {
        name: `Archive all ${archives.length} recommended senders — preview first`,
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /to Later$/ })).toBeNull();
  });
});

describe('focus ↔ list', () => {
  it('"See all" switches to the list and the choice persists on this device', () => {
    const first = renderScreen(ready([GROUPON, LINKEDIN]));
    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    expect(screen.getByRole('list', { name: 'Triage queue' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Current decision' })).toBeNull();
    // List mode counts decisions, not a position.
    expect(screen.getByRole('progressbar', { name: '0 of 2 decided' })).toBeInTheDocument();
    first.unmount();

    renderScreen(ready([GROUPON, LINKEDIN]));
    expect(screen.getByRole('list', { name: 'Triage queue' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Focus' }));
    expect(screen.getByRole('button', { name: 'Focus' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'false');
    expect(card()).toBeInTheDocument();
  });

  it('list rows at rest carry no confidence band, no reasoning and no age; the list names every sender', () => {
    storeTriageMode('list');
    renderScreen(ready([GROUPON, LINKEDIN, SARAH]));
    const list = screen.getByRole('list', { name: 'Triage queue' });
    for (const row of [GROUPON, LINKEDIN, SARAH]) {
      expect(within(list).getByText(row.senderName)).toBeInTheDocument();
    }
    expect(list.textContent).not.toContain('strong');
    expect(list.textContent).not.toContain(LINKEDIN.reasoning);
    expect(list.querySelector('[data-dm-hero-reasoning]')).toBeNull();
    expect(within(list).queryByRole('toolbar')).toBeNull();
  });

  it('onboarding journeys keep their fixed list and ignore the preference', () => {
    renderScreen(ready([GROUPON, LINKEDIN]), createTestQueryClient(), { journey: 'first_relief' });
    expect(screen.getByRole('list', { name: 'Triage queue' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'List' })).toBeNull();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });
});

describe('focus mode — mobile', () => {
  beforeEach(() => setViewportWidth(375));

  it('gives every verb a 44px target, drops the key hints and the swipe caption', () => {
    renderScreen(ready([LINKEDIN, GROUPON]));
    const toolbar = screen.getByRole('toolbar');
    for (const button of within(toolbar).getAllByRole('button')) {
      expect(button.style.height).toBe('44px');
    }
    expect(toolbar.querySelector('kbd')).toBeNull();
    expect(screen.queryByText(/Swipe ·/)).toBeNull();
  });

  it('a right swipe on the card is Keep through the same onAction path', async () => {
    const keeps: unknown[] = [];
    addFetchHandlers([
      {
        method: 'POST',
        path: '/api/actions/keep-intent',
        respond: async (req) => {
          keeps.push(await req.json());
          return jsonOk({
            data: { senderId: GROUPON.senderId, recordedAt: '', activityLogId: 'x' },
          });
        },
      },
    ]);
    renderScreen(ready([GROUPON, LINKEDIN]));
    const surface = within(card()).getByRole('heading', { level: 2 }).parentElement!;
    const touch = { pointerType: 'touch', pointerId: 1 };
    fireEvent.pointerDown(surface, { ...touch, clientX: 40, clientY: 200 });
    fireEvent.pointerMove(surface, { ...touch, clientX: 160, clientY: 204 });
    fireEvent.pointerUp(surface, { ...touch, clientX: 160, clientY: 204 });
    await waitFor(() => expect(keeps).toEqual([{ senderId: GROUPON.senderId }]));
  });

  it('a left swipe only OPENS the Archive preview — a gesture never mutates', async () => {
    renderScreen(ready([GROUPON, LINKEDIN]));
    const surface = within(card()).getByRole('heading', { level: 2 }).parentElement!;
    const touch = { pointerType: 'touch', pointerId: 1 };
    fireEvent.pointerDown(surface, { ...touch, clientX: 200, clientY: 200 });
    fireEvent.pointerUp(surface, { ...touch, clientX: 80, clientY: 203 });
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(useTriageStore.getState().pendingAction?.verb).toBe('Archive');
  });
});
