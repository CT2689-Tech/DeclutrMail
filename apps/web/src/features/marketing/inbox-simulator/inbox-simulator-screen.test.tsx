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

import { TIER_MANIFEST } from '@declutrmail/shared/entitlements';

import { CAPABILITY_LABELS } from '@/features/marketing/pricing/pricing-model';
import { TRIAGE_QUEUE } from '@/features/triage/data';
import { findDomainBatches } from '@/features/triage/domain-batch';
import { GUIDED_SCENARIOS, InboxSimulatorScreen } from './inbox-simulator-screen';
import { syntheticInboxCount } from './synthetic-preview';

const STORAGE_KEY = 'dm.inbox-simulator.state.v3';
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

function storedState(decisions: unknown, mode: 'guided' | 'explore' = 'guided'): string {
  return JSON.stringify({ version: 3, mode, decisions });
}

describe('InboxSimulatorScreen', () => {
  beforeEach(() => {
    window.localStorage.clear();
    track.mockClear();
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

  it('migrates the previous local decision format into the guided demo', async () => {
    window.localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify([validDecision]));

    render(<InboxSimulatorScreen />);

    // `validDecision` is Groupon, which is step 4's row now — an
    // out-of-order restore, so the guide correctly reports 0 done and
    // stays on step 1 rather than crediting a step it has not reached.
    expect(await screen.findByText('0 of 4 decisions complete')).toBeInTheDocument();
    expect(window.localStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull();
    await waitFor(() =>
      expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!)).toMatchObject({
        version: 3,
        mode: 'guided',
        decisions: [validDecision],
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
      `{"version":3,"mode":"guided","decisions":[${nonFiniteCount}]}`,
    ],
    ['a non-finite timestamp', `{"version":3,"mode":"guided","decisions":[${nonFiniteTimestamp}]}`],
    ['a duplicate row/timestamp', storedState([validDecision, validDecision])],
  ])('rejects persisted state containing %s without poisoning the demo', async (_case, stored) => {
    window.localStorage.setItem(STORAGE_KEY, stored);

    expect(() => render(<InboxSimulatorScreen />)).not.toThrow();

    expect(await screen.findByText('0 of 4 decisions complete')).toBeInTheDocument();
    expect(screen.queryByText(/Injected/)).not.toBeInTheDocument();
    await waitFor(() =>
      expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!)).toEqual({
        version: 3,
        mode: 'guided',
        decisions: [],
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
      screen.getByRole('heading', { name: 'Archive and Unsubscribe never remove a message.' }),
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

  // D133 Plan 4: unreachable until Task 4 lands the Autopilot rule step.
  // `DemoCompletion` (where this plan-comparison strip lives) only
  // renders once every guided step is complete, and step 3 (the rule
  // step) has no way to record a decision yet — see `isScenarioComplete`
  // in inbox-simulator-screen.tsx. Re-enable once Task 4 wires
  // `ActivateRuleModal`'s confirm into the guide.
  it.skip('names every capability Plus adds over Free in the plan-comparison strip', () => {
    render(<InboxSimulatorScreen />);

    // Reach the completion block, which is where the plan strip lives.
    fireEvent.click(screen.getByRole('button', { name: /Archive \(A\)/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm sample Archive' }));
    fireEvent.click(screen.getByRole('button', { name: /Unsubscribe \(U\)/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm sample Unsubscribe' }));
    fireEvent.click(screen.getByRole('button', { name: /Keep \(K\)/ }));
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
});
