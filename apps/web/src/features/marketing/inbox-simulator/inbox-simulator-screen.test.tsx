import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { track } = vi.hoisted(() => ({ track: vi.fn(async () => undefined) }));
vi.mock('@/lib/posthog', () => ({ track }));
// Bundle-boundary guard: the public simulator must not import the auth-aware
// preview wrapper, directly or through TriageRow. Throwing from this factory
// turns any accidental MailboxActionContext edge into a focused test failure.
vi.mock('@/features/auth/mailbox-action-context', () => {
  throw new Error('The public inbox simulator imported authenticated mailbox context.');
});

import { TRIAGE_QUEUE } from '@/features/triage/data';
import { InboxSimulatorScreen } from './inbox-simulator-screen';

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

  it('identifies the sample as made up and local-only', () => {
    render(<InboxSimulatorScreen />);
    expect(screen.getByText(/Follow three made-up examples/i)).toBeInTheDocument();
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

    fireEvent.click(screen.getAllByRole('button', { name: /Archive \(A\)/ })[0]!);
    expect(screen.getByRole('dialog', { name: 'Approve the sample action' })).toBeInTheDocument();
    expect(screen.getByText(/Preview · made-up inbox/i)).toBeInTheDocument();
    expect(
      screen.getByText('What actually happened').parentElement?.parentElement,
    ).not.toHaveTextContent(/moved out of Inbox into All Mail/);

    fireEvent.click(screen.getByRole('button', { name: 'Confirm sample Archive' }));
    expect(
      screen.getByText(/sample messages moved out of Inbox into All Mail/i),
    ).toBeInTheDocument();
  });

  it('states that unsubscribe is one-way', () => {
    render(<InboxSimulatorScreen />);
    expect(
      screen.getByText(/A sent unsubscribe request cannot be taken back/i),
    ).toBeInTheDocument();
  });

  it('restores a valid local decision using the canonical sample row', async () => {
    window.localStorage.setItem(STORAGE_KEY, storedState([validDecision]));

    render(<InboxSimulatorScreen />);

    expect(await screen.findByText('1 of 3 decisions complete')).toBeInTheDocument();
    expect(screen.getByText(`${firstRow.senderName} · Archive`)).toBeInTheDocument();
  });

  it('migrates the previous local decision format into the guided demo', async () => {
    window.localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify([validDecision]));

    render(<InboxSimulatorScreen />);

    expect(await screen.findByText('1 of 3 decisions complete')).toBeInTheDocument();
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

    expect(await screen.findByText('0 of 3 decisions complete')).toBeInTheDocument();
    expect(screen.queryByText(/Injected/)).not.toBeInTheDocument();
    await waitFor(() =>
      expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!)).toEqual({
        version: 3,
        mode: 'guided',
        decisions: [],
      }),
    );
  });

  it('guides three distinct decisions, records Keep without a preview, and summarizes the outcome', () => {
    render(<InboxSimulatorScreen />);

    expect(
      screen.getByRole('heading', { name: 'Clear the inbox without losing the email.' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Groupon')).toBeInTheDocument();
    expect(screen.queryByText('LinkedIn')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Archive \(A\)/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm sample Archive' }));

    expect(
      screen.getByRole('heading', { name: 'Pause before a one-way request.' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Unsubscribe \(U\)/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm sample Unsubscribe' }));

    expect(
      screen.getByRole('heading', { name: 'See why relationships stay protected.' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Priya Raman')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Keep \(K\)/ }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('Guided demo complete')).toBeInTheDocument();
    expect(screen.getByText('Messages moved').parentElement).toHaveTextContent('156');
    expect(track).toHaveBeenCalledWith('demo_completed', {
      decisions_completed: 3,
      affected_messages: 156,
    });
  });

  it('tracks the simulator OAuth exit through the shared public CTA event', () => {
    render(<InboxSimulatorScreen />);

    fireEvent.click(screen.getByRole('link', { name: /^Connect Gmail/ }));

    expect(track).toHaveBeenCalledWith('landing_cta_clicked', {
      cta: 'connect_gmail',
      placement: 'demo',
    });
  });

  it('renders the two honest-edge rows the full queue exists for', () => {
    // The slice(0,7) → full-queue change is JUSTIFIED by these rows; a
    // fixture reorder must not silently drop the demo's point.
    render(<InboxSimulatorScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Explore all 9 senders' }));

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
});
