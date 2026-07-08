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
 *   - the at-limit connect gate disables the connect button
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { QueryWrapper, createTestQueryClient } from '@/test/query-wrapper';
import { installFetchStub, jsonOk, resetFetchStub } from '@/test/fetch-stub';
import type { Me } from '@/features/auth/api/use-me';
import { resetTriageStore, useTriageStore } from '@/features/triage/store';
import { SettingsScreen } from './settings-screen';

const MAILBOX_A = '11111111-1111-4111-8111-111111111111';
const MAILBOX_B = '22222222-2222-4222-8222-222222222222';

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

function renderScreen() {
  return render(
    <QueryWrapper client={createTestQueryClient()}>
      <SettingsScreen />
    </QueryWrapper>,
  );
}

describe('SettingsScreen', () => {
  beforeEach(() => {
    me = makeMe([
      mailbox(MAILBOX_A, 'chintan.a.thakkar@gmail.com'),
      mailbox(MAILBOX_B, 'chintan.a.thakkar.crypt@gmail.com'),
    ]);
    search = '';
    resetTriageStore();
    installFetchStub(happyHandlers());
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => resetFetchStub());

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
    // Reconnect routes to the same OAuth flow as connect-another; at
    // the pro limit (2 of 2 active) the BE start route would 402, so
    // the affordance is disabled with the upgrade title (mirrors the
    // account menu's disconnected-row gate).
    const reconnect = screen.getByRole('button', {
      name: 'Reconnect chintan.a.thakkar.crypt@gmail.com',
    });
    expect(reconnect).toBeDisabled();

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
    search = 'cancelDeletion=1';
    renderScreen();

    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled());
    const section = screen.getByTestId('settings-account-section');
    expect(section.style.outline).not.toBe('none');
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
});
