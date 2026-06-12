/**
 * Tests for `AutopilotScreen` — the D99–D105 surface (U15).
 *
 * Covers the edge-state branches (D211/D212) plus the mutation
 * behaviours that gate the contract:
 *
 *   - D101 — the rules list renders every preset with its toggle;
 *     toggling fires `PATCH /api/autopilot/rules/:id` (settings-grade
 *     mutation — no mail moves, no preview required); the threshold
 *     slider commits once on release.
 *   - D104 — clicking Dismiss on a row fires `POST
 *     /api/autopilot/matches/:id/dismiss` exactly once.
 *   - D104 + D226 — Approve all / Approve selected open the mandatory
 *     preview modal; the mutation does not fire until Confirm.
 *   - D104 day-7 — the observe-window banner renders only for elapsed
 *     rules; "Switch to Active" previews first, then PATCHes
 *     `mode='active'`. No auto-promotion exists anywhere.
 *   - D103/D192 — "Preview matches" fires the dry-run POST and renders
 *     the would-match count.
 *   - D105 — pause-all keeps its previewed lifecycle.
 *
 * The screen takes its state via prop so we can drive every branch
 * deterministically without mocking the queries.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { AutopilotScreen } from './autopilot-screen';
import {
  AUTO_ARCHIVE_LOW_ENGAGEMENT,
  PENDING_SUGGESTIONS,
  PRESET_RULES_ALL_FIVE,
  PRESET_RULES_ALL_PAUSED,
  PRESET_RULES_OBSERVE,
  RULE_PREVIEW_RESULT,
} from './fixtures';
import type { AutopilotScreenState, SuggestionWithRule } from './types';
import { installFetchStub, jsonOk, resetFetchStub } from '@/test/fetch-stub';
import { createTestQueryClient } from '@/test/query-wrapper';

function ready(rules = PRESET_RULES_OBSERVE): AutopilotScreenState {
  const suggestions: SuggestionWithRule[] = PENDING_SUGGESTIONS.map((match) => ({
    match,
    rule: rules.find((r) => r.id === match.ruleId) ?? null,
  }));
  return {
    kind: 'ready',
    rules,
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

  it('renders the loading skeletons (rules + suggestions)', () => {
    renderScreen({ kind: 'loading' });
    expect(screen.getAllByRole('status').length).toBeGreaterThanOrEqual(2);
  });

  it('renders ONE error state for the whole surface with the carried message', () => {
    renderScreen({ kind: 'error', message: 'API down for maintenance.' });
    expect(screen.getAllByRole('heading', { name: /couldn't load your autopilot/i })).toHaveLength(
      1,
    );
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

  it('groups pending suggestions under their rule (D104)', () => {
    renderScreen(ready());
    // Two groups — auto-archive (2 rows) + newsletter graveyard (1 row).
    const archiveGroup = screen.getByRole('list', {
      name: /pending suggestions from auto-archive low-engagement — rows/i,
    });
    expect(within(archiveGroup).getAllByRole('listitem')).toHaveLength(2);
    const graveyardGroup = screen.getByRole('list', {
      name: /pending suggestions from newsletter graveyard — rows/i,
    });
    expect(within(graveyardGroup).getAllByRole('listitem')).toHaveLength(1);
  });

  it('marks counts as floors when the buffer hits the 50-row BE cap', () => {
    const base = PENDING_SUGGESTIONS[0]!;
    const suggestions: SuggestionWithRule[] = Array.from({ length: 50 }, (_, i) => ({
      match: { ...base, id: `00000000-0000-0000-0000-0000000001${String(i).padStart(2, '0')}` },
      rule: PRESET_RULES_OBSERVE[0]!,
    }));
    renderScreen({ kind: 'ready', rules: PRESET_RULES_OBSERVE, suggestions });
    // Section header says 50+ — a page count, not a total claim.
    expect(screen.getByText(/50\+ waiting/)).toBeInTheDocument();
    // Rule-card meta switches to the "latest 50" phrasing.
    expect(screen.getAllByText(/pending in the latest 50/i).length).toBeGreaterThan(0);
  });

  it('shows the paused banner + disables Pause-all when every rule is paused', () => {
    renderScreen({ kind: 'ready', rules: PRESET_RULES_ALL_PAUSED, suggestions: [] });
    expect(screen.getByText(/autopilot paused/i)).toBeInTheDocument();
    const pauseAll = screen.getByRole('button', { name: /pause every autopilot rule/i });
    expect(pauseAll).toBeDisabled();
  });
});

describe('AutopilotScreen — rules management (D101)', () => {
  beforeEach(() => installFetchStub([]));
  afterEach(() => resetFetchStub());

  it('renders one card per rule with an enabled switch and canonical verbs only (D227)', () => {
    renderScreen({ kind: 'ready', rules: PRESET_RULES_ALL_FIVE, suggestions: [] });
    const rulesList = screen.getByRole('list', { name: /autopilot rules/i });
    expect(within(rulesList).getAllByRole('listitem')).toHaveLength(5);
    expect(within(rulesList).getAllByRole('switch')).toHaveLength(5);
    // D227 — the screen-new-senders preset surfaces as Later, never "Screen".
    expect(within(rulesList).getByText(/later for new senders/i)).toBeInTheDocument();
    expect(within(rulesList).queryByText(/auto-screen/i)).not.toBeInTheDocument();
  });

  it('PATCHes { enabled: false } when an enabled rule is toggled off', async () => {
    const observed: Array<{ path: string; body: unknown }> = [];
    installFetchStub([
      {
        method: 'PATCH',
        path: /\/api\/autopilot\/rules\/[^/]+$/,
        respond: async (req, url) => {
          observed.push({ path: url.pathname, body: await req.json() });
          return jsonOk({ data: { ...AUTO_ARCHIVE_LOW_ENGAGEMENT, enabled: false } });
        },
      },
    ]);

    renderScreen({ kind: 'ready', rules: [AUTO_ARCHIVE_LOW_ENGAGEMENT], suggestions: [] });
    await userEvent.click(
      screen.getByRole('switch', { name: /disable rule auto-archive low-engagement/i }),
    );

    await waitFor(() => expect(observed).toHaveLength(1));
    expect(observed[0]!.path).toBe(`/api/autopilot/rules/${AUTO_ARCHIVE_LOW_ENGAGEMENT.id}`);
    expect(observed[0]!.body).toEqual({ enabled: false });
  });

  it('commits the threshold once on slider release (D101)', async () => {
    const observed: unknown[] = [];
    installFetchStub([
      {
        method: 'PATCH',
        path: /\/api\/autopilot\/rules\/[^/]+$/,
        respond: async (req) => {
          observed.push(await req.json());
          return jsonOk({ data: { ...AUTO_ARCHIVE_LOW_ENGAGEMENT, confidenceThreshold: 0.9 } });
        },
      },
    ]);

    renderScreen({ kind: 'ready', rules: [AUTO_ARCHIVE_LOW_ENGAGEMENT], suggestions: [] });
    const slider = screen.getByRole('slider', {
      name: /confidence threshold for rule auto-archive low-engagement/i,
    });
    fireEvent.change(slider, { target: { value: '0.9' } });
    expect(observed).toHaveLength(0); // no PATCH while dragging
    fireEvent.blur(slider);

    await waitFor(() => expect(observed).toHaveLength(1));
    expect(observed[0]).toEqual({ confidenceThreshold: 0.9 });
  });

  it('runs the dry-run preview on demand and renders the would-match count (D103/D192)', async () => {
    const observed: string[] = [];
    installFetchStub([
      {
        method: 'POST',
        path: /\/api\/autopilot\/rules\/[^/]+\/preview$/,
        respond: (req, url) => {
          observed.push(url.pathname);
          return jsonOk({ data: RULE_PREVIEW_RESULT });
        },
      },
    ]);

    renderScreen({ kind: 'ready', rules: [AUTO_ARCHIVE_LOW_ENGAGEMENT], suggestions: [] });
    await userEvent.click(
      screen.getByRole('button', {
        name: /preview matches for rule auto-archive low-engagement/i,
      }),
    );

    await waitFor(() => expect(observed).toHaveLength(1));
    expect(observed[0]).toBe(`/api/autopilot/rules/${AUTO_ARCHIVE_LOW_ENGAGEMENT.id}/preview`);
    await waitFor(() =>
      expect(screen.getByText(/senders would match if this rule were active now/i)).toBeVisible(),
    );
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText(/dry-run only — nothing changed/i)).toBeInTheDocument();
  });
});

describe('AutopilotScreen — day-7 observe banner (D104)', () => {
  beforeEach(() => installFetchStub([]));
  afterEach(() => resetFetchStub());

  it('renders the banner only when a rule has an elapsed observe window', () => {
    renderScreen(ready());
    // Fixture rule #1 is elapsed → banner present + honest no-auto-promote copy.
    expect(screen.getByText(/nothing switches on by itself/i)).toBeInTheDocument();
  });

  it('does NOT render the banner when no observe window has elapsed', () => {
    const stillObserving = PRESET_RULES_OBSERVE.map((r) => ({
      ...r,
      observeWindowElapsed: false,
    }));
    renderScreen({ kind: 'ready', rules: stillObserving, suggestions: [] });
    expect(screen.queryByText(/nothing switches on by itself/i)).not.toBeInTheDocument();
  });

  it('previews first (D226), then PATCHes mode=active on confirm — never before', async () => {
    const observed: Array<{ path: string; body: unknown }> = [];
    installFetchStub([
      {
        method: 'PATCH',
        path: /\/api\/autopilot\/rules\/[^/]+$/,
        respond: async (req, url) => {
          observed.push({ path: url.pathname, body: await req.json() });
          return jsonOk({ data: { ...AUTO_ARCHIVE_LOW_ENGAGEMENT, mode: 'active' } });
        },
      },
    ]);

    renderScreen(ready());
    await userEvent.click(
      screen.getByRole('button', { name: /switch rule auto-archive low-engagement to active/i }),
    );

    // Modal renders — the preview MUST be visible before the mutation.
    const dialog = screen.getByRole('dialog', { name: /switch .* to active/i });
    expect(within(dialog).getByText(/before anything changes/i)).toBeInTheDocument();
    expect(observed).toHaveLength(0);

    await userEvent.click(within(dialog).getByRole('button', { name: /switch to active/i }));
    await waitFor(() => expect(observed).toHaveLength(1));
    expect(observed[0]!.body).toEqual({ mode: 'active' });
  });
});

describe('AutopilotScreen — approve flow (D104 + D226)', () => {
  beforeEach(() => installFetchStub([]));
  afterEach(() => resetFetchStub());

  it('Approve all opens the preview modal; POSTs approve-all only after confirm', async () => {
    const observed: string[] = [];
    installFetchStub([
      {
        method: 'POST',
        path: /\/api\/autopilot\/rules\/[^/]+\/approve-all$/,
        respond: (req, url) => {
          observed.push(url.pathname);
          return jsonOk({
            data: { approvedCount: 2, alreadyResolvedCount: 0, executionEnqueued: true },
          });
        },
      },
    ]);

    renderScreen(ready());
    await userEvent.click(
      screen.getByRole('button', {
        name: /approve all suggestions from rule auto-archive low-engagement/i,
      }),
    );

    // Mandatory preview — names the senders, no mutation yet.
    const dialog = screen.getByRole('dialog', { name: /approve 2 suggestions/i });
    expect(within(dialog).getByText(/before anything changes/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/bargain bulletin/i)).toBeInTheDocument();
    expect(observed).toHaveLength(0);

    await userEvent.click(within(dialog).getByRole('button', { name: /approve 2 suggestions/i }));
    await waitFor(() => expect(observed).toHaveLength(1));
    expect(observed[0]).toBe(`/api/autopilot/rules/${AUTO_ARCHIVE_LOW_ENGAGEMENT.id}/approve-all`);
  });

  it('Approve selected sends exactly the checked matchIds', async () => {
    const observed: unknown[] = [];
    installFetchStub([
      {
        method: 'POST',
        path: '/api/autopilot/matches/approve',
        respond: async (req) => {
          observed.push(await req.json());
          return jsonOk({
            data: { approvedCount: 1, alreadyResolvedCount: 0, executionEnqueued: true },
          });
        },
      },
    ]);

    renderScreen(ready());
    // "Approve selected" is disabled until something is checked.
    const approveSelected = screen.getByRole('button', {
      name: /approve selected suggestions from rule auto-archive low-engagement/i,
    });
    expect(approveSelected).toBeDisabled();

    await userEvent.click(
      screen.getByRole('checkbox', { name: /select suggestion for bargain bulletin/i }),
    );
    expect(approveSelected).toBeEnabled();
    await userEvent.click(approveSelected);

    const dialog = screen.getByRole('dialog', { name: /approve 1 suggestion/i });
    expect(observed).toHaveLength(0);
    await userEvent.click(within(dialog).getByRole('button', { name: /approve suggestion/i }));

    await waitFor(() => expect(observed).toHaveLength(1));
    expect(observed[0]).toEqual({ matchIds: ['00000000-0000-0000-0000-0000000000a1'] });
  });

  it('cancelling the approve preview fires nothing', async () => {
    const observed: string[] = [];
    installFetchStub([
      {
        method: 'POST',
        path: /approve/,
        respond: (req, url) => {
          observed.push(url.pathname);
          return jsonOk({
            data: { approvedCount: 0, alreadyResolvedCount: 0, executionEnqueued: false },
          });
        },
      },
    ]);

    renderScreen(ready());
    await userEvent.click(
      screen.getByRole('button', {
        name: /approve all suggestions from rule auto-archive low-engagement/i,
      }),
    );
    const dialog = screen.getByRole('dialog', { name: /approve 2 suggestions/i });
    await userEvent.click(within(dialog).getByRole('button', { name: /cancel/i }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(observed).toHaveLength(0);
  });

  it('orphan groups (rule missing) expose Dismiss only — no approve without a truthful verb', () => {
    const orphanState: AutopilotScreenState = {
      kind: 'ready',
      rules: [],
      suggestions: [{ match: PENDING_SUGGESTIONS[0]!, rule: null }],
    };
    renderScreen(orphanState);
    expect(screen.getByRole('button', { name: /dismiss suggestion/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
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
