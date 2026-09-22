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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useUiStore } from '@declutrmail/shared';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { AutopilotRoute, AutopilotScreen } from './autopilot-screen';
import { ActivateRuleModal } from './activate-rule-modal';
import { ApproveConfirmModal } from './approve-confirm-modal';
import { TIER_MANIFEST } from '@declutrmail/shared/entitlements';
import {
  AUTO_ARCHIVE_LOW_ENGAGEMENT,
  AUTO_UNSUBSCRIBE_NOISY,
  LONG_DORMANT_UNSUBSCRIBE,
  PENDING_SUGGESTIONS,
  PRESET_RULES_ALL_FIVE,
  PRESET_RULES_ALL_PAUSED,
  PRESET_RULES_OBSERVE,
  RULE_PREVIEW_RESULT,
} from './fixtures';
import type { AutopilotScreenState, SuggestionWithRule } from './types';
import type { AutopilotPatternSuggestionDto } from '@/lib/api/autopilot';
import { installFetchStub, jsonOk, jsonServerError, resetFetchStub } from '@/test/fetch-stub';
import { createTestQueryClient } from '@/test/query-wrapper';

const { trackMock, authState } = vi.hoisted(() => ({
  trackMock: vi.fn(),
  authState: {
    activeMailboxId: 'mailbox-a' as string | null,
    tier: 'pro' as 'free' | 'plus' | 'pro',
  },
}));
vi.mock('@/lib/posthog', () => ({ track: trackMock }));
vi.mock('@/features/auth/auth-provider', () => ({
  // D251 — the screen derives `canActivate` from the tier here. `pro` keeps
  // these cases exercising the Activate path; the Plus behaviour has its own
  // cases below.
  useOptionalAuth: () => ({
    me: { activeMailboxId: authState.activeMailboxId, tier: authState.tier },
  }),
  getActiveMailboxEmail: () => 'active@example.com',
}));

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

/** The screen's help text, as registered for the top bar's `?` popover. */
function helpBody(): string {
  return String(useUiStore.getState().screenHelp?.body ?? '');
}

/** One banner shows at a time — step the slot to the next notice. */
function showNextNotice() {
  fireEvent.click(screen.getByRole('button', { name: /show next notice/i }));
}

/** D101's secondary surface sits behind each rule row's Details disclosure. */
function openAllRuleDetails() {
  for (const button of screen.getAllByRole('button', { name: /show details for rule/i })) {
    fireEvent.click(button);
  }
}

function renderScreen(state: AutopilotScreenState) {
  const client = createTestQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <AutopilotScreen state={state} />
    </QueryClientProvider>,
  );
}

function renderRoute() {
  const client = createTestQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <AutopilotRoute />
    </QueryClientProvider>,
  );
}

const PATTERN_SUGGESTION: AutopilotPatternSuggestionDto = {
  ruleId: AUTO_ARCHIVE_LOW_ENGAGEMENT.id,
  presetKey: 'auto_archive_low_engagement',
  ruleName: 'Auto-archive low-engagement',
  actionKind: 'archive',
  scope: 'account',
  evidenceCount: 4,
  evidenceWindowDays: 30,
  dailyActionCap: 100,
};

beforeEach(() => {
  trackMock.mockReset();
  authState.activeMailboxId = 'mailbox-a';
  authState.tier = 'pro';
});

describe('AutopilotScreen — edge states', () => {
  beforeEach(() => installFetchStub([]));
  afterEach(() => resetFetchStub());

  it('renders the loading skeletons (rules + suggestions)', () => {
    renderScreen({ kind: 'loading' });
    expect(screen.getAllByRole('status').length).toBeGreaterThanOrEqual(2);
  });

  it('renders one retryable error state for the whole surface with the carried message', async () => {
    const retry = vi.fn();
    const user = userEvent.setup();
    renderScreen({ kind: 'error', message: 'API down for maintenance.', retry });
    expect(screen.getAllByRole('heading', { name: /couldn't load your autopilot/i })).toHaveLength(
      1,
    );
    expect(screen.getByText(/api down for maintenance/i)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('retries both failed Autopilot reads from the shared error state', async () => {
    let ruleReads = 0;
    let suggestionReads = 0;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/autopilot/rules',
        respond: () => {
          ruleReads += 1;
          return jsonServerError();
        },
      },
      {
        method: 'GET',
        path: '/api/autopilot/pending-suggestions',
        respond: () => {
          suggestionReads += 1;
          return jsonServerError();
        },
      },
    ]);
    const user = userEvent.setup();
    renderRoute();

    await user.click(await screen.findByRole('button', { name: /try again/i }));

    await waitFor(() => {
      expect(ruleReads).toBe(2);
      expect(suggestionReads).toBe(2);
    });
  });

  it('renders the empty-mailbox state when no rules exist', () => {
    renderScreen({ kind: 'empty', rules: [] });
    expect(screen.getByRole('heading', { name: /no autopilot rules yet/i })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
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
    expect(screen.getByText(/^50\+$/)).toBeInTheDocument();
    // Rule details mark a capped per-rule count with "+".
    openAllRuleDetails();
    expect(screen.getAllByText(/^\d+\+ pending$/).length).toBeGreaterThan(0);
  });

  it('heads the screen with one plain title — no eyebrow, no mailbox address', () => {
    renderScreen(ready());
    expect(screen.getByRole('heading', { level: 1, name: 'Autopilot' })).toBeInTheDocument();
    expect(screen.queryByText(/active@example\.com/)).toBeNull();
    expect(screen.queryByText(/default mailbox/i)).toBeNull();
  });

  it('shows the paused banner + disables Pause-all when every rule is paused', () => {
    renderScreen({ kind: 'ready', rules: PRESET_RULES_ALL_PAUSED, suggestions: [] });
    expect(screen.getByText(/paused since|every rule is paused/i)).toBeInTheDocument();
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

  it('explains one repeated-decision suggestion without exposing sender identity (D246)', () => {
    renderScreen({
      kind: 'ready',
      rules: PRESET_RULES_ALL_FIVE,
      suggestions: [],
      patternSuggestion: PATTERN_SUGGESTION,
    });
    // The day-7 prompt outranks the suggestion in the single banner slot.
    showNextNotice();
    const card = screen.getByRole('region', { name: /you archived 4 matching senders/i });
    expect(within(card).getByText(/you approve or skip each suggestion/i)).toBeInTheDocument();
    expect(card.textContent).not.toContain('@');
  });

  it('deduplicates pattern impressions per mailbox and rule across mailbox switches', async () => {
    const state: AutopilotScreenState = {
      kind: 'ready',
      rules: PRESET_RULES_ALL_FIVE,
      suggestions: [],
      patternSuggestion: PATTERN_SUGGESTION,
    };
    const { rerender } = renderScreen(state);

    await waitFor(() =>
      expect(trackMock).toHaveBeenCalledWith(
        'autopilot_pattern_suggestion_shown',
        expect.objectContaining({ preset_key: PATTERN_SUGGESTION.presetKey }),
      ),
    );
    expect(
      trackMock.mock.calls.filter(([event]) => event === 'autopilot_pattern_suggestion_shown'),
    ).toHaveLength(1);

    rerender(
      <QueryClientProvider client={createTestQueryClient()}>
        <AutopilotScreen state={{ ...state }} />
      </QueryClientProvider>,
    );
    expect(
      trackMock.mock.calls.filter(([event]) => event === 'autopilot_pattern_suggestion_shown'),
    ).toHaveLength(1);

    authState.activeMailboxId = 'mailbox-b';
    rerender(
      <QueryClientProvider client={createTestQueryClient()}>
        <AutopilotScreen state={{ ...state }} />
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(
        trackMock.mock.calls.filter(([event]) => event === 'autopilot_pattern_suggestion_shown'),
      ).toHaveLength(2),
    );
  });

  it('shows ONE banner at a time, highest priority first, and steps with "+N"', () => {
    renderScreen({
      kind: 'ready',
      rules: PRESET_RULES_ALL_FIVE,
      suggestions: [],
      patternSuggestion: PATTERN_SUGGESTION,
    });
    // Day-7 prompt wins the slot; the suggestion waits behind "+1".
    expect(screen.getByText(/collected matches for a week/i)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /matching senders/i })).toBeNull();
    expect(screen.getByRole('button', { name: /show next notice, 1 more/i })).toHaveTextContent(
      '+1',
    );

    showNextNotice();
    expect(screen.getByRole('region', { name: /matching senders/i })).toBeInTheDocument();
    expect(screen.queryByText(/collected matches for a week/i)).toBeNull();
  });

  it('offers no "+N" when a single banner is showing', () => {
    renderScreen(ready());
    expect(screen.getByText(/collected matches for a week/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /show next notice/i })).toBeNull();
  });

  it('describes unsubscribe evidence as requests, not confirmed outcomes', () => {
    renderScreen({
      kind: 'ready',
      rules: PRESET_RULES_ALL_FIVE,
      suggestions: [],
      patternSuggestion: {
        ...PATTERN_SUGGESTION,
        ruleId: AUTO_UNSUBSCRIBE_NOISY.id,
        presetKey: 'auto_unsubscribe_noisy',
        actionKind: 'unsubscribe',
      },
    });
    showNextNotice();
    expect(
      screen.getByRole('region', { name: /you requested unsubscribe from 4 matching senders/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/you unsubscribed from/i)).toBeNull();
  });

  it('accepts a current pattern only into Observe through the dedicated endpoint (D246)', async () => {
    const observed: string[] = [];
    installFetchStub([
      {
        method: 'POST',
        path: `/api/autopilot/pattern-suggestion/${PATTERN_SUGGESTION.ruleId}/observe`,
        respond: (_req, url) => {
          observed.push(url.pathname);
          return jsonOk({
            data: {
              ruleId: PATTERN_SUGGESTION.ruleId,
              presetKey: PATTERN_SUGGESTION.presetKey,
              decision: 'observe',
              evidenceCount: PATTERN_SUGGESTION.evidenceCount,
              decidedAt: '2026-07-15T00:00:00.000Z',
            },
          });
        },
      },
    ]);
    renderScreen({
      kind: 'ready',
      rules: PRESET_RULES_ALL_FIVE,
      suggestions: [],
      patternSuggestion: PATTERN_SUGGESTION,
    });

    showNextNotice();
    await userEvent.click(screen.getByRole('button', { name: 'Watch first' }));
    await waitFor(() => expect(observed).toHaveLength(1));
    expect(observed[0]).not.toContain('preview');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('persists Not now separately from the activation prompt (D246)', async () => {
    const observed: string[] = [];
    installFetchStub([
      {
        method: 'POST',
        path: `/api/autopilot/pattern-suggestion/${PATTERN_SUGGESTION.ruleId}/dismiss`,
        respond: (_req, url) => {
          observed.push(url.pathname);
          return jsonOk({
            data: {
              ruleId: PATTERN_SUGGESTION.ruleId,
              presetKey: PATTERN_SUGGESTION.presetKey,
              decision: 'dismissed',
              evidenceCount: PATTERN_SUGGESTION.evidenceCount,
              decidedAt: '2026-07-15T00:00:00.000Z',
            },
          });
        },
      },
    ]);
    renderScreen({
      kind: 'ready',
      rules: PRESET_RULES_ALL_FIVE,
      suggestions: [],
      patternSuggestion: PATTERN_SUGGESTION,
    });

    showNextNotice();
    await userEvent.click(screen.getByRole('button', { name: /not now/i }));
    await waitFor(() => expect(observed).toEqual([expect.stringMatching(/\/dismiss$/)]));
  });

  it('explains Observe, Active, Paused, and Off consequences at rule level', () => {
    const active = { ...PRESET_RULES_OBSERVE[0]!, id: 'active-rule', mode: 'active' as const };
    const paused = { ...PRESET_RULES_ALL_PAUSED[0]!, id: 'paused-rule' };
    const off = { ...PRESET_RULES_ALL_FIVE[4]!, id: 'off-rule' };
    renderScreen({
      kind: 'ready',
      rules: [PRESET_RULES_OBSERVE[0]!, active, paused, off],
      suggestions: [],
    });

    const rulesList = screen.getByRole('list', { name: /autopilot rules/i });
    expect(within(rulesList).getByText(/matches become suggestions/i)).toBeInTheDocument();
    expect(within(rulesList).getByText(/future matches run automatically/i)).toBeInTheDocument();
    expect(within(rulesList).getByText(/does nothing until you resume/i)).toBeInTheDocument();
    // Off needs no sentence and no status word — the switch says it, once.
    const offSwitches = within(rulesList)
      .getAllByRole('switch')
      .filter((sw) => sw.getAttribute('aria-checked') === 'false');
    expect(offSwitches).toHaveLength(1);
    expect(within(rulesList).queryAllByText(/^Off$/)).toHaveLength(0);
  });

  it('renders the observe digest on enabled observe-mode cards, verb-honest (D10/D101)', () => {
    renderScreen({ kind: 'ready', rules: PRESET_RULES_ALL_FIVE, suggestions: [] });
    openAllRuleDetails();
    const rulesList = screen.getByRole('list', { name: /autopilot rules/i });
    // Archive preset — message + sender counts.
    expect(
      within(rulesList).getByText(
        // The 7-day window belongs to the SENDER count only; the message
        // count is the senders' whole current inbox backlog. The old copy
        // attached "in the last 7 days" to both (audit 2026-08-21).
        /would archive 212 emails now, from 34 senders matched in the last 7 days/i,
      ),
    ).toBeInTheDocument();
    // Unsubscribe preset — sender count only (request acts per sender).
    expect(
      within(rulesList).getByText(
        /would have requested unsubscribe from 2 senders in the last 7 days/i,
      ),
    ).toBeInTheDocument();
    // Disabled rule (long-dormant) shows NO digest line even in observe mode.
    // Matched on the leading "Would " every digest sentence opens with,
    // not on "would have": only the unsubscribe branch still says that,
    // because it is the one branch whose number really was windowed.
    expect(within(rulesList).queryAllByText(/^Would (archive|move|have requested)/i)).toHaveLength(
      4,
    );
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

  // ── Turning a rule ON is a D226 mutation, so it previews first ──
  //
  // Enabling a rule starts changing mail: the first sweep acts on
  // matching mail already in the inbox. Before 2026-08-23 the toggle
  // committed straight away and the rule sat inert in Observe until a
  // day-7 banner offered to promote it, so "on" did not mean on. Now
  // the toggle opens the preview and the user picks how it runs.

  it('does NOT patch when a rule is toggled on — it opens the preview first (D226)', async () => {
    const observed: unknown[] = [];
    installFetchStub([
      {
        method: 'POST',
        path: /\/api\/autopilot\/rules\/[^/]+\/preview$/,
        respond: () =>
          jsonOk({ data: { ...RULE_PREVIEW_RESULT, ruleId: LONG_DORMANT_UNSUBSCRIBE.id } }),
      },
      {
        method: 'PATCH',
        path: /\/api\/autopilot\/rules\/[^/]+$/,
        respond: async (req) => {
          observed.push(await req.json());
          return jsonOk({ data: LONG_DORMANT_UNSUBSCRIBE });
        },
      },
    ]);

    renderScreen({ kind: 'ready', rules: [LONG_DORMANT_UNSUBSCRIBE], suggestions: [] });
    await userEvent.click(
      screen.getByRole('switch', { name: /enable rule long-dormant unsubscribe/i }),
    );

    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByRole('heading', { name: /Turn on Long-dormant unsubscribe\?/i }),
    ).toBeInTheDocument();
    // The whole point: mail state is untouched until the user confirms.
    expect(observed).toHaveLength(0);
  });

  it('“Act now” (the default choice) patches enabled + mode=active in ONE request', async () => {
    const observed: Array<{ path: string; body: unknown }> = [];
    installFetchStub([
      {
        method: 'POST',
        path: /\/api\/autopilot\/rules\/[^/]+\/preview$/,
        respond: () =>
          jsonOk({ data: { ...RULE_PREVIEW_RESULT, ruleId: LONG_DORMANT_UNSUBSCRIBE.id } }),
      },
      {
        method: 'PATCH',
        path: /\/api\/autopilot\/rules\/[^/]+$/,
        respond: async (req, url) => {
          observed.push({ path: url.pathname, body: await req.json() });
          return jsonOk({ data: { ...LONG_DORMANT_UNSUBSCRIBE, enabled: true, mode: 'active' } });
        },
      },
    ]);

    renderScreen({ kind: 'ready', rules: [LONG_DORMANT_UNSUBSCRIBE], suggestions: [] });
    await userEvent.click(
      screen.getByRole('switch', { name: /enable rule long-dormant unsubscribe/i }),
    );
    const confirm = await screen.findByRole('button', { name: /^turn on$/i });
    expect(screen.getByRole('radio', { name: /act now/i })).toHaveAttribute('aria-checked', 'true');
    await waitFor(() => expect(confirm).toBeEnabled());
    await userEvent.click(confirm);

    await waitFor(() => expect(observed).toHaveLength(1));
    expect(observed[0]!.path).toBe(`/api/autopilot/rules/${LONG_DORMANT_UNSUBSCRIBE.id}`);
    // ONE patch, both fields. Two sequential calls would leave a window
    // where the rule is on in whichever mode the row happened to hold.
    expect(observed[0]!.body).toEqual({ enabled: true, mode: 'active' });
  });

  it('“Watch first” patches enabled + mode=observe — a choice, not a tier', async () => {
    const observed: unknown[] = [];
    installFetchStub([
      {
        method: 'POST',
        path: /\/api\/autopilot\/rules\/[^/]+\/preview$/,
        respond: () =>
          jsonOk({ data: { ...RULE_PREVIEW_RESULT, ruleId: LONG_DORMANT_UNSUBSCRIBE.id } }),
      },
      {
        method: 'PATCH',
        path: /\/api\/autopilot\/rules\/[^/]+$/,
        respond: async (req) => {
          observed.push(await req.json());
          return jsonOk({ data: { ...LONG_DORMANT_UNSUBSCRIBE, enabled: true } });
        },
      },
    ]);

    renderScreen({ kind: 'ready', rules: [LONG_DORMANT_UNSUBSCRIBE], suggestions: [] });
    await userEvent.click(
      screen.getByRole('switch', { name: /enable rule long-dormant unsubscribe/i }),
    );
    await userEvent.click(await screen.findByRole('radio', { name: /watch first/i }));
    const watch = screen.getByRole('button', { name: /^watch first$/i });
    await waitFor(() => expect(watch).toBeEnabled());
    await userEvent.click(watch);

    await waitFor(() => expect(observed).toHaveLength(1));
    expect(observed[0]).toEqual({ enabled: true, mode: 'observe' });
  });

  it('gates BOTH commit paths on the preview resolving (D226)', async () => {
    let releasePreview!: () => void;
    const gate = new Promise<void>((resolve) => {
      releasePreview = resolve;
    });
    installFetchStub([
      {
        method: 'POST',
        path: /\/api\/autopilot\/rules\/[^/]+\/preview$/,
        respond: async () => {
          await gate;
          return jsonOk({ data: { ...RULE_PREVIEW_RESULT, ruleId: LONG_DORMANT_UNSUBSCRIBE.id } });
        },
      },
    ]);

    renderScreen({ kind: 'ready', rules: [LONG_DORMANT_UNSUBSCRIBE], suggestions: [] });
    await userEvent.click(
      screen.getByRole('switch', { name: /enable rule long-dormant unsubscribe/i }),
    );

    // "Watch first" moves no mail, but it still commits a mode, so it
    // waits for the same dry-run. A second button that skipped the gate
    // would be a hole straight through the mandatory preview.
    // One primary carries whichever commit is chosen, so both choices are
    // checked against the same gate.
    const confirm = await screen.findByRole('button', { name: /^turn on$/i });
    expect(confirm).toBeDisabled();
    await userEvent.click(screen.getByRole('radio', { name: /watch first/i }));
    expect(screen.getByRole('button', { name: /^watch first$/i })).toBeDisabled();

    releasePreview();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^watch first$/i })).toBeEnabled(),
    );
    await userEvent.click(screen.getByRole('radio', { name: /act now/i }));
    expect(screen.getByRole('button', { name: /^turn on$/i })).toBeEnabled();
  });

  it('an under-tier workspace is never offered the acting commit on enable', async () => {
    // Unreachable under today's manifest — every tier that reaches this
    // screen holds `autopilot-active`. Rendered directly with an
    // under-tier principal, because the alternative is that a one-line
    // re-tier puts an always-402 button in the modal's PRIMARY slot,
    // which is the D251 defect this codebase already shipped once.
    authState.tier = 'free';
    const observed: unknown[] = [];
    installFetchStub([
      {
        method: 'POST',
        path: /\/api\/autopilot\/rules\/[^/]+\/preview$/,
        respond: () =>
          jsonOk({ data: { ...RULE_PREVIEW_RESULT, ruleId: LONG_DORMANT_UNSUBSCRIBE.id } }),
      },
      {
        method: 'PATCH',
        path: /\/api\/autopilot\/rules\/[^/]+$/,
        respond: async (req) => {
          observed.push(await req.json());
          return jsonOk({ data: { ...LONG_DORMANT_UNSUBSCRIBE, enabled: true } });
        },
      },
    ]);

    renderScreen({ kind: 'ready', rules: [LONG_DORMANT_UNSUBSCRIBE], suggestions: [] });
    await userEvent.click(
      screen.getByRole('switch', { name: /enable rule long-dormant unsubscribe/i }),
    );

    const dialog = await screen.findByRole('dialog');
    // No choice at all — the acting commit is not offered.
    expect(within(dialog).queryByRole('radiogroup')).toBeNull();
    expect(within(dialog).queryByRole('radio', { name: /act now/i })).toBeNull();
    expect(
      within(dialog).getByText(/Nothing moves until you approve each match/i),
    ).toBeInTheDocument();

    const confirm = within(dialog).getByRole('button', { name: /^turn on$/i });
    await waitFor(() => expect(confirm).toBeEnabled());
    await userEvent.click(confirm);

    await waitFor(() => expect(observed).toHaveLength(1));
    expect(observed[0]).toEqual({ enabled: true, mode: 'observe' });
  });

  it('shows the busy label for the commit that was chosen, not the other one', async () => {
    let releasePatch!: () => void;
    const patchGate = new Promise<void>((resolve) => {
      releasePatch = resolve;
    });
    installFetchStub([
      {
        method: 'POST',
        path: /\/api\/autopilot\/rules\/[^/]+\/preview$/,
        respond: () =>
          jsonOk({ data: { ...RULE_PREVIEW_RESULT, ruleId: LONG_DORMANT_UNSUBSCRIBE.id } }),
      },
      {
        method: 'PATCH',
        path: /\/api\/autopilot\/rules\/[^/]+$/,
        respond: async () => {
          await patchGate;
          return jsonOk({ data: { ...LONG_DORMANT_UNSUBSCRIBE, enabled: true } });
        },
      },
    ]);

    renderScreen({ kind: 'ready', rules: [LONG_DORMANT_UNSUBSCRIBE], suggestions: [] });
    await userEvent.click(
      screen.getByRole('switch', { name: /enable rule long-dormant unsubscribe/i }),
    );
    await userEvent.click(await screen.findByRole('radio', { name: /watch first/i }));
    const watch = screen.getByRole('button', { name: /^watch first$/i });
    await waitFor(() => expect(watch).toBeEnabled());
    await userEvent.click(watch);

    // The busy label must NOT claim the acting commit. One shared
    // `isPending` made it read "Turning on…" while the user had
    // deliberately chosen the cautious path.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /starting to watch/i })).toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: /^turning on…$/i })).toBeNull();
    expect(screen.getByRole('radio', { name: /watch first/i })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    releasePatch();
  });

  it('⌘⏎ commits the chosen path — never the acting commit when Watch first is chosen', async () => {
    // Smoke found this, not a test: an earlier two-button version let the
    // chord commit `mode='active'` while the user was on the cautious
    // button. The chord and the one primary now share the chosen commit.
    const observed: unknown[] = [];
    installFetchStub([
      {
        method: 'POST',
        path: /\/api\/autopilot\/rules\/[^/]+\/preview$/,
        respond: () =>
          jsonOk({ data: { ...RULE_PREVIEW_RESULT, ruleId: LONG_DORMANT_UNSUBSCRIBE.id } }),
      },
      {
        method: 'PATCH',
        path: /\/api\/autopilot\/rules\/[^/]+$/,
        respond: async (req) => {
          observed.push(await req.json());
          return jsonOk({ data: { ...LONG_DORMANT_UNSUBSCRIBE, enabled: true } });
        },
      },
    ]);

    renderScreen({ kind: 'ready', rules: [LONG_DORMANT_UNSUBSCRIBE], suggestions: [] });
    await userEvent.click(
      screen.getByRole('switch', { name: /enable rule long-dormant unsubscribe/i }),
    );
    await userEvent.click(await screen.findByRole('radio', { name: /watch first/i }));
    const watch = screen.getByRole('button', { name: /^watch first$/i });
    await waitFor(() => expect(watch).toBeEnabled());

    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
    await waitFor(() => expect(observed).toHaveLength(1));
    expect(observed[0]).toEqual({ enabled: true, mode: 'observe' });
  });

  it('keeps the modal open and the toggle Off when the commit fails', async () => {
    installFetchStub([
      {
        method: 'POST',
        path: /\/api\/autopilot\/rules\/[^/]+\/preview$/,
        respond: () =>
          jsonOk({ data: { ...RULE_PREVIEW_RESULT, ruleId: LONG_DORMANT_UNSUBSCRIBE.id } }),
      },
      {
        method: 'PATCH',
        path: /\/api\/autopilot\/rules\/[^/]+$/,
        respond: () => jsonServerError(),
      },
    ]);

    renderScreen({ kind: 'ready', rules: [LONG_DORMANT_UNSUBSCRIBE], suggestions: [] });
    await userEvent.click(
      screen.getByRole('switch', { name: /enable rule long-dormant unsubscribe/i }),
    );
    const confirm = await screen.findByRole('button', { name: /^turn on$/i });
    await waitFor(() => expect(confirm).toBeEnabled());
    await userEvent.click(confirm);

    // The failure has to be visible AND recoverable: the dialog stays,
    // the error is announced, and the toggle still reads Off because it
    // renders server state and was never optimistically flipped.
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/could not turn the rule on/i);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(
      screen.getByRole('switch', { name: /enable rule long-dormant unsubscribe/i }),
    ).toHaveAttribute('aria-checked', 'false');
  });

  it('never shows a running pill on a rule that is switched off', async () => {
    // `{enabled:false}` leaves `mode` alone, so a rule turned on to
    // Active and then off keeps `mode='active'`. The status read
    // "Active" on a rule that was taking no actions.
    installFetchStub([]);
    renderScreen({
      kind: 'ready',
      rules: [{ ...AUTO_ARCHIVE_LOW_ENGAGEMENT, enabled: false, mode: 'active' as const }],
      suggestions: [],
    });

    expect(screen.queryAllByText(/^Active$/)).toHaveLength(0);
    expect(screen.queryByText(/future matches run automatically/i)).toBeNull();
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
    openAllRuleDetails();
    const slider = screen.getByRole('slider', {
      name: /confidence threshold for rule auto-archive low-engagement/i,
    });
    fireEvent.change(slider, { target: { value: '0.9' } });
    expect(observed).toHaveLength(0); // no PATCH while dragging
    fireEvent.blur(slider);

    await waitFor(() => expect(observed).toHaveLength(1));
    expect(observed[0]).toEqual({ confidenceThreshold: 0.9 });
  });

  it('snaps the threshold back when the server rejects the PATCH (D101)', async () => {
    installFetchStub([
      {
        method: 'PATCH',
        path: /\/api\/autopilot\/rules\/[^/]+$/,
        respond: () => jsonServerError('threshold_rejected'),
      },
    ]);

    renderScreen({ kind: 'ready', rules: [AUTO_ARCHIVE_LOW_ENGAGEMENT], suggestions: [] });
    openAllRuleDetails();
    const slider = screen.getByRole('slider', {
      name: /confidence threshold for rule auto-archive low-engagement/i,
    }) as HTMLInputElement;

    fireEvent.change(slider, { target: { value: '0.9' } });
    expect(slider.value).toBe('0.9');
    fireEvent.blur(slider);

    // The refetch returns the OLD threshold, so the re-sync effect never
    // fires — without an explicit snap-back the control would keep
    // asserting a threshold the rule never took.
    await waitFor(() => expect(slider.value).toBe('0.7'));
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
    // The dry-run is still an explicit per-rule request, inside Details.
    openAllRuleDetails();
    await userEvent.click(
      screen.getByRole('button', {
        name: /preview matches for rule auto-archive low-engagement/i,
      }),
    );

    await waitFor(() => expect(observed).toHaveLength(1));
    expect(observed[0]).toBe(`/api/autopilot/rules/${AUTO_ARCHIVE_LOW_ENGAGEMENT.id}/preview`);
    const panel = await screen.findByRole('region', {
      name: /current match preview for rule auto-archive low-engagement/i,
    });
    // The would-match count, out of the senders checked…
    expect(within(panel).getByText(/12 of 148 senders checked match/i)).toBeInTheDocument();
    // …and the one number the rule would act on now.
    expect(within(panel).getByText('10')).toBeInTheDocument();
    expect(within(panel).getByText('senders actionable now')).toBeInTheDocument();
  });
});

describe('AutopilotScreen — day-7 observe banner (D104)', () => {
  beforeEach(() => installFetchStub([]));
  afterEach(() => resetFetchStub());

  it('renders the banner only when a rule has an elapsed observe window', () => {
    renderScreen(ready());
    // Fixture rule #1 is elapsed → banner present, with the explicit
    // switch (there is no auto-promotion to wait for).
    expect(screen.getByText(/collected matches for a week/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Switch rule .* to Active/i })).toBeInTheDocument();
  });

  // ── The under-tier branch: reaches this screen, must not be offered
  //    Activate ──
  //
  // WHAT THESE COVER, PRECISELY. A workspace holding `autopilot` but
  // not `autopilot-active` sees review-and-approve with no Activate
  // button. Historically that was Plus (D251). Since 2026-08-23 both
  // capabilities sit on Plus, so NO tier reaches this state through the
  // app: the route wrapper sends `free` to the observe preview, and
  // every tier that reaches the screen can activate.
  //
  // These render `AutopilotScreen` directly with an under-tier
  // principal, bypassing that wrapper. They are CAPABILITY-BRANCH
  // coverage, not a user journey — kept because the branch is kept, so
  // that moving `autopilot-active` back up the ladder stays a one-line
  // manifest edit instead of a UI rebuild. Delete these with the branch.
  //
  // The original defect: the screen offered Activate to a tier that
  // could not use it, the PATCH 402'd, and the confirm modal quoted the
  // wrong undo window.

  it('under-tier: offers an upgrade link instead of Switch to Active', () => {
    authState.tier = 'free';
    renderScreen(ready());

    expect(screen.queryByRole('button', { name: /Switch rule .* to Active/i })).toBeNull();
    expect(screen.getByRole('link', { name: /requires Plus/i })).toHaveAttribute(
      'href',
      expect.stringContaining('plan=plus'),
    );
  });

  it('under-tier: the banner does not promise an Active switch it cannot deliver', () => {
    authState.tier = 'free';
    renderScreen(ready());

    expect(screen.queryByText(/until you switch it to Active/i)).toBeNull();
    // The banner names the granting plan on its per-rule upgrade link;
    // the intro names it in prose (B2 fix).
    expect(screen.getByRole('link', { name: /requires Plus/i })).toBeInTheDocument();
    expect(helpBody()).toMatch(/part of Plus/i);
  });

  it('under-tier: intro and help never promise per-rule Active (design-gate B2)', () => {
    authState.tier = 'free';
    renderScreen(ready());

    // The entitled explainer must be absent for an under-tier reader:
    // it describes a rule acting on its own, which they cannot reach.
    expect(helpBody()).not.toMatch(/watch first/i);
    expect(helpBody()).toMatch(/Rules collect matching email for you to approve/i);
  });

  it('pro: the intro teaches preview-then-run, not observe-then-promote', () => {
    authState.tier = 'pro';
    renderScreen(ready());

    // Turning a rule on now previews and acts. Copy that said a rule
    // "starts in Observe, switch to Active later" described a flow the
    // screen no longer has.
    expect(helpBody()).toMatch(/Turning a rule on previews what it would do/i);
    expect(helpBody()).toMatch(/watch first/i);
    expect(helpBody()).not.toMatch(/start in Observe/i);
  });

  it('under-tier: a leftover active rule renders "Not running", never a green Active pill (design-gate B3)', () => {
    authState.tier = 'free';
    // A rule promoted to active while entitled, read by a workspace
    // that no longer holds `autopilot-active`; the apply worker skips
    // it, so the card must not assert automation that is not happening.
    const withActive = [
      { ...PRESET_RULES_OBSERVE[0]!, mode: 'active' as const },
      ...PRESET_RULES_OBSERVE.slice(1),
    ];
    renderScreen({ kind: 'ready', rules: withActive, suggestions: [] });

    expect(screen.getByText('Not running')).toBeInTheDocument();
    expect(screen.queryAllByText(/^Active$/)).toHaveLength(0);
    // Copy contract (four Codex catches): no absolute claims — the
    // backlog neither "keeps waiting" (demotion dismisses it) nor is
    // "cleared" (in-flight work is untouched); in-flight work neither
    // "completes" nor "finishes with undo" unconditionally (it can fail
    // at the boundary; undo exists only where mail actually moved).
    const explanation = screen.getByText(/this rule starts no new work/i);
    expect(explanation.textContent).toMatch(/part of Plus/i);
    expect(explanation.textContent).toMatch(/returns to Watch first/i);
    // The five failed absolutes, all rejected — incl. round 5's
    // "result lands in Activity" (unsubscribe is outside
    // EXECUTION_VERBS; no-op terminals write no Activity row).
    expect(explanation.textContent).not.toMatch(
      /keep waiting|are cleared|still completes|still finishes|normal undo|result lands in Activity/i,
    );
  });

  it('under-tier: a leftover active UNSUBSCRIBE rule never promises undo for its in-flight work', () => {
    authState.tier = 'free';
    // D58 — a delivered unsubscribe request is one-way. The in-flight
    // clause is per-actionKind: promising "its normal undo" here was
    // the third false absolute this sentence shipped (Codex ×3).
    const withActiveUnsub = [
      { ...AUTO_UNSUBSCRIBE_NOISY, mode: 'active' as const },
      ...PRESET_RULES_OBSERVE.filter((r) => r.id !== AUTO_UNSUBSCRIBE_NOISY.id),
    ];
    renderScreen({ kind: 'ready', rules: withActiveUnsub, suggestions: [] });

    const explanation = screen.getByText(/this rule starts no new work/i);
    // No undo promise, no success promise, no Activity promise — a
    // request can fail at the sender's endpoint, and failed/no-op
    // unsubscribe terminals surface nowhere (Codex rounds 4-5).
    expect(explanation.textContent).not.toMatch(/undo|still completes|lands in Activity/i);
  });

  it('pro: an active rule still renders the green Active pill', () => {
    authState.tier = 'pro';
    const withActive = [
      { ...PRESET_RULES_OBSERVE[0]!, mode: 'active' as const },
      ...PRESET_RULES_OBSERVE.slice(1),
    ];
    renderScreen({ kind: 'ready', rules: withActive, suggestions: [] });

    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.queryByText('Not running')).toBeNull();
  });

  it('pro: still gets the real Activate control', () => {
    authState.tier = 'pro';
    renderScreen(ready());

    expect(screen.getByRole('button', { name: /Switch rule .* to Active/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /requires Pro/i })).toBeNull();
  });

  it('does NOT render the banner when no observe window has elapsed', () => {
    const stillObserving = PRESET_RULES_OBSERVE.map((r) => ({
      ...r,
      observeWindowElapsed: false,
    }));
    renderScreen({ kind: 'ready', rules: stillObserving, suggestions: [] });
    expect(screen.queryByText(/collected matches for a week/i)).not.toBeInTheDocument();
  });

  it('hides the day-7 prompt for a dismissed rule (D10 — persisted dismissal)', () => {
    const dismissed = PRESET_RULES_OBSERVE.map((r) =>
      r.id === AUTO_ARCHIVE_LOW_ENGAGEMENT.id
        ? { ...r, observePromptDismissedAt: '2026-05-25T10:00:00.000Z' }
        : r,
    );
    renderScreen({ kind: 'ready', rules: dismissed, suggestions: [] });
    expect(screen.queryByText(/collected matches for a week/i)).not.toBeInTheDocument();
  });

  it('hides the day-7 prompt when the window elapsed with ZERO pending matches (D10)', () => {
    const quietWeek = PRESET_RULES_OBSERVE.map((r) =>
      r.id === AUTO_ARCHIVE_LOW_ENGAGEMENT.id
        ? { ...r, observeDigest: { pendingTotal: 0, senders7d: 0, inboxMessagesNow: 0 } }
        : r,
    );
    renderScreen({ kind: 'ready', rules: quietWeek, suggestions: [] });
    expect(screen.queryByText(/collected matches for a week/i)).not.toBeInTheDocument();
  });

  it('the prompt carries the verb-honest digest numbers (D10)', () => {
    renderScreen(ready());
    const banner = screen.getByRole('status');
    expect(
      within(banner).getByText(/would archive 212 emails now, from 34 senders matched/i),
    ).toBeInTheDocument();
  });

  it('"Not now" persists the dismissal via PATCH observePromptDismissed (D10)', async () => {
    const observed: Array<{ path: string; body: unknown }> = [];
    installFetchStub([
      {
        method: 'PATCH',
        path: /\/api\/autopilot\/rules\/[^/]+$/,
        respond: async (req, url) => {
          observed.push({ path: url.pathname, body: await req.json() });
          return jsonOk({
            data: {
              ...AUTO_ARCHIVE_LOW_ENGAGEMENT,
              observePromptDismissedAt: '2026-05-26T10:00:00.000Z',
            },
          });
        },
      },
    ]);

    renderScreen(ready());
    await userEvent.click(
      screen.getByRole('button', {
        name: /dismiss activation prompt for rule auto-archive low-engagement/i,
      }),
    );

    await waitFor(() => expect(observed).toHaveLength(1));
    expect(observed[0]!.path).toBe(`/api/autopilot/rules/${AUTO_ARCHIVE_LOW_ENGAGEMENT.id}`);
    expect(observed[0]!.body).toEqual({ observePromptDismissed: true });
  });

  it('gates Confirm on the first-sweep preview, then PATCHes mode=active on confirm (D226)', async () => {
    const observed: Array<{ path: string; body: unknown }> = [];
    let releasePreview!: () => void;
    const previewGate = new Promise<void>((resolve) => {
      releasePreview = resolve;
    });
    installFetchStub([
      {
        method: 'POST',
        path: /\/api\/autopilot\/rules\/[^/]+\/preview$/,
        respond: async () => {
          await previewGate;
          return jsonOk({ data: RULE_PREVIEW_RESULT });
        },
      },
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

    // Modal renders — the preview MUST be visible before the mutation,
    // and Confirm stays DISABLED until the dry-run resolves.
    const dialog = screen.getByRole('dialog', { name: /switch .* to active/i });
    expect(within(dialog).getByText(/Checking current sender data/i)).toBeInTheDocument();
    const confirm = within(dialog).getByRole('button', { name: /switch to active/i });
    expect(confirm).toBeDisabled();
    expect(observed).toHaveLength(0);

    releasePreview();
    await waitFor(() => expect(confirm).toBeEnabled());
    // The first-sweep dry-run rendered inside the sheet: the one number
    // up front, the activation report (no longer under its own heading)
    // in Details.
    expect(within(dialog).getByText('senders actionable now')).toBeInTheDocument();
    expect(within(dialog).getByText('10 senders · 74 inbox emails')).toBeInTheDocument();
    // Said once per surface — in the note; the Details totals omit it.
    expect(within(dialog).getAllByText(/3 Protected senders are skipped/i)).toHaveLength(1);
    expect(within(dialog).getByText('34 matches')).toBeInTheDocument();
    expect(within(dialog).getByText(/^100 actions, the rest wait/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Undo from Activity for 30 days/)).toBeInTheDocument();

    await userEvent.click(confirm);
    await waitFor(() => expect(observed).toHaveLength(1));
    expect(observed[0]!.body).toEqual({ mode: 'active' });
  });

  it('keeps Confirm locked when the dry-run fails; retry re-fires it (D226)', async () => {
    let previewCalls = 0;
    installFetchStub([
      {
        method: 'POST',
        path: /\/api\/autopilot\/rules\/[^/]+\/preview$/,
        respond: () => {
          previewCalls += 1;
          return previewCalls === 1 ? jsonServerError() : jsonOk({ data: RULE_PREVIEW_RESULT });
        },
      },
    ]);

    renderScreen(ready());
    await userEvent.click(
      screen.getByRole('button', { name: /switch rule auto-archive low-engagement to active/i }),
    );

    const dialog = screen.getByRole('dialog', { name: /switch .* to active/i });
    await waitFor(() => expect(within(dialog).getByText(/preview failed/i)).toBeInTheDocument());
    const confirm = within(dialog).getByRole('button', { name: /switch to active/i });
    expect(confirm).toBeDisabled();

    await userEvent.click(within(dialog).getByRole('button', { name: /try again/i }));
    await waitFor(() => expect(confirm).toBeEnabled());
    expect(previewCalls).toBe(2);
  });
});

describe('ActivateRuleModal — action-specific recovery', () => {
  it('states that unsubscribe is irreversible and does not remove existing mail', () => {
    render(
      <ActivateRuleModal
        rule={AUTO_UNSUBSCRIBE_NOISY}
        pendingCount={3}
        pendingApproximate={false}
        undoWindowDays={TIER_MANIFEST.plus.undoWindowDays}
        preview={{
          status: 'ready',
          result: {
            ...RULE_PREVIEW_RESULT,
            ruleId: AUTO_UNSUBSCRIBE_NOISY.id,
            actionableSenderCount: 2,
            actionableMessageCount: 11,
            protectedWouldMatchCount: 1,
            dailyActionCap: 25,
            weeklyVolume: {
              observedMatches: 3,
              observedDays: 2,
              estimatedMatches: 11,
              basis: 'early_estimate',
            },
          },
        }}
        onRetryPreview={() => undefined}
        isActivating={false}
        error={null}
        onCancel={() => undefined}
        onConfirm={() => undefined}
      />,
    );

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/^2 requests · /)).toBeInTheDocument();
    // Existing email stays put — the Details fact, beside its label.
    expect(dialog.textContent).toContain('Existing emailStays where it is');
    expect(within(dialog).getByText(/^About 11 matches/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/unsubscribe.*can be undone/i)).not.toBeInTheDocument();
    // The note owns the one-way fact; Details must not state it again.
    const text = dialog.textContent ?? '';
    expect(text.match(/(cannot|can’t) be (undone|recalled)/gi)).toHaveLength(1);
  });

  // The backlog clause had NO test until 2026-08-24, which is how it
  // came to state the opposite of what the server does. It promised
  // "suggestions already collected stay pending — turning the rule on
  // does not approve them"; going Active, `patchRule` supersedes them in
  // the same transaction, because the sweep it triggers re-matches those
  // senders and acts on them. Rewriting that sentence turned nothing
  // red. Both branches are pinned here now.
  it('going Active, says the rule takes over the collected backlog', () => {
    render(
      <ActivateRuleModal
        rule={AUTO_ARCHIVE_LOW_ENGAGEMENT}
        intent="enable"
        canRunUnattended
        pendingCount={3}
        pendingApproximate={false}
        undoWindowDays={TIER_MANIFEST.plus.undoWindowDays}
        preview={{ status: 'ready', result: RULE_PREVIEW_RESULT }}
        onRetryPreview={() => undefined}
        onWatchFirst={() => undefined}
        isActivating={false}
        error={null}
        onCancel={() => undefined}
        onConfirm={() => undefined}
      />,
    );

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/^3 suggestions covered by this/)).toBeInTheDocument();
    // The old promise must be gone, not merely joined by the new one.
    expect(within(dialog).queryByText(/Approve or skip them separately/i)).not.toBeInTheDocument();
    // The other path leads somewhere different, and the user is choosing
    // between them right here: picking Watch first says so.
    fireEvent.click(within(dialog).getByRole('radio', { name: /watch first/i }));
    expect(within(dialog).getByText(/^3 suggestions stay pending/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/covered by this/i)).not.toBeInTheDocument();
  });

  it('turning on into Observe, says the backlog stays pending', () => {
    render(
      <ActivateRuleModal
        rule={AUTO_ARCHIVE_LOW_ENGAGEMENT}
        intent="enable"
        canRunUnattended={false}
        pendingCount={3}
        pendingApproximate={false}
        undoWindowDays={TIER_MANIFEST.plus.undoWindowDays}
        preview={{ status: 'ready', result: RULE_PREVIEW_RESULT }}
        onRetryPreview={() => undefined}
        isActivating={false}
        error={null}
        onCancel={() => undefined}
        onConfirm={() => undefined}
      />,
    );

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/^3 suggestions stay pending/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/covered by this/i)).not.toBeInTheDocument();
  });

  // The recovery line used to read `TIER_MANIFEST.pro.undoWindowDays`
  // outright, on the reasoning that only Pro could open this modal.
  // That stopped being true when `autopilot-active` moved to Plus.
  // An arbitrary number no tier carries is the only assertion that can
  // tell "threaded from the caller" apart from "happens to match the
  // manifest" — every tier is currently 30 days, so a 30 here would
  // pass against the old hardcoded constant too.
  it('quotes the CALLER’S undo window, not a tier constant', () => {
    render(
      <ActivateRuleModal
        rule={AUTO_ARCHIVE_LOW_ENGAGEMENT}
        pendingCount={1}
        pendingApproximate={false}
        undoWindowDays={12}
        preview={{ status: 'ready', result: RULE_PREVIEW_RESULT }}
        onRetryPreview={() => undefined}
        isActivating={false}
        error={null}
        onCancel={() => undefined}
        onConfirm={() => undefined}
      />,
    );

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/Undo from Activity for 12 days/)).toBeInTheDocument();
  });
});

describe('AutopilotScreen — approve flow (D104 + D226)', () => {
  beforeEach(() => installFetchStub([]));
  afterEach(() => resetFetchStub());

  it('never describes a many-sender Unsubscribe rule as one unchecked sender', () => {
    render(
      <ApproveConfirmModal
        rule={AUTO_UNSUBSCRIBE_NOISY}
        matches={[]}
        kind="all"
        pendingTotal={null}
        pendingApproximate={false}
        mailboxEmail="me@example.com"
        isApproving={false}
        error={null}
        onCancel={() => undefined}
        onConfirm={() => undefined}
      />,
    );
    const text = screen.getByRole('dialog').textContent ?? '';
    expect(text).not.toMatch(/this sender has not been checked/i);
    expect(text).toMatch(/one-click request/i);
  });

  it('states the one-way unsubscribe fact once in the approve footnote', () => {
    render(
      <ApproveConfirmModal
        rule={AUTO_UNSUBSCRIBE_NOISY}
        matches={[]}
        kind="all"
        pendingTotal={null}
        pendingApproximate={false}
        mailboxEmail="me@example.com"
        isApproving={false}
        error={null}
        onCancel={() => undefined}
        onConfirm={() => undefined}
      />,
    );
    // The registry's `finality` line restates `activityUndo`; appending it
    // printed "cannot be undone … cannot be recalled" back to back.
    const text = screen.getByRole('dialog').textContent ?? '';
    expect(text.match(/cannot be (undone|recalled)/gi)).toHaveLength(1);
  });

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
    await userEvent.click(within(dialog).getByText('Details'));
    expect(
      within(within(dialog).getByRole('list', { name: /senders in these suggestions/i })).getByText(
        /bargain bulletin/i,
      ),
    ).toBeInTheDocument();
    expect(observed).toHaveLength(0);

    await userEvent.click(within(dialog).getByRole('button', { name: /^approve 2$/i }));
    await waitFor(() => expect(observed).toHaveLength(1));
    expect(observed[0]).toBe(`/api/autopilot/rules/${AUTO_ARCHIVE_LOW_ENGAGEMENT.id}/approve-all`);
  });

  it('states the UNCAPPED scope when Approve all reaches past the buffered page (D226)', async () => {
    // approve-all is an uncapped server-side update; `matches` is at most
    // the BE's 50-row page. The preview must describe the real scope —
    // a page count presented as the total is the bug this guards.
    const rule = {
      ...AUTO_ARCHIVE_LOW_ENGAGEMENT,
      observeDigest: { pendingTotal: 214, senders7d: 200, inboxMessagesNow: 900 },
    };
    const base = PENDING_SUGGESTIONS.find((m) => m.ruleId === AUTO_ARCHIVE_LOW_ENGAGEMENT.id)!;
    const suggestions: SuggestionWithRule[] = Array.from({ length: 50 }, (_, i) => ({
      match: { ...base, id: `00000000-0000-0000-0000-0000000002${String(i).padStart(2, '0')}` },
      rule,
    }));
    installFetchStub([
      {
        method: 'POST',
        path: /\/api\/autopilot\/rules\/[^/]+\/approve-all$/,
        respond: () =>
          jsonOk({
            data: { approvedCount: 214, alreadyResolvedCount: 0, executionEnqueued: true },
          }),
      },
    ]);

    renderScreen({ kind: 'ready', rules: [rule], suggestions });
    await userEvent.click(
      screen.getByRole('button', {
        name: /approve all suggestions from rule auto-archive low-engagement/i,
      }),
    );

    const dialog = screen.getByRole('dialog', { name: /approve all ~214 suggestions/i });
    expect(within(dialog).getByText('50 of ~214')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /^approve all ~214$/i })).toBeInTheDocument();
    // Never a bare "Approve 50" — that would be the page count.
    expect(within(dialog).queryByRole('button', { name: /^approve 50$/i })).toBeNull();
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
    await userEvent.click(within(dialog).getByRole('button', { name: /^approve 1$/i }));

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

  it('orphan groups expose Skip suggestion only — no approve without a truthful verb', () => {
    const orphanState: AutopilotScreenState = {
      kind: 'ready',
      rules: [],
      suggestions: [{ match: PENDING_SUGGESTIONS[0]!, rule: null }],
    };
    renderScreen(orphanState);
    expect(screen.getByRole('button', { name: /skip suggestion/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
  });
});

describe('AutopilotScreen — dismiss (D104)', () => {
  beforeEach(() => installFetchStub([]));
  afterEach(() => resetFetchStub());

  it('POSTs the dismiss endpoint when the row Skip suggestion button is clicked', async () => {
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

    const dismissButtons = screen.getAllByRole('button', { name: /^skip suggestion/i });
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
    const dialog = screen.getByRole('dialog', { name: /pause \d+ autopilot rules?\?/i });
    await userEvent.click(within(dialog).getByText('Details'));
    expect(
      within(dialog).getByRole('list', { name: /rules that will pause/i }).children.length,
    ).toBeGreaterThan(0);

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

describe('Autopilot rule status views', () => {
  it('filters loaded rules without hiding suggestions, and resets an empty view', () => {
    renderScreen(ready(PRESET_RULES_OBSERVE));
    const group = screen.getByRole('group', { name: 'Filter rules by status' });
    fireEvent.click(within(group).getByRole('button', { name: /^Acting/ }));
    expect(screen.getByText('No rules in this view')).toBeInTheDocument();
    expect(screen.getByText('Pending suggestions')).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: /^Acting/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show all rules' }));
    expect(screen.getByRole('list', { name: 'Autopilot rules' }).children).toHaveLength(
      PRESET_RULES_OBSERVE.length,
    );
  });
  it('classifies tier-blocked active rules as inactive', () => {
    authState.tier = 'free';
    renderScreen({
      kind: 'ready',
      rules: [{ ...AUTO_ARCHIVE_LOW_ENGAGEMENT, enabled: true, mode: 'active' }],
      suggestions: [],
    });
    expect(screen.getByRole('button', { name: 'Paused or inactive · 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Acting · 0' })).toBeInTheDocument();
  });
});
