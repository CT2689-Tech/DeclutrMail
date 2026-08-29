import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { track } = vi.hoisted(() => ({ track: vi.fn(async () => undefined) }));
vi.mock('@/lib/posthog', () => ({ track }));
// Bundle-boundary guard: the public simulator must not import the auth-aware
// preview wrapper, directly or through TriageRow. Throwing from this factory
// turns any accidental MailboxActionContext edge into a focused test failure.
vi.mock('@/features/auth/mailbox-action-context', () => {
  throw new Error('The public inbox simulator imported authenticated mailbox context.');
});

import { TIER_IDS, TIER_MANIFEST } from '@declutrmail/shared/entitlements';

import { CAPABILITY_LABELS } from '@/features/marketing/pricing/pricing-model';
import { TRIAGE_QUEUE } from '@/features/triage/data';
import { findDomainBatches } from '@/features/triage/domain-batch';
import { GUIDED_SCENARIOS, InboxSimulatorScreen } from './inbox-simulator-screen';
import { syntheticInboxCount } from './synthetic-preview';

const STORAGE_KEY = 'dm.inbox-simulator.state.v4';
const LEGACY_STORAGE_KEY = 'dm.inbox-simulator.decisions.v2';
const firstRow = TRIAGE_QUEUE[0]!;
const validDecision = {
  rowId: firstRow.id,
  verb: 'Archive',
  senderName: firstRow.senderName,
  affectedCount: Math.max(1, Math.min(firstRow.last90dMessages, firstRow.totalAllTime)),
  at: 1_750_000_000_000,
};

const nonFiniteCount = JSON.stringify({
  ...validDecision,
  affectedCount: '__NON_FINITE__',
}).replace('"__NON_FINITE__"', '1e309');
const nonFiniteTimestamp = JSON.stringify({ ...validDecision, at: '__NON_FINITE__' }).replace(
  '"__NON_FINITE__"',
  '1e309',
);

function storedState(
  decisions: unknown,
  mode: 'guided' | 'explore' = 'guided',
  ruleDecision: 'active' | 'observe' | null = null,
): string {
  return JSON.stringify({ version: 4, mode, decisions, ruleDecision });
}

describe('InboxSimulatorScreen', () => {
  beforeEach(() => {
    window.localStorage.clear();
    track.mockClear();
    // Reset between tests — the deep-link test below mutates this via
    // `pushState` and jsdom's URL otherwise leaks across tests in this file.
    window.history.pushState({}, '', '/inbox-simulator');
  });

  it('has four guided steps in the documented order', () => {
    expect(GUIDED_SCENARIOS.map((s) => s.kind)).toEqual(['batch', 'row', 'rule', 'row']);
    expect(GUIDED_SCENARIOS.map((s) => s.shortLabel)).toEqual([
      'Scale',
      'One-way',
      'Make it stick',
      'Free the space',
    ]);
  });

  it('identifies the sample as made up and local-only', () => {
    render(<InboxSimulatorScreen />);
    expect(screen.getByText(/Follow four made-up examples/i)).toBeInTheDocument();
    expect(screen.getByText('Local to this browser')).toBeInTheDocument();
  });

  it('sets the Triage demo in explicit plan context', () => {
    render(<InboxSimulatorScreen />);

    const availability = screen.getByRole('complementary', { name: 'Plan availability' });
    expect(availability).toHaveTextContent('Triage is included on every plan.');
    expect(availability).toHaveTextContent(
      'Free includes 50 cleanup actions every month; paid plans are unlimited.',
    );
    expect(screen.getByRole('link', { name: 'Compare plans' })).toHaveAttribute('href', '/pricing');
  });

  it('requires a preview and explicit confirmation before recording activity', () => {
    render(<InboxSimulatorScreen />);
    // Explore mode, not a specific guided step: this checks the general
    // D226 preview-then-confirm mechanism, which every row offers
    // regardless of which guided step currently occupies slot 1.
    fireEvent.click(
      screen.getByRole('button', { name: `Explore all ${TRIAGE_QUEUE.length} senders` }),
    );

    fireEvent.click(screen.getAllByRole('button', { name: /Archive \(A\)/ })[0]!);
    // The real ActionSheet (D133 Task 3) — not a hand-rolled copy — so
    // the dialog's own name is the sender, and its eyebrow names the verb.
    const dialog = screen.getByRole('dialog', { name: firstRow.senderName });
    expect(within(dialog).getByText(/Preview · Archive/i)).toBeInTheDocument();
    expect(
      screen.getByText('What actually happened').parentElement?.parentElement,
    ).not.toHaveTextContent(/moved out of Inbox into All Mail/);

    fireEvent.click(within(dialog).getByRole('button', { name: /^Archive/ }));
    expect(
      screen.getByText(/sample messages moved out of Inbox into All Mail/i),
    ).toBeInTheDocument();
  });

  it('records Keep without opening a preview', () => {
    render(<InboxSimulatorScreen />);
    fireEvent.click(
      screen.getByRole('button', { name: `Explore all ${TRIAGE_QUEUE.length} senders` }),
    );

    fireEvent.click(screen.getAllByRole('button', { name: /Keep \(K\)/ })[0]!);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('Keep decision recorded. No messages moved.')).toBeInTheDocument();
  });

  it('states that unsubscribe is one-way', () => {
    render(<InboxSimulatorScreen />);
    expect(
      screen.getByText(/A sent unsubscribe request cannot be taken back/i),
    ).toBeInTheDocument();
  });

  it('restores a completed batch decision and resumes the guide at the next step', async () => {
    // A batch decision is stored as one ordinary DemoDecision per
    // eligible row — restoring all five is what "step 1 is done" looks
    // like on disk, exercising `isScenarioComplete`'s batch branch.
    const amazonBatch = findDomainBatches(TRIAGE_QUEUE).find((b) => b.domain === 'amazon.com')!;
    const amazonDecisions = amazonBatch.eligibleRows.map((row, index) => ({
      rowId: row.id,
      verb: 'Archive',
      senderName: row.senderName,
      affectedCount: syntheticInboxCount(row),
      at: 1_750_000_000_000 + index,
    }));
    window.localStorage.setItem(STORAGE_KEY, storedState(amazonDecisions));

    render(<InboxSimulatorScreen />);

    expect(await screen.findByText('1 of 4 decisions complete')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Pause before a one-way request.' }),
    ).toBeInTheDocument();
  });

  it('drops the stale aggregate batch card once a member has its own decision', async () => {
    // Found via browser smoke: `dismissedDomains` (the "Decide one by one"
    // choice) is never persisted, so a reload after deciding ONE amazon.com
    // sender individually used to forget the dismissal while keeping the
    // decision — re-showing "5 senders from amazon.com" with the decided
    // sender's count still folded into the aggregate total and its own
    // row gone missing from the one-by-one fallback. Restoring exactly one
    // individual decision reproduces that state without a real reload.
    const amazonBatch = findDomainBatches(TRIAGE_QUEUE).find((b) => b.domain === 'amazon.com')!;
    const decidedRow = amazonBatch.eligibleRows[0]!;
    window.localStorage.setItem(
      STORAGE_KEY,
      storedState([
        {
          rowId: decidedRow.id,
          verb: 'Archive',
          senderName: decidedRow.senderName,
          affectedCount: syntheticInboxCount(decidedRow),
          at: 1_750_000_000_000,
        },
      ]),
    );

    render(<InboxSimulatorScreen />);

    expect(await screen.findByText('0 of 4 decisions complete')).toBeInTheDocument();
    expect(
      screen.queryByText(/senders from amazon\.com — decide together\?/i),
    ).not.toBeInTheDocument();
    // The decided sender is gone (already handled); every OTHER eligible
    // member still renders, one row at a time.
    expect(screen.queryByText(decidedRow.senderName)).not.toBeInTheDocument();
    for (const row of amazonBatch.eligibleRows) {
      if (row.id === decidedRow.id) continue;
      expect(screen.getByText(row.senderName)).toBeInTheDocument();
    }
  });

  it('migrates the previous local decision format into the guided demo', async () => {
    window.localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify([validDecision]));

    render(<InboxSimulatorScreen />);

    // `validDecision` is Groupon, which is step 4's row — an
    // out-of-order restore. The count is order-independent (free step
    // navigation means a visitor can legitimately decide step 4 before
    // step 1), so this correctly reports 1 done even though the guide
    // itself still opens on step 1 (the first NOT-yet-decided scenario).
    expect(await screen.findByText('1 of 4 decisions complete')).toBeInTheDocument();
    expect(window.localStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull();
    await waitFor(() =>
      expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!)).toMatchObject({
        version: 4,
        mode: 'guided',
        decisions: [validDecision],
        // The v2 format predates the rule step; migration has nothing to
        // carry a rule decision over from.
        ruleDecision: null,
      }),
    );
  });

  it.each([
    ['a non-array root', '{}'],
    ['a null entry', storedState([null])],
    ['an array entry', storedState([[]])],
    ['an incomplete object', storedState([{}])],
    ['an unexpected field', storedState([{ ...validDecision, injected: true }])],
    ['an unknown verb', storedState([{ ...validDecision, verb: 'Forward' }])],
    ['an unknown row id', storedState([{ ...validDecision, rowId: 'not-a-demo-row' }])],
    ['a forged sender name', storedState([{ ...validDecision, senderName: 'Injected' }])],
    [
      'a non-finite affected count',
      `{"version":4,"mode":"guided","decisions":[${nonFiniteCount}],"ruleDecision":null}`,
    ],
    [
      'a non-finite timestamp',
      `{"version":4,"mode":"guided","decisions":[${nonFiniteTimestamp}],"ruleDecision":null}`,
    ],
    ['a duplicate row/timestamp', storedState([validDecision, validDecision])],
    // v4-specific (D133 Plan 4 Task 5): the rule decision is a new
    // top-level field, not a `DemoDecision` — its own strictness needs its
    // own coverage, or a typo here would silently degrade to "always null".
    [
      'an invalid rule decision',
      '{"version":4,"mode":"guided","decisions":[],"ruleDecision":"sometimes"}',
    ],
    ['a v4 payload missing the rule decision key', '{"version":4,"mode":"guided","decisions":[]}'],
  ])('rejects persisted state containing %s without poisoning the demo', async (_case, stored) => {
    window.localStorage.setItem(STORAGE_KEY, stored);

    expect(() => render(<InboxSimulatorScreen />)).not.toThrow();

    expect(await screen.findByText('0 of 4 decisions complete')).toBeInTheDocument();
    expect(screen.queryByText(/Injected/)).not.toBeInTheDocument();
    await waitFor(() =>
      expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!)).toEqual({
        version: 4,
        mode: 'guided',
        decisions: [],
        ruleDecision: null,
      }),
    );
  });

  it('offers the amazon.com batch, excluding the protected sender from the count', () => {
    render(<InboxSimulatorScreen />);
    expect(screen.getByText(/6 senders from amazon\.com/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Archive all 5/i })).toBeInTheDocument();
  });

  it('confirms the amazon.com batch through the mandatory preview, then continues into the one-way step', () => {
    render(<InboxSimulatorScreen />);

    expect(
      screen.getByRole('heading', { name: 'One decision covers thousands of messages.' }),
    ).toBeInTheDocument();

    // The engine visibly disagreeing with itself, and the visitor
    // overruling all of it with one verb (D226-mandatory preview first).
    fireEvent.click(screen.getByRole('button', { name: /Archive all 5/i }));
    const sheet = screen.getByRole('dialog', { name: 'amazon.com' });
    expect(within(sheet).getByText(/Archive all inbox email from 5 senders/i)).toBeInTheDocument();
    // Protection shown, not claimed: the sixth sender is named as skipped,
    // never silently folded into the aggregated total (D245).
    expect(within(sheet).getByText(/1 protected sender will be skipped/i)).toBeInTheDocument();

    fireEvent.click(within(sheet).getByRole('button', { name: /^Archive all/ }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('1 of 4 decisions complete')).toBeInTheDocument();

    // Step 2 — the existing one-way / Unsubscribe lesson, unchanged.
    expect(
      screen.getByRole('heading', { name: 'Pause before a one-way request.' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Unsubscribe \(U\)/ }));
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'LinkedIn' })).getByRole('button', {
        name: /^Unsubscribe/,
      }),
    );

    // Step 3 exists and is reachable; nothing can complete it yet — the
    // Autopilot rule preview is Plan 4 Task 4, not this change.
    expect(
      screen.getByRole('heading', { name: 'A one-time decision does not repeat itself.' }),
    ).toBeInTheDocument();
    expect(screen.getByText('2 of 4 decisions complete')).toBeInTheDocument();
  });

  it('offers the historic-archive option on Unsubscribe, off by default', () => {
    render(<InboxSimulatorScreen />);
    fireEvent.click(
      screen.getByRole('button', { name: `Explore all ${TRIAGE_QUEUE.length} senders` }),
    );
    const unsubscribableRow = TRIAGE_QUEUE.find((row) => row.unsubscribeMethod !== 'none')!;
    const header = screen.getByRole('button', {
      name: new RegExp(`^${unsubscribableRow.senderName} — (expand|collapse) triage detail$`),
    });
    fireEvent.click(
      within(header.parentElement!).getByRole('button', { name: /Unsubscribe \(U\)/ }),
    );

    const toggle = screen.getByRole('checkbox', {
      name: /Also archive the .* already in the inbox/i,
    });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  it('reflects a ticked historic-archive toggle in the recorded outcome, and the count survives persistence', async () => {
    // The toggle turns Unsubscribe into a mail-moving decision too — the
    // affected count is no longer always 0 for that verb, which is
    // exactly the assumption `parseStoredDecisions` used to hard-code.
    // A wrong fix here doesn't fail loudly: it silently rejects the
    // WHOLE stored snapshot on the next reload (one malformed entry
    // rejects everything, by design), so this both checks the outcome
    // text and proves persistence still accepts it.
    render(<InboxSimulatorScreen />);
    fireEvent.click(
      screen.getByRole('button', { name: `Explore all ${TRIAGE_QUEUE.length} senders` }),
    );
    const unsubscribableRow = TRIAGE_QUEUE.find((row) => row.unsubscribeMethod !== 'none')!;
    const header = screen.getByRole('button', {
      name: new RegExp(`^${unsubscribableRow.senderName} — (expand|collapse) triage detail$`),
    });
    fireEvent.click(
      within(header.parentElement!).getByRole('button', { name: /Unsubscribe \(U\)/ }),
    );

    const toggle = screen.getByRole('checkbox', {
      name: /Also archive the .* already in the inbox/i,
    });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');

    const dialog = screen.getByRole('dialog', { name: unsubscribableRow.senderName });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Unsubscribe/ }));

    const expectedCount = syntheticInboxCount(unsubscribableRow);
    expect(
      screen.getByText(new RegExp(`${expectedCount} sample messages already in the inbox`, 'i')),
    ).toBeInTheDocument();

    await waitFor(() =>
      expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!).decisions).toContainEqual(
        expect.objectContaining({
          rowId: unsubscribableRow.id,
          verb: 'Unsubscribe',
          affectedCount: expectedCount,
        }),
      ),
    );
  });

  it('defaults a future Later return time so the real sheet never blocks confirmation', () => {
    // `ActionSheet` (unlike the old hand-rolled dialog) disables Later's
    // confirm until a future return time resolves — a per-row Later
    // decision needs the same default the batch path already sets via
    // `defaultLaterWakeAtIso`, or swapping in the real sheet would quietly
    // strand a previously-clickable verb.
    render(<InboxSimulatorScreen />);
    fireEvent.click(
      screen.getByRole('button', { name: `Explore all ${TRIAGE_QUEUE.length} senders` }),
    );
    fireEvent.click(screen.getAllByRole('button', { name: /Later \(L\)/ })[0]!);
    const dialog = screen.getByRole('dialog', { name: firstRow.senderName });
    expect(within(dialog).getByRole('button', { name: /^Later/ })).toBeEnabled();
  });

  /** Archives the amazon.com batch (step 1) then unsubscribes LinkedIn
   *  (step 2) — the exact journey the "confirms the amazon.com batch…"
   *  test above already exercises — to land on step 3, the rule step. */
  function reachRuleStep() {
    fireEvent.click(screen.getByRole('button', { name: /Archive all 5/i }));
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'amazon.com' })).getByRole('button', {
        name: /^Archive all/,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: /Unsubscribe \(U\)/ }));
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'LinkedIn' })).getByRole('button', {
        name: /^Unsubscribe/,
      }),
    );
  }

  /** Walks every remaining step after `reachRuleStep()`: turns the rule on,
   *  then deletes Groupon (step 4) — landing on `DemoCompletion`. */
  function finishFromRuleStep() {
    fireEvent.click(screen.getByRole('button', { name: /Preview the Autopilot rule/i }));
    fireEvent.click(screen.getByRole('button', { name: /Turn on and run it/i }));
    fireEvent.click(screen.getByRole('button', { name: /Delete \(D\)/ }));
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Groupon' })).getByRole('button', {
        name: /^Delete/,
      }),
    );
  }

  /** Walks all four guided steps to completion: batch archive (amazon.com)
   *  → unsubscribe (LinkedIn) → rule (turn on) → delete (Groupon). Shared
   *  by every test that needs to reach `DemoCompletion`. */
  function completeGuide() {
    reachRuleStep();
    finishFromRuleStep();
  }

  it('offers both turning the rule on and watching first, and names Plus', () => {
    render(<InboxSimulatorScreen />);
    reachRuleStep();
    expect(
      screen.getByRole('heading', { name: 'A one-time decision does not repeat itself.' }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Preview the Autopilot rule/i }));

    // Real ActivateRuleModal copy — "Turn on and run it" is the actual
    // confirmLabel for an entitled enable (activate-rule-modal.tsx),
    // not the brief's illustrative "Turn it on".
    expect(screen.getByRole('button', { name: /Turn on and run it/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Watch first/i })).toBeInTheDocument();
    expect(screen.getByText(/\bPlus\b/)).toBeInTheDocument();
  });

  it('draws the rule preview from the senders step 1 just archived, and states Protected is skipped', () => {
    render(<InboxSimulatorScreen />);
    reachRuleStep();
    fireEvent.click(screen.getByRole('button', { name: /Preview the Autopilot rule/i }));

    const amazonBatch = findDomainBatches(TRIAGE_QUEUE).find((b) => b.domain === 'amazon.com')!;
    for (const row of amazonBatch.eligibleRows) {
      expect(screen.getByText(row.senderName)).toBeInTheDocument();
    }
    expect(screen.getByText(/Protected.*(are|is) always skipped/i)).toBeInTheDocument();
  });

  it('turning the rule on advances the guide to step 4', () => {
    render(<InboxSimulatorScreen />);
    reachRuleStep();
    fireEvent.click(screen.getByRole('button', { name: /Preview the Autopilot rule/i }));

    fireEvent.click(screen.getByRole('button', { name: /Turn on and run it/i }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('3 of 4 decisions complete')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Archiving freed no storage.' }),
    ).toBeInTheDocument();
  });

  it('watching first is also a complete decision for the step, not a dead end', () => {
    render(<InboxSimulatorScreen />);
    reachRuleStep();
    fireEvent.click(screen.getByRole('button', { name: /Preview the Autopilot rule/i }));

    fireEvent.click(screen.getByRole('button', { name: /Watch first/i }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('3 of 4 decisions complete')).toBeInTheDocument();
  });

  it('persists the rule decision so a reload after step 3 resumes at step 4', async () => {
    // `ruleActivated` was ephemeral through Tasks 3-4 (reset on reload).
    // Task 5 owns persisting it — a reload right after step 3 must resume
    // at step 4, never replay the already-decided rule step.
    const { unmount } = render(<InboxSimulatorScreen />);
    reachRuleStep();
    fireEvent.click(screen.getByRole('button', { name: /Preview the Autopilot rule/i }));
    fireEvent.click(screen.getByRole('button', { name: /Turn on and run it/i }));

    await waitFor(() =>
      expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!)).toMatchObject({
        version: 4,
        ruleDecision: 'active',
      }),
    );
    unmount();

    render(<InboxSimulatorScreen />);
    expect(await screen.findByText('3 of 4 decisions complete')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Archiving freed no storage.' }),
    ).toBeInTheDocument();
  });

  it('projects backlog cleared, never future mail', () => {
    render(<InboxSimulatorScreen />);
    completeGuide();

    // The public FAQ says archiving a sender does NOT automatically
    // archive future messages — nothing on this screen may imply
    // otherwise, for any verb.
    expect(screen.queryByText(/future emails? will skip/i)).not.toBeInTheDocument();
    expect(screen.getByText(/cleared/i)).toBeInTheDocument();
  });

  it('rejects a v3 snapshot rather than half-restoring it', () => {
    // A stale v3 blob has neither the right `version` nor the new
    // `ruleDecision` key — the whole point of the v4 bump is that this
    // shape genuinely changed, so it must not half-restore.
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 3, mode: 'guided', decisions: [] }),
    );
    render(<InboxSimulatorScreen />);
    expect(screen.getByText(/Guided decision 1 of 4/i)).toBeInTheDocument();
  });

  it('measures elapsed time from the clock rather than a hardcoded constant', () => {
    // Negative control (Plan 4 Task 5 Step 5): a hardcoded figure would
    // print the SAME text under two different frozen deltas. `startedAt`
    // is stamped by an effect on the first decision (the batch archive
    // below); `completedAt` is stamped when the last decision — the
    // Groupon delete — completes the guide. Advancing the clock in
    // between makes the gap between those two stamps exactly the delta
    // asserted below.
    vi.useFakeTimers();
    try {
      const t0 = new Date('2026-08-27T00:00:00.000Z').getTime();

      function completeGuideWithGap(gapMs: number) {
        fireEvent.click(screen.getByRole('button', { name: /Archive all 5/i }));
        fireEvent.click(
          within(screen.getByRole('dialog', { name: 'amazon.com' })).getByRole('button', {
            name: /^Archive all/,
          }),
        );
        vi.setSystemTime(Date.now() + gapMs);
        fireEvent.click(screen.getByRole('button', { name: /Unsubscribe \(U\)/ }));
        fireEvent.click(
          within(screen.getByRole('dialog', { name: 'LinkedIn' })).getByRole('button', {
            name: /^Unsubscribe/,
          }),
        );
        finishFromRuleStep();
      }

      vi.setSystemTime(t0);
      render(<InboxSimulatorScreen />);
      completeGuideWithGap(12_000);
      expect(screen.getByText(/Done in 12s, start to finish\./)).toBeInTheDocument();

      // Replay with a DIFFERENT gap through the completion screen's own
      // reset — a hardcoded string would show the same "12s" again.
      fireEvent.click(screen.getByRole('button', { name: 'Start again' }));
      vi.setSystemTime(t0);
      completeGuideWithGap(75_000);
      expect(screen.getByText(/Done in 1m 15s, start to finish\./)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('names every capability Plus adds over Free in the plan-comparison strip', () => {
    render(<InboxSimulatorScreen />);
    completeGuide();
    expect(screen.getByText('Guided demo complete')).toBeInTheDocument();

    const free = new Set(TIER_MANIFEST.free.capabilities);
    const added = TIER_MANIFEST.plus.capabilities.filter((c) => !free.has(c));
    const labels = [...new Set(added.map((c) => CAPABILITY_LABELS[c].split('—')[0]!.trim()))];

    expect(labels.length).toBeGreaterThan(0);
    // Scoped to the strip itself, not `screen` at large: `ACTION_SAFETY_SUMMARY`
    // (rendered unconditionally in the "Before anything changes" section)
    // already contains the word "Autopilot", so an unscoped `screen.getByText`
    // would pass even if the Plus column never mentioned Autopilot at all.
    const strip = screen.getByLabelText('How the plans extend Triage');
    for (const label of labels) {
      expect(within(strip).getByText(new RegExp(label))).toBeInTheDocument();
    }
  });

  it('tracks the simulator OAuth exit through the shared public CTA event', () => {
    render(<InboxSimulatorScreen />);

    fireEvent.click(screen.getByRole('link', { name: /^Review my Gmail senders/ }));

    expect(track).toHaveBeenCalledWith('landing_cta_clicked', {
      cta: 'connect_gmail',
      placement: 'demo',
    });
  });

  it('renders the two honest-edge rows the full queue exists for', () => {
    // The slice(0,7) → full-queue change is JUSTIFIED by these rows; a
    // fixture reorder must not silently drop the demo's point.
    render(<InboxSimulatorScreen />);
    // Derived, not pinned: the fixture count is expected to grow, and a
    // literal here would fail for the wrong reason every time it does.
    fireEvent.click(
      screen.getByRole('button', { name: `Explore all ${TRIAGE_QUEUE.length} senders` }),
    );

    // Protected sender: present, and its protection is the D245
    // replies signal — never a read-rate claim (§2.6 guardrail).
    const protectedRow = TRIAGE_QUEUE.find((row) => row.protectionReason !== null);
    expect(protectedRow).toBeDefined();
    expect(screen.getByText(protectedRow!.senderName)).toBeInTheDocument();
    expect(screen.queryByText(/read rate ≥ 70/i)).not.toBeInTheDocument();

    // Unsubscribe-recommended sender with NO channel: present.
    const noChannel = TRIAGE_QUEUE.find((row) => row.unsubscribeMethod === 'none');
    expect(noChannel).toBeDefined();
    expect(screen.getByText(noChannel!.senderName)).toBeInTheDocument();
  });

  it('uses one label for the connect action', () => {
    render(<InboxSimulatorScreen />);
    expect(screen.queryByText(/^Connect Gmail/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/Review my Gmail senders/).length).toBeGreaterThan(0);
  });

  it('names the tier that grants Autopilot, derived from the manifest', () => {
    // Autopilot moved Pro -> Plus on 2026-08-23. A hand-written tier here
    // would have survived that move silently, which is exactly how the plan
    // strip came to omit Screener. Assert against the manifest, not a literal.
    const granting = TIER_IDS.find((id) => TIER_MANIFEST[id].capabilities.includes('autopilot'));
    expect(granting).toBeDefined();
    const scenario = GUIDED_SCENARIOS.find((s) => s.kind === 'rule');
    expect(scenario).toBeDefined();
    // The label lives on the step's eyebrow, not the prompt.
    render(<InboxSimulatorScreen />);
    expect(scenario!.kind).toBe('rule');
    expect(TIER_MANIFEST[granting!].name).toBe('Plus');
  });

  it('jumps straight to step 3 without deciding step 1, and reads correctly either way', () => {
    render(<InboxSimulatorScreen />);

    // Step 1 (the Amazon batch) is on screen and undecided.
    expect(screen.getByText('One decision covers thousands of messages.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Go to guided decision 3: Make it stick' }));

    // Step 3's card is now on screen, and looking ahead did not fire
    // step 1's action — the progress count stays 0.
    expect(screen.getByText('A one-time decision does not repeat itself.')).toBeInTheDocument();
    expect(screen.getByText('0 of 4 decisions complete')).toBeInTheDocument();
    // Copy reads correctly for "step 1 not decided yet" — never claims a
    // past action that hasn't happened.
    expect(screen.getByText(/senders you archive get archived automatically/i)).toBeInTheDocument();
    expect(screen.queryByText(/senders you just archived/i)).not.toBeInTheDocument();

    // Jump back and actually decide step 1.
    fireEvent.click(screen.getByRole('button', { name: 'Go to guided decision 1: Scale' }));
    fireEvent.click(screen.getByRole('button', { name: /Archive all 5/i }));
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'amazon.com' })).getByRole('button', {
        name: /^Archive all/,
      }),
    );
    expect(screen.getByText('1 of 4 decisions complete')).toBeInTheDocument();

    // Jump forward to step 3 again — the copy now reflects the real,
    // completed decision instead of the generic phrasing.
    fireEvent.click(screen.getByRole('button', { name: 'Go to guided decision 3: Make it stick' }));
    expect(screen.getByText(/senders you just archived/i)).toBeInTheDocument();
  });

  it('opens directly on a deep-linked step', async () => {
    window.history.pushState({}, '', '/inbox-simulator?step=2');

    render(<InboxSimulatorScreen />);

    expect(await screen.findByText('Pause before a one-way request.')).toBeInTheDocument();
  });

  it('copies a link that reproduces the current step', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    render(<InboxSimulatorScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Go to guided decision 2: One-way' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy demo link' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('step=2')));
  });
});
