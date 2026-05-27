/**
 * Tests for `AutopilotScreen` — the D104 + D105 surface.
 *
 * Covers the four edge-state branches (D211/D212) plus the two
 * mutation behaviours that gate the contract:
 *
 *   - D104 — clicking Dismiss on a row fires `POST
 *     /api/autopilot/matches/:id/dismiss` exactly once.
 *   - D105 — clicking "Pause all" opens the D226 mandatory preview
 *     modal; the mutation does not fire until Confirm is clicked.
 *   - D105 — the paused banner renders only when every rule is paused
 *     AND the Pause-all CTA goes disabled.
 *
 * The screen takes its state via prop so we can drive every branch
 * deterministically without mocking the queries.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { AutopilotScreen } from './autopilot-screen';
import { PENDING_SUGGESTIONS, PRESET_RULES_ALL_PAUSED, PRESET_RULES_OBSERVE } from './fixtures';
import type { AutopilotScreenState, SuggestionWithRule } from './types';
import { installFetchStub, jsonOk, resetFetchStub } from '@/test/fetch-stub';
import { createTestQueryClient } from '@/test/query-wrapper';

function ready(): AutopilotScreenState {
  const suggestions: SuggestionWithRule[] = PENDING_SUGGESTIONS.map((match) => ({
    match,
    rule: PRESET_RULES_OBSERVE.find((r) => r.id === match.ruleId) ?? null,
  }));
  return {
    kind: 'ready',
    rules: PRESET_RULES_OBSERVE,
    suggestions,
  };
}

function renderScreen(state: AutopilotScreenState) {
  const client = createTestQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <AutopilotScreen state={state} />
    </QueryClientProvider>,
  );
}

describe('AutopilotScreen — edge states', () => {
  beforeEach(() => installFetchStub([]));
  afterEach(() => resetFetchStub());

  it('renders the loading skeleton', () => {
    renderScreen({ kind: 'loading' });
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders the error empty-state with the carried message', () => {
    renderScreen({ kind: 'error', message: 'API down for maintenance.' });
    expect(
      screen.getByRole('heading', { name: /couldn't load your autopilot/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/api down for maintenance/i)).toBeInTheDocument();
  });

  it('renders the empty-mailbox state when no rules exist', () => {
    renderScreen({ kind: 'empty', rules: [] });
    expect(screen.getByRole('heading', { name: /no autopilot rules yet/i })).toBeInTheDocument();
  });

  it('renders the empty-pending state when rules exist but nothing matched', () => {
    renderScreen({ kind: 'ready', rules: PRESET_RULES_OBSERVE, suggestions: [] });
    expect(screen.getByRole('heading', { name: /no pending suggestions/i })).toBeInTheDocument();
  });

  it('renders one row per pending suggestion with the rule name', () => {
    renderScreen(ready());
    expect(screen.getAllByRole('listitem')).toHaveLength(PENDING_SUGGESTIONS.length);
    expect(screen.getAllByText(/auto-archive low-engagement/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/newsletter graveyard/i)).toBeInTheDocument();
  });

  it('shows the paused banner + disables Pause-all when every rule is paused', () => {
    renderScreen({ kind: 'ready', rules: PRESET_RULES_ALL_PAUSED, suggestions: [] });
    expect(screen.getByText(/autopilot paused/i)).toBeInTheDocument();
    const pauseAll = screen.getByRole('button', { name: /pause every autopilot rule/i });
    expect(pauseAll).toBeDisabled();
  });
});

describe('AutopilotScreen — dismiss (D104)', () => {
  beforeEach(() => installFetchStub([]));
  afterEach(() => resetFetchStub());

  it('POSTs the dismiss endpoint when the row Dismiss button is clicked', async () => {
    const observed: string[] = [];
    installFetchStub([
      {
        method: 'POST',
        path: /\/api\/autopilot\/matches\/[^/]+\/dismiss$/,
        respond: (req, url) => {
          observed.push(url.pathname);
          return jsonOk({
            data: { resolution: 'dismissed', resolvedAt: '2026-05-26T10:00:00.000Z' },
          });
        },
      },
    ]);

    renderScreen(ready());

    const dismissButtons = screen.getAllByRole('button', { name: /^dismiss suggestion/i });
    expect(dismissButtons.length).toBeGreaterThan(0);
    await userEvent.click(dismissButtons[0]!);

    await waitFor(() => expect(observed).toHaveLength(1));
    expect(observed[0]).toMatch(
      /\/api\/autopilot\/matches\/00000000-0000-0000-0000-0000000000a1\/dismiss$/,
    );
  });
});

describe('AutopilotScreen — pause-all (D105 + D226)', () => {
  beforeEach(() => installFetchStub([]));
  afterEach(() => resetFetchStub());

  it('opens the mandatory preview modal on Pause-all click; does NOT fire the mutation yet (D226)', async () => {
    const observed: string[] = [];
    installFetchStub([
      {
        method: 'POST',
        path: '/api/autopilot/pause-all',
        respond: (req, url) => {
          observed.push(url.pathname);
          return jsonOk({ data: { pausedCount: 3 } });
        },
      },
    ]);

    renderScreen(ready());
    await userEvent.click(screen.getByRole('button', { name: /pause every autopilot rule/i }));

    // Modal renders — the preview MUST be visible before the mutation.
    expect(screen.getByRole('dialog', { name: /pause/i })).toBeInTheDocument();
    expect(screen.getByText(/before anything changes/i)).toBeInTheDocument();

    // No network call yet.
    expect(observed).toHaveLength(0);
  });

  it('fires pause-all only after Confirm is clicked', async () => {
    const observed: string[] = [];
    installFetchStub([
      {
        method: 'POST',
        path: '/api/autopilot/pause-all',
        respond: (req, url) => {
          observed.push(url.pathname);
          return jsonOk({ data: { pausedCount: 3 } });
        },
      },
    ]);

    renderScreen(ready());
    await userEvent.click(screen.getByRole('button', { name: /pause every autopilot rule/i }));

    // The modal's "Pause all" button is the confirm action. Find it
    // inside the dialog so we don't grab the header CTA.
    const dialog = screen.getByRole('dialog', { name: /pause/i });
    const confirm = within(dialog).getByRole('button', { name: /pause all/i });
    await userEvent.click(confirm);

    await waitFor(() => expect(observed).toHaveLength(1));
    expect(observed[0]).toBe('/api/autopilot/pause-all');
  });

  it('cancels without firing the mutation', async () => {
    const observed: string[] = [];
    installFetchStub([
      {
        method: 'POST',
        path: '/api/autopilot/pause-all',
        respond: (req, url) => {
          observed.push(url.pathname);
          return jsonOk({ data: { pausedCount: 3 } });
        },
      },
    ]);

    renderScreen(ready());
    await userEvent.click(screen.getByRole('button', { name: /pause every autopilot rule/i }));

    const dialog = screen.getByRole('dialog', { name: /pause/i });
    await userEvent.click(within(dialog).getByRole('button', { name: /cancel/i }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(observed).toHaveLength(0);
  });
});
