/**
 * Tests for `SettingsScreen` (U23 — D34/D114/D116/D216) — the live
 * wiring of the settings index:
 *
 *   - every section renders (Mailboxes / Actions / Notifications /
 *     Autopilot / Quiet hours / Senders / Privacy / Cookies / Plan /
 *     Account) with #218's deletion section mounted, plus the D114
 *     left-nav anchor rail
 *   - D34 toggle → PATCH /api/me/action-sheet-prefs with the single
 *     changed key, and the triage Zustand store mirrors the result
 *   - D165 per-category email toggles → PATCH /api/me/email-prefs
 *     round trips (reminders + syncComplete)
 *   - mailbox health: last-synced stamp renders; an InvalidGrantError
 *     sync status renders "Needs reconnect" + the Reconnect affordance
 *   - billing 503 renders the honest "not enabled" copy (never a fake
 *     "Free" — CLAUDE.md §10 no-fake-billing-state)
 *   - settings read failure renders per-card retry, not a blank page
 *   - ?cancelDeletion=1 deep link scrolls to + highlights the Account
 *     section
 *   - reconnect OAuth results use controlled privacy-safe copy, focus
 *     the exact UUID-bound row when present, then scrub transient URL
 *     context without dropping unrelated query parameters
 *   - the at-limit connect gate disables the connect button
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from '@declutrmail/shared';

import { QueryWrapper, createTestQueryClient } from '@/test/query-wrapper';
import { installFetchStub, jsonOk, resetFetchStub } from '@/test/fetch-stub';
import type { Me } from '@/features/auth/api/use-me';
import { resetTriageStore, useTriageStore } from '@/features/triage/store';
import { SettingsScreen } from './settings-screen';

const MAILBOX_A = '11111111-1111-4111-8111-111111111111';
const MAILBOX_B = '22222222-2222-4222-8222-222222222222';
const MAILBOX_C = '33333333-3333-4333-8333-333333333333';

const startMailboxConnectSpy = vi.fn();
const scrollIntoViewSpy = vi.fn();

vi.mock('@declutrmail/shared', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, toast: vi.fn() };
});

vi.mock('@/features/mailboxes/connect-mailbox-url', () => ({
  startMailboxConnect: (mailboxId?: string) => startMailboxConnectSpy(mailboxId),
}));

let me: Me;
let search: string;

vi.mock('@/features/auth/auth-provider', () => ({
  useAuth: () => ({ me }),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(search),
}));

const mailbox = (id: string, email: string): Me['mailboxes'][number] => ({
  id,
  email,
  status: 'active',
  connectedAt: '2026-06-01T00:00:00.000Z',
  readiness: 'ready',
});

function makeMe(mailboxes: Me['mailboxes']): Me {
  return {
    user: { id: 'u-1', email: 'chintan.a.thakkar@gmail.com', workspaceId: 'ws-1' },
    mailboxes,
    activeMailboxId: mailboxes[0]?.id ?? null,
    tier: 'pro',
    cleanupRemaining: null,
  };
}

const DELETION_STATUS = {
  request: null,
  projection: {
    flatGraceAt: '2026-06-19T00:00:00.000Z',
    latestUndoExpiresAt: null,
    activeUndoCount: 0,
    projectedEffectiveAt: '2026-06-19T00:00:00.000Z',
    projectedBasis: 'flat-grace' as const,
  },
};

const SETTINGS_PAYLOAD = {
  emailPrefs: { reminders: true, syncComplete: true },
  actionSheetPrefs: { archive: false, unsubscribe: false, later: false },
};

const SUBSCRIPTION_PAYLOAD = {
  tier: 'pro' as const,
  foundingMember: false,
  subscription: null,
};

/** Healthy per-mailbox sync status (the useMailboxesHealth read). */
function readySyncStatus(overrides: Record<string, unknown> = {}) {
  return {
    readiness_status: 'ready',
    current_stage: 'ready',
    progress_pct: 100,
    is_ready_for_triage: true,
    last_synced_at: '2026-01-01T00:00:00.000Z',
    last_sync_error_at: null,
    last_sync_error_code: null,
    ...overrides,
  };
}

/** Default happy-path handlers; tests override per scenario. */
function happyHandlers() {
  return [
    {
      method: 'GET' as const,
      path: '/api/me/settings',
      respond: () => jsonOk({ data: SETTINGS_PAYLOAD }),
    },
    {
      method: 'GET' as const,
      path: '/api/v1/sync/status',
      respond: () => jsonOk({ data: readySyncStatus() }),
    },
    {
      method: 'GET' as const,
      path: '/api/billing/subscription',
      respond: () => jsonOk({ data: SUBSCRIPTION_PAYLOAD }),
    },
    {
      method: 'GET' as const,
      path: '/api/account/deletion',
      respond: () => jsonOk({ data: DELETION_STATUS }),
    },
  ];
}

function renderScreen(client = createTestQueryClient()) {
  return render(
    <QueryWrapper client={client}>
      <SettingsScreen />
    </QueryWrapper>,
  );
}

function setSettingsLocation(nextSearch = '', hash = '') {
  search = nextSearch;
  const query = nextSearch ? `?${nextSearch}` : '';
  window.history.replaceState(null, '', `/settings${query}${hash}`);
}

describe('SettingsScreen', () => {
  beforeEach(() => {
    me = makeMe([
      mailbox(MAILBOX_A, 'chintan.a.thakkar@gmail.com'),
      mailbox(MAILBOX_B, 'chintan.a.thakkar.crypt@gmail.com'),
    ]);
    setSettingsLocation();
    startMailboxConnectSpy.mockClear();
    vi.mocked(toast).mockClear();
    scrollIntoViewSpy.mockClear();
    resetTriageStore();
    installFetchStub(happyHandlers());
    Element.prototype.scrollIntoView = scrollIntoViewSpy;
  });
  afterEach(() => {
    resetFetchStub();
    window.history.replaceState(null, '', '/settings');
  });

  it('renders every section, including the mounted deletion section', async () => {
    renderScreen();

    expect(screen.getByRole('heading', { name: 'Mailboxes' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Action preferences' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Email notifications' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Autopilot rules' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Quiet hours' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Standing policies' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Privacy & Data' })).toBeInTheDocument();
    // D147 cookie change/withdrawal card, with the effective default
    // (no stored choice → essential-only) selected.
    expect(screen.getByRole('heading', { name: 'Cookie preferences' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /essential only/i })).toBeChecked();
    expect(screen.getByRole('heading', { name: 'Plan & Billing' })).toBeInTheDocument();
    // #218's AccountDeletionSection.
    expect(screen.getByRole('heading', { name: 'Delete account and data' })).toBeInTheDocument();
    // Both mailboxes listed.
    expect(screen.getByText('chintan.a.thakkar.crypt@gmail.com')).toBeInTheDocument();
    // The D114 left-nav anchor rail.
    const nav = screen.getByRole('navigation', { name: /settings sections/i });
    expect(nav).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Notifications' })).toHaveAttribute(
      'href',
      '#notifications',
    );
    expect(within(nav).getByRole('link', { name: 'Account' })).toHaveAttribute('href', '#account');
    // Plan summary resolves from the billing read.
    await waitFor(() => expect(screen.getByText('Pro')).toBeInTheDocument());
    // Humanized last-synced stamps resolve from the per-mailbox
    // sync-status reads (one per active mailbox).
    await waitFor(() => expect(screen.getAllByText(/^Synced .+ ago$/)).toHaveLength(2));
  });

  it('renders "Needs reconnect" + the Reconnect affordance on an invalid grant', async () => {
    me = { ...me, activeMailboxId: MAILBOX_B };
    installFetchStub([
      ...happyHandlers().filter((h) => h.path !== '/api/v1/sync/status'),
      {
        method: 'GET',
        path: '/api/v1/sync/status',
        respond: (req) =>
          // Mailbox B's token is revoked; A stays healthy. The health
          // hook stamps X-Active-Mailbox-Id per mailbox.
          jsonOk({
            data:
              req.headers.get('X-Active-Mailbox-Id') === MAILBOX_B
                ? readySyncStatus({
                    last_sync_error_at: '2026-07-08T10:00:00.000Z',
                    last_sync_error_code: 'InvalidGrantError',
                  })
                : readySyncStatus(),
          }),
      },
    ]);
    renderScreen();

    await waitFor(() => expect(screen.getByText('Needs reconnect')).toBeInTheDocument());
    const revokedRow = screen
      .getByText('chintan.a.thakkar.crypt@gmail.com')
      .closest('li') as HTMLElement;
    expect(within(revokedRow).getByText('Selected')).toBeInTheDocument();
    expect(within(revokedRow).queryByText('Active')).not.toBeInTheDocument();
    // This mailbox is already one of the two active accounts, so
    // re-authorizing it consumes no new slot and remains available at
    // the Pro limit. Its id binds Google's returned identity to B.
    const reconnect = screen.getByRole('button', {
      name: 'Reconnect chintan.a.thakkar.crypt@gmail.com',
    });
    expect(reconnect).toBeEnabled();
    await userEvent.click(reconnect);
    expect(startMailboxConnectSpy).toHaveBeenCalledWith(MAILBOX_B);

    // A healthy mailbox never shows the affordance.
    expect(
      screen.queryByRole('button', { name: 'Reconnect chintan.a.thakkar@gmail.com' }),
    ).not.toBeInTheDocument();
  });

  it('offers an enabled Reconnect for a disconnected mailbox under the limit', async () => {
    me = makeMe([
      mailbox(MAILBOX_A, 'chintan.a.thakkar@gmail.com'),
      { ...mailbox(MAILBOX_B, 'chintan.a.thakkar.crypt@gmail.com'), status: 'disconnected' },
    ]);
    renderScreen();

    const reconnect = await screen.findByRole('button', {
      name: 'Reconnect chintan.a.thakkar.crypt@gmail.com',
    });
    // One active of two allowed — reconnecting is allowed.
    expect(reconnect).toBeEnabled();
    expect(screen.getByText('Disconnected')).toBeInTheDocument();
    await userEvent.click(reconnect);
    expect(startMailboxConnectSpy).toHaveBeenCalledWith(undefined);
  });

  it('keeps a disconnected reconnect limit-gated when all active slots are occupied', async () => {
    me = makeMe([
      mailbox(MAILBOX_A, 'chintan.a.thakkar@gmail.com'),
      mailbox(MAILBOX_B, 'chintan.a.thakkar.crypt@gmail.com'),
      {
        ...mailbox(MAILBOX_C, 'chintan.a.thakkar.archive@gmail.com'),
        status: 'disconnected',
      },
    ]);
    renderScreen();

    const reconnect = await screen.findByRole('button', {
      name: 'Reconnect chintan.a.thakkar.archive@gmail.com',
    });
    await waitFor(() => expect(reconnect).toBeDisabled());
    const describedBy = reconnect.getAttribute('aria-describedby');
    expect(describedBy).toBe('mailboxes-inbox-limit-explanation');
    expect(document.getElementById(describedBy!)).toHaveTextContent(
      /your plan includes 2 connected inboxes/i,
    );
    expect(startMailboxConnectSpy).not.toHaveBeenCalled();
  });

  it('D34 toggle PATCHes the single changed key and mirrors into the triage store', async () => {
    const patches: unknown[] = [];
    installFetchStub([
      ...happyHandlers(),
      {
        method: 'PATCH',
        path: '/api/me/action-sheet-prefs',
        respond: async (req) => {
          const body = (await req.json()) as Record<string, boolean>;
          patches.push(body);
          return jsonOk({
            data: {
              actionSheetPrefs: { archive: false, unsubscribe: false, later: false, ...body },
            },
          });
        },
      },
    ]);
    renderScreen();

    const toggle = await screen.findByRole('switch', {
      name: /skip the action sheet for unsubscribe/i,
    });
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    await userEvent.click(toggle);

    await waitFor(() => expect(patches).toEqual([{ unsubscribe: true }]));
    // Store mirror — the action sheet reads this; the very next
    // Unsubscribe goes inline without a refetch.
    await waitFor(() =>
      expect(useTriageStore.getState().rememberPreference.Unsubscribe).toBe(true),
    );
    expect(useTriageStore.getState().rememberPreference.Archive).toBe(false);
  });

  it('email reminders toggle round-trips through PATCH /api/me/email-prefs', async () => {
    const patches: unknown[] = [];
    installFetchStub([
      ...happyHandlers(),
      {
        method: 'PATCH',
        path: '/api/me/email-prefs',
        respond: async (req) => {
          const body = (await req.json()) as Record<string, boolean>;
          patches.push(body);
          return jsonOk({
            data: {
              emailPrefs: {
                reminders: body.reminders ?? true,
                syncComplete: body.syncComplete ?? true,
              },
            },
          });
        },
      },
    ]);
    renderScreen();

    const toggle = await screen.findByRole('switch', { name: /disable reminder emails/i });
    await userEvent.click(toggle);

    await waitFor(() => expect(patches).toEqual([{ reminders: false }]));
    // The switch reflects the server-confirmed state.
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: /enable reminder emails/i })).toBeInTheDocument(),
    );
  });

  it('sync-completion toggle PATCHes only the syncComplete key (D165)', async () => {
    const patches: unknown[] = [];
    installFetchStub([
      ...happyHandlers(),
      {
        method: 'PATCH',
        path: '/api/me/email-prefs',
        respond: async (req) => {
          const body = (await req.json()) as Record<string, boolean>;
          patches.push(body);
          return jsonOk({
            data: {
              emailPrefs: {
                reminders: body.reminders ?? true,
                syncComplete: body.syncComplete ?? true,
              },
            },
          });
        },
      },
    ]);
    renderScreen();

    const toggle = await screen.findByRole('switch', {
      name: /disable sync completion alerts/i,
    });
    await userEvent.click(toggle);

    await waitFor(() => expect(patches).toEqual([{ syncComplete: false }]));
    await waitFor(() =>
      expect(
        screen.getByRole('switch', { name: /enable sync completion alerts/i }),
      ).toBeInTheDocument(),
    );
    // The system row never grows a toggle — non-opt-out per D165.
    expect(screen.getByText('Always on')).toBeInTheDocument();
    expect(screen.getByText('Account notices')).toBeInTheDocument();
  });

  it('renders the honest billing-unavailable copy on 503 (no fake Free)', async () => {
    installFetchStub([
      ...happyHandlers().filter((h) => h.path !== '/api/billing/subscription'),
      {
        method: 'GET',
        path: '/api/billing/subscription',
        respond: () =>
          new Response(JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE' } }), {
            status: 503,
            headers: { 'content-type': 'application/json' },
          }),
      },
    ]);
    renderScreen();

    await waitFor(() =>
      expect(screen.getByText(/billing is not enabled in this environment/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/current plan/i)).not.toBeInTheDocument();
    // The billing link still works — /billing owns the rest.
    expect(screen.getByRole('link', { name: /manage plan & billing/i })).toHaveAttribute(
      'href',
      '/billing',
    );
  });

  it('renders per-card retry when the settings read fails (page stays usable)', async () => {
    installFetchStub([
      ...happyHandlers().filter((h) => h.path !== '/api/me/settings'),
      {
        method: 'GET',
        path: '/api/me/settings',
        respond: () =>
          new Response(JSON.stringify({ error: { code: 'INTERNAL' } }), {
            status: 500,
            headers: { 'content-type': 'application/json' },
          }),
      },
    ]);
    renderScreen();

    await waitFor(() =>
      expect(screen.getByText(/could not load action preferences/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/could not load email preferences/i)).toBeInTheDocument();
    // The rest of the page is intact (partial-error by construction).
    expect(screen.getByRole('heading', { name: 'Mailboxes' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /retry/i }).length).toBeGreaterThanOrEqual(2);
  });

  it('?cancelDeletion=1 scrolls to and highlights the Account section', async () => {
    setSettingsLocation('cancelDeletion=1');
    renderScreen();

    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled());
    const section = screen.getByTestId('settings-account-section');
    expect(section.style.outline).not.toBe('none');
  });

  it.each([
    {
      result: 'success',
      message: 'Gmail reconnected. Sync status is shown below.',
      tone: 'success',
      liveRole: 'status',
    },
    {
      result: 'account_mismatch',
      message:
        'That was a different Google account. Retry Reconnect next to the Gmail address you intended to restore.',
      tone: 'danger',
      liveRole: 'alert',
    },
    {
      result: 'target_invalid',
      message: 'Could not match that reconnect request to an active mailbox. Try again below.',
      tone: 'danger',
      liveRole: 'alert',
    },
    {
      result: 'cancelled',
      message: 'Gmail reconnect was cancelled. Nothing changed.',
      tone: 'info',
      liveRole: 'status',
    },
    {
      result: 'failed',
      message: 'Could not reconnect Gmail. Try again from this mailbox list.',
      tone: 'danger',
      liveRole: 'alert',
    },
  ] as const)(
    'shows the controlled $result reconnect result exactly once',
    async ({ result, message, tone, liveRole }) => {
      setSettingsLocation(`reconnect_result=${result}`, `#mailbox-${MAILBOX_A}`);
      renderScreen();

      await waitFor(() => expect(toast).toHaveBeenCalledWith(message, tone));
      const announcement = screen.getByTestId(`reconnect-result-${liveRole}`);
      const otherRegion = screen.getByTestId(
        `reconnect-result-${liveRole === 'status' ? 'alert' : 'status'}`,
      );
      expect(announcement).toHaveAttribute('aria-atomic', 'true');
      expect(announcement).toHaveTextContent(message);
      expect(otherRegion).toBeEmptyDOMElement();
      await waitFor(() => expect(screen.getAllByText(/^Synced .+ ago$/)).toHaveLength(2));
      expect(toast).toHaveBeenCalledTimes(1);

      const serializedCalls = JSON.stringify(vi.mocked(toast).mock.calls);
      expect(serializedCalls).not.toContain(MAILBOX_A);
      expect(serializedCalls).not.toContain('chintan.a.thakkar@gmail.com');
    },
  );

  it('pre-mounts empty polite and assertive regions, then populates only the result region', async () => {
    const client = createTestQueryClient();
    const view = renderScreen(client);

    const statusRegion = screen.getByTestId('reconnect-result-status');
    const alertRegion = screen.getByTestId('reconnect-result-alert');
    expect(statusRegion).toHaveAttribute('role', 'status');
    expect(statusRegion).toHaveAttribute('aria-live', 'polite');
    expect(alertRegion).toHaveAttribute('role', 'alert');
    expect(alertRegion).toHaveAttribute('aria-live', 'assertive');
    expect(statusRegion).toBeEmptyDOMElement();
    expect(alertRegion).toBeEmptyDOMElement();

    setSettingsLocation('reconnect_result=failed', `#mailbox-${MAILBOX_A}`);
    view.rerender(
      <QueryWrapper client={client}>
        <SettingsScreen />
      </QueryWrapper>,
    );

    await waitFor(() =>
      expect(alertRegion).toHaveTextContent(
        'Could not reconnect Gmail. Try again from this mailbox list.',
      ),
    );
    expect(statusRegion).toBeEmptyDOMElement();
  });

  it('announces and scrubs the reconnect return without waiting for settings or billing reads', async () => {
    const pendingResponse = new Promise<Response>(() => undefined);
    installFetchStub([
      ...happyHandlers().filter(
        (handler) =>
          handler.path !== '/api/me/settings' && handler.path !== '/api/billing/subscription',
      ),
      {
        method: 'GET',
        path: '/api/me/settings',
        respond: () => pendingResponse,
      },
      {
        method: 'GET',
        path: '/api/billing/subscription',
        respond: () => pendingResponse,
      },
    ]);
    setSettingsLocation('source=oauth&reconnect_result=success', `#mailbox-${MAILBOX_A}`);
    renderScreen();

    expect(screen.getByText('Loading plan…')).toBeInTheDocument();
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('reconnect-result-status')).toHaveTextContent(
      'Gmail reconnected. Sync status is shown below.',
    );
    expect(screen.getByTestId('reconnect-result-alert')).toBeEmptyDOMElement();
    expect(document.activeElement).toBe(document.getElementById(`mailbox-${MAILBOX_A}`));
    expect(new URLSearchParams(window.location.search).get('source')).toBe('oauth');
    expect(new URLSearchParams(window.location.search).has('reconnect_result')).toBe(false);
    expect(window.location.hash).toBe('#mailboxes');
    // Both unrelated reads are still unresolved when the return has
    // already been acknowledged and removed from the address bar.
    expect(screen.getByText('Loading plan…')).toBeInTheDocument();
  });

  it('scrolls and highlights the exact reconnect row, then scrubs only transient URL context', async () => {
    setSettingsLocation(
      'source=account&reconnect_result=success&return=%2Fsettings%2Fprivacy',
      `#mailbox-${MAILBOX_B}`,
    );
    renderScreen();

    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    const row = document.getElementById(`mailbox-${MAILBOX_B}`);
    expect(row).not.toBeNull();
    await waitFor(() => expect(row).toHaveAttribute('data-reconnect-highlighted', 'true'));
    expect(row).toHaveAttribute('tabindex', '-1');
    expect(document.activeElement).toBe(row);
    expect(row?.style.outline).not.toBe('none');
    expect(scrollIntoViewSpy.mock.contexts).toContain(row);
    expect(scrollIntoViewSpy.mock.contexts).not.toContain(document.getElementById('mailboxes'));

    const remainingParams = new URLSearchParams(window.location.search);
    expect([...remainingParams.entries()]).toEqual([
      ['source', 'account'],
      ['return', '/settings/privacy'],
    ]);
    expect(window.location.hash).toBe('#mailboxes');
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it('falls back to the Mailboxes section when the reconnect fragment is missing', async () => {
    setSettingsLocation('reconnect_result=cancelled');
    renderScreen();

    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    const section = document.getElementById('mailboxes');
    expect(section).toHaveAttribute('tabindex', '-1');
    expect(document.activeElement).toBe(section);
    expect(scrollIntoViewSpy.mock.contexts).toContain(section);
    expect(document.querySelector('[data-reconnect-highlighted="true"]')).toBeNull();
    expect(window.location.hash).toBe('#mailboxes');
  });

  it('falls back when a valid reconnect UUID has no matching mailbox row', async () => {
    setSettingsLocation('reconnect_result=failed', `#mailbox-${MAILBOX_C}`);
    renderScreen();

    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    expect(document.getElementById(`mailbox-${MAILBOX_C}`)).toBeNull();
    const section = document.getElementById('mailboxes');
    expect(document.activeElement).toBe(section);
    expect(scrollIntoViewSpy.mock.contexts).toContain(section);
    expect(window.location.hash).toBe('#mailboxes');
  });

  it('rejects a malformed reconnect fragment without passing it into a DOM selector or id lookup', async () => {
    const getElementByIdSpy = vi.spyOn(document, 'getElementById');
    const querySelectorSpy = vi.spyOn(Document.prototype, 'querySelector');
    setSettingsLocation('reconnect_result=failed', '#mailbox-%5Bdata-danger%3Dtrue%5D');
    renderScreen();

    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    expect(getElementByIdSpy.mock.calls.some(([id]) => id.startsWith('mailbox-'))).toBe(false);
    expect(querySelectorSpy.mock.calls.some(([selector]) => selector.includes('mailbox-'))).toBe(
      false,
    );
    const section = document.getElementById('mailboxes');
    expect(document.activeElement).toBe(section);
    expect(scrollIntoViewSpy.mock.contexts).toContain(section);
    expect(window.location.hash).toBe('#mailboxes');

    getElementByIdSpy.mockRestore();
    querySelectorSpy.mockRestore();
  });

  it('silently cleans an unknown reconnect result and uses the safe section fallback', async () => {
    setSettingsLocation('source=account&reconnect_result=unexpected', `#mailbox-${MAILBOX_A}`);
    renderScreen();

    await waitFor(() => expect(window.location.hash).toBe('#mailboxes'));
    expect(toast).not.toHaveBeenCalled();
    expect(new URLSearchParams(window.location.search).get('source')).toBe('account');
    expect(new URLSearchParams(window.location.search).has('reconnect_result')).toBe(false);
    expect(screen.getByTestId('reconnect-result-status')).toBeEmptyDOMElement();
    expect(screen.getByTestId('reconnect-result-alert')).toBeEmptyDOMElement();
    const section = document.getElementById('mailboxes');
    expect(document.activeElement).toBe(section);
    expect(scrollIntoViewSpy.mock.contexts).toContain(section);
    expect(document.querySelector('[data-reconnect-highlighted="true"]')).toBeNull();
  });

  it('disables connect-another at the tier inboxLimit with an upgrade pointer', async () => {
    // Pro allows 2 inboxes; both are connected → at limit.
    renderScreen();

    const connect = await screen.findByRole('button', { name: /connect another gmail account/i });
    await waitFor(() => expect(connect).toBeDisabled());
    expect(screen.getByRole('link', { name: /upgrade for more/i })).toHaveAttribute(
      'href',
      '/billing',
    );
  });

  it('stays reachable with NO active mailbox and fires no session-scoped sync poll (D216 reachability)', async () => {
    // A user who disconnected their last Gmail: the layout now renders
    // /settings through the no-active-mailbox gate, so the real screen
    // must render its account/deletion + billing exits without any
    // mailbox-scoped 409 (useMailboxesHealth queries only active
    // mailboxes → none here).
    me = makeMe([]); // zero mailboxes → activeMailboxId null
    const syncSpy = vi.fn(() => jsonOk({ data: readySyncStatus() }));
    installFetchStub([
      {
        method: 'GET',
        path: '/api/me/settings',
        respond: () => jsonOk({ data: SETTINGS_PAYLOAD }),
      },
      {
        method: 'GET',
        path: '/api/billing/subscription',
        respond: () => jsonOk({ data: SUBSCRIPTION_PAYLOAD }),
      },
      {
        method: 'GET',
        path: '/api/account/deletion',
        respond: () => jsonOk({ data: DELETION_STATUS }),
      },
      { method: 'GET', path: '/api/v1/sync/status', respond: syncSpy },
    ]);

    renderScreen();

    // The exits that must survive zero mailboxes.
    expect(
      await screen.findByRole('heading', { name: 'Delete account and data' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Privacy & Data' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Plan & Billing' })).toBeInTheDocument();
    // The "no mailboxes connected" empty state, not a broken list.
    expect(screen.getByText(/no mailboxes connected/i)).toBeInTheDocument();
    // No active mailbox ⇒ no session-scoped sync poll ⇒ no 409 risk.
    expect(syncSpy).not.toHaveBeenCalled();
  });
});
