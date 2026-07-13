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

const STORAGE_KEY = 'dm.inbox-simulator.decisions.v2';
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

describe('InboxSimulatorScreen', () => {
  beforeEach(() => {
    window.localStorage.clear();
    track.mockClear();
  });

  it('identifies the sample as synthetic and local-only', () => {
    render(<InboxSimulatorScreen />);
    expect(screen.getByText(/synthetic sender metadata/i)).toBeInTheDocument();
    expect(screen.getByText('Local to this browser')).toBeInTheDocument();
  });

  it('sets the Triage demo in explicit plan context', () => {
    render(<InboxSimulatorScreen />);

    const availability = screen.getByRole('complementary', { name: 'Plan availability' });
    expect(availability).toHaveTextContent('This demo shows Plus and Pro Triage.');
    expect(availability).toHaveTextContent(
      'Free uses the same cleanup verbs in Senders and includes 5 lifetime cleanup actions.',
    );
    expect(screen.getByRole('link', { name: 'Compare plans' })).toHaveAttribute('href', '/pricing');
  });

  it('requires a preview and explicit confirmation before recording activity', () => {
    render(<InboxSimulatorScreen />);

    fireEvent.click(screen.getAllByRole('button', { name: /Archive \(A\)/ })[0]!);
    expect(screen.getByRole('dialog', { name: 'Approve the sample action' })).toBeInTheDocument();
    expect(screen.getByText(/Preview · synthetic inbox/i)).toBeInTheDocument();
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
      screen.getByText(/A delivered unsubscribe request cannot be recalled/i),
    ).toBeInTheDocument();
  });

  it('restores a valid local decision using the canonical sample row', async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([validDecision]));

    render(<InboxSimulatorScreen />);

    expect(await screen.findByText('1 reviewed')).toBeInTheDocument();
    expect(screen.getByText(`${firstRow.senderName} · Archive`)).toBeInTheDocument();
  });

  it.each([
    ['a non-array root', '{}'],
    ['a null entry', '[null]'],
    ['an array entry', '[[]]'],
    ['an incomplete object', '[{}]'],
    ['an unexpected field', JSON.stringify([{ ...validDecision, injected: true }])],
    ['an unknown verb', JSON.stringify([{ ...validDecision, verb: 'Delete' }])],
    ['an unknown row id', JSON.stringify([{ ...validDecision, rowId: 'not-a-demo-row' }])],
    ['a forged sender name', JSON.stringify([{ ...validDecision, senderName: 'Injected' }])],
    ['a non-finite affected count', `[${nonFiniteCount}]`],
    ['a non-finite timestamp', `[${nonFiniteTimestamp}]`],
    ['a duplicate row/timestamp', JSON.stringify([validDecision, validDecision])],
  ])('rejects persisted state containing %s without poisoning the demo', async (_case, stored) => {
    window.localStorage.setItem(STORAGE_KEY, stored);

    expect(() => render(<InboxSimulatorScreen />)).not.toThrow();

    expect(await screen.findByText('0 reviewed')).toBeInTheDocument();
    expect(screen.queryByText(/Injected/)).not.toBeInTheDocument();
    await waitFor(() => expect(window.localStorage.getItem(STORAGE_KEY)).toBe('[]'));
  });

  it('tracks the simulator OAuth exit through the shared public CTA event', () => {
    render(<InboxSimulatorScreen />);

    fireEvent.click(screen.getByRole('link', { name: /^Connect Gmail/ }));

    expect(track).toHaveBeenCalledWith('landing_cta_clicked', {
      cta: 'connect_gmail',
      placement: 'demo',
    });
  });
});
