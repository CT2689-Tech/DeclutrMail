/**
 * Production-parity guard for the public inbox simulator.
 *
 * The demo's whole value is that it shows what the product shows. It gets
 * that for free ONLY while it renders the product's own components: change
 * `TriageRow` and the demo changes with it, no demo edit required.
 *
 * That property is not self-enforcing. It broke once already and cost a
 * year: the demo carried a hand-rolled `DemoPreviewDialog` that imitated
 * `ActionSheet`. The product later grew the "also archive the N emails
 * already in the inbox" toggle; the imitation did not. Every test passed,
 * the demo looked right, and it quietly under-sold the product to every
 * visitor until someone opened both files side by side.
 *
 * So each mock below stands in for one production component the demo MUST
 * mount rather than reimplement. Swap any of them for a local copy and its
 * spy stops being called, and this file says so by name — instead of the
 * difference sitting unnoticed on a public page.
 *
 * This guard deliberately asserts MOUNTING, not appearance. What those
 * components render is their own tests' business; the point here is that
 * the demo is downstream of them at all.
 */
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const spies = vi.hoisted(() => ({
  triageRow: vi.fn(),
  domainBatchCard: vi.fn(),
  actionSheet: vi.fn(),
  batchActionSheet: vi.fn(),
  activateRuleModal: vi.fn(),
}));

vi.mock('@/lib/posthog', () => ({ track: vi.fn(async () => undefined) }));

vi.mock('@/features/triage/triage-row', () => ({
  TriageRow: (props: unknown) => {
    spies.triageRow(props);
    return null;
  },
}));

vi.mock('@/features/triage/domain-batch-card', () => ({
  DomainBatchCard: (props: unknown) => {
    spies.domainBatchCard(props);
    return null;
  },
}));

vi.mock('@/features/triage/action-sheet', () => ({
  ActionSheet: (props: unknown) => {
    spies.actionSheet(props);
    return null;
  },
}));

vi.mock('@/features/triage/batch-action-sheet', () => ({
  BatchActionSheet: (props: unknown) => {
    spies.batchActionSheet(props);
    return null;
  },
}));

vi.mock('@/features/autopilot/activate-rule-modal', () => ({
  ActivateRuleModal: (props: unknown) => {
    spies.activateRuleModal(props);
    return null;
  },
}));

import { InboxSimulatorScreen } from './inbox-simulator-screen';

beforeEach(() => {
  localStorage.clear();
  for (const spy of Object.values(spies)) spy.mockClear();
});

describe('inbox simulator — production parity', () => {
  it('mounts the product’s batch card rather than a demo copy of it', () => {
    render(<InboxSimulatorScreen />);
    // Step 1 is the amazon.com batch, so the real card must be on screen
    // immediately — no interaction needed to prove the wiring.
    expect(spies.domainBatchCard).toHaveBeenCalled();
  });

  it('always mounts the product’s ActionSheet, never a demo dialog', () => {
    render(<InboxSimulatorScreen />);
    // Rendered unconditionally with `open={pending != null}`, so this holds
    // before any interaction. `DemoPreviewDialog` — the imitation this guard
    // exists because of — sat exactly here.
    expect(spies.actionSheet).toHaveBeenCalled();
  });

  it('opens the product’s batch sheet when the batch card asks it to', async () => {
    render(<InboxSimulatorScreen />);
    const props = spies.domainBatchCard.mock.calls.at(-1)?.[0] as {
      onVerb: (verb: string) => void;
    };
    expect(props?.onVerb).toBeTypeOf('function');

    // Driving through the card's own callback proves the WIRING, not just the
    // import: a demo that mounted the real card but routed its verb into a
    // local dialog would pass an import check and fail here.
    await act(async () => props.onVerb('Archive'));
    expect(spies.batchActionSheet).toHaveBeenCalled();
  });

  it('renders sender rows through TriageRow once the guide leaves the batch step', () => {
    // Seed a completed batch decision so the guide opens on step 2, which is
    // a single-sender row. Reaching it by clicking would couple this guard to
    // the arc's copy; seeding keeps it about the component boundary.
    localStorage.setItem(
      'dm.inbox-simulator.state.v4',
      JSON.stringify({
        version: 4,
        mode: 'explore',
        decisions: [],
        ruleDecision: null,
      }),
    );
    render(<InboxSimulatorScreen />);
    expect(spies.triageRow).toHaveBeenCalled();
  });

  it('opens the product’s rule modal by walking the guide to step 3', async () => {
    render(<InboxSimulatorScreen />);

    // Step 1: batch card -> batch sheet -> confirm.
    const card = spies.domainBatchCard.mock.calls.at(-1)?.[0] as {
      onVerb: (verb: string) => void;
    };
    await act(async () => card.onVerb('Archive'));
    const batchSheet = spies.batchActionSheet.mock.calls.at(-1)?.[0] as {
      onConfirm: (details: unknown) => void;
    };
    await act(async () => batchSheet.onConfirm({ wakeAt: null }));

    // Step 2: the single-sender row -> ActionSheet -> confirm.
    const row = spies.triageRow.mock.calls.at(-1)?.[0] as {
      onAction: (verb: string) => void;
    };
    await act(async () => row.onAction('Unsubscribe'));
    const sheet = spies.actionSheet.mock.calls.at(-1)?.[0] as {
      onConfirm: (details: unknown) => void;
    };
    await act(async () => {
      sheet.onConfirm({ archiveHistoric: false, wakeAt: null, rememberPreference: false });
    });

    // Step 3 renders `RuleStepCard`, which is genuinely demo-only — there is
    // no production "start this rule from a demo" surface to reuse. What must
    // not be demo-only is the modal behind it.
    const preview = screen.getByRole('button', { name: /Preview the Autopilot rule/i });
    await act(async () => {
      preview.click();
    });
    expect(spies.activateRuleModal).toHaveBeenCalled();
  });
});
