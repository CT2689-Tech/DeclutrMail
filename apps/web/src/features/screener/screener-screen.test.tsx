// Tests for the Screener screen (D71–D77, D226, D227).
//
// SSR render-shape assertions (same harness as the Triage screen
// tests). The load-bearing pieces:
//
//   - Ready state renders every fixture row (sender name + sample
//     subject) and the header count.
//   - Empty state is the D76-locked calm copy, verbatim, no CTA.
//   - Error state offers an explicit retry.
//   - The expanded row renders the K/A/U/L/D toolbar in canonical
//     order, and the mandatory D226 preview mounts when a verb is
//     pending — with Confirm/Cancel.
//   - §2.2 copy rule: the verb "Screen" NEVER appears in rendered
//     copy on ANY state — "Screener" (the feature name) is the only
//     allowed form.
//   - The paywall copy uses only D194-approved framing.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { fireEvent, render as renderDom, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { ApiError } from '@/lib/api/client';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';

import { SCREENER_QUEUE, type ScreenerScreenState } from './data';
import { ScreenerEmptyState } from './empty-state';
import { SCREENER_GATE_COPY } from './screener-route';
import { ScreenerRow } from './screener-row';
import { ScreenerScreen } from './screener-screen';
import { resolveScreenerShortcut, VERB_KEY_HINT, VERB_LABEL, VERB_ORDER } from './verbs';

function render(el: ReactElement): string {
  return renderToStaticMarkup(<QueryWrapper client={createTestQueryClient()}>{el}</QueryWrapper>);
}

function renderState(state: ScreenerScreenState): string {
  return render(<ScreenerScreen state={state} />);
}

/**
 * §2.2 / D227 — "Screen" as a standalone word is the banned verb; the
 * feature name "Screener" is allowed. Strip tags to test only the
 * copy users read, then flag any "Screen" not followed by "er".
 */
function assertNoScreenVerb(html: string): void {
  const text = html.replace(/<[^>]*>/g, ' ');
  expect(text).not.toMatch(/\bScreen\b(?!er)/);
  expect(text).not.toMatch(/\bscreen\b(?!er)/);
}

const authState = vi.hoisted(() => ({ readiness: 'ready' }));
vi.mock('@/features/auth/auth-provider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useOptionalAuth: () => ({
    me: {
      activeMailboxId: 'mailbox-a',
      mailboxes: [{ id: 'mailbox-a', email: 'owner@example.com', readiness: authState.readiness }],
    },
  }),
}));
beforeEach(() => {
  authState.readiness = 'ready';
});

describe('ScreenerScreen — ready state', () => {
  const state: ScreenerScreenState = { kind: 'ready', rows: [...SCREENER_QUEUE] };

  it('renders every fixture row by sender name + sample subject', () => {
    const html = renderState(state);
    for (const row of SCREENER_QUEUE) {
      expect(html).toContain(row.senderName);
      expect(html).toContain(row.sampleSubject);
    }
  });

  it('filters and sorts only the loaded queue while stating the true pending total', () => {
    renderDom(
      <QueryWrapper client={createTestQueryClient()}>
        <ScreenerScreen state={state} totalPending={3259} />
      </QueryWrapper>,
    );
    expect(screen.getByText(/3,259 total awaiting review/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter loaded senders' }), {
      target: { value: 'protected' },
    });
    const list = screen.getByRole('list', { name: 'Senders waiting for your decision' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(within(list).getByText('Dr. Mehta Clinic')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter loaded senders' }), {
      target: { value: 'all' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Sort loaded senders' }), {
      target: { value: 'most_mail' },
    });
    const names = within(list)
      .getAllByRole('listitem')
      .map((item) => item.textContent ?? '');
    expect(names[0]).toContain('Dr. Mehta Clinic');
  });

  it('surfaces the resolved pending count in the header copy', () => {
    const html = render(
      <ScreenerScreen
        state={{ kind: 'ready', rows: [...SCREENER_QUEUE] }}
        totalPending={SCREENER_QUEUE.length}
      />,
    );
    expect(html).toContain(`>${SCREENER_QUEUE.length}</span> senders awaiting a first review`);
  });

  it('states the TRUE pending count in the heading, not the loaded page size', () => {
    // The queue loads a working window (top N); `totalPending` is the
    // badge's authoritative count. A heading that says "5 waiting" when
    // 3,259 do is the page-count-as-total truth bug — assert the total
    // wins and the page size does NOT appear as the headline number.
    const html = render(
      <ScreenerScreen state={{ kind: 'ready', rows: [...SCREENER_QUEUE] }} totalPending={3259} />,
    );
    expect(html).toContain('>3,259</span> senders awaiting a first review');
    expect(html).not.toContain(`>${SCREENER_QUEUE.length}</span> senders awaiting a first review`);
  });

  it('claims NO number while the count has not resolved (finding 5.2)', () => {
    // totalPending null (count query in flight or errored) → the loaded
    // window is a page size, not a total. Presenting it as the headline
    // number is the page-count-as-total truth bug — say senders are
    // waiting without asserting how many.
    const html = render(
      <ScreenerScreen state={{ kind: 'ready', rows: [...SCREENER_QUEUE] }} totalPending={null} />,
    );
    expect(html).toContain('Screener</h1>');
    expect(html).not.toMatch(/new senders?</);
  });

  it('never uses the verb "Screen" in rendered copy (§2.2 / D227)', () => {
    assertNoScreenVerb(renderState(state));
  });
});

describe('ScreenerScreen — empty / loading / error states', () => {
  it.each(['queued', 'syncing'])(
    'does not claim the queue is clear while the mailbox is %s',
    (readiness) => {
      authState.readiness = readiness;
      const html = renderState({ kind: 'empty' });
      expect(html).toContain('Still syncing your Gmail');
      expect(html).not.toContain('No senders awaiting review');
    },
  );

  it('does not claim the queue is clear when the scan failed', () => {
    authState.readiness = 'failed';
    const html = renderState({ kind: 'empty' });
    expect(html).toContain('Your Gmail scan needs attention');
    expect(html).toContain('href="/settings"');
    expect(html).not.toContain('No senders awaiting review');
  });

  it('empty state names the clear queue once', () => {
    const html = renderState({ kind: 'empty' });
    expect(html.match(/No senders awaiting review/g)).toHaveLength(1);
    assertNoScreenVerb(html);
  });

  it('the D76 empty state carries no CTA button', () => {
    const html = render(<ScreenerEmptyState />);
    expect(html).not.toContain('<button');
  });

  it('error state offers an explicit retry', () => {
    const html = renderState({ kind: 'error', error: new Error('boom'), retry: () => {} });
    expect(html).toContain('role="alert"');
    expect(html).toContain('didn&#x27;t load');
    expect(html).toContain('Try again');
    assertNoScreenVerb(html);
  });

  it('error state names the server only when the server answered', () => {
    const served = renderState({
      kind: 'error',
      error: new ApiError(500, null, 'GET /api/screener failed: 500'),
      retry: () => {},
    });
    expect(served).toContain('server returned an error');
    expect(served).not.toContain('/api/');
    const unknown = renderState({ kind: 'error', error: new Error('boom'), retry: () => {} });
    expect(unknown).not.toContain('server returned an error');
    expect(unknown).not.toContain('boom');
  });

  it('loading state renders the skeleton status', () => {
    const html = renderState({ kind: 'loading' });
    expect(html).toContain('Loading the Screener queue');
    assertNoScreenVerb(html);
  });
});

describe('ScreenerRow — expanded body (D73) + preview (D226)', () => {
  const row = SCREENER_QUEUE[0]!;
  const noop = () => {};

  it('renders the five canonical verbs in K/A/U/L/D order', () => {
    const html = render(
      <ScreenerRow
        row={row}
        expanded
        onToggleExpand={noop}
        onVerbClick={noop}
        onConfirm={noop}
        onCancel={noop}
      />,
    );
    // Scope to the toolbar region — the collapsed header's
    // recommendation pill also prints a verb label.
    const toolbar = html.slice(html.indexOf('role="toolbar"'));
    const positions = VERB_ORDER.map((verb) => toolbar.indexOf(`${VERB_LABEL[verb]}<`));
    for (const pos of positions) expect(pos).toBeGreaterThan(-1);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    assertNoScreenVerb(html);
  });

  it('expanded body shows first-seen, message count, reasoning, and the sender link (D73)', () => {
    const html = render(
      <ScreenerRow
        row={row}
        expanded
        onToggleExpand={noop}
        onVerbClick={noop}
        onConfirm={noop}
        onCancel={noop}
      />,
    );
    expect(html).toContain('First seen:');
    // Every label, not inbox-only — named so it cannot be read as the
    // denominator of the INBOX-now count in the preview below it.
    // ADR-0014 §Neutral: UI copy says "received", never "all-time".
    expect(html).toContain('Messages received:');
    expect(html).not.toContain('Messages so far:');
    // `total_received` is recounted from `mail_messages` nightly, so no
    // label on this row may claim completeness. Also bans the two words
    // this session wrongly reached for before reading the ADR.
    expect(html).not.toMatch(/total ever|all[- ]time|\bever\b|messages (seen|indexed)/i);
    // ADR-0028 companion count — received AND in-inbox, side by side,
    // so "received 1 → Delete finds 0" stops reading as lost mail.
    expect(html).toContain('1 in inbox');
    expect(html).toContain(row.recommendation!.reasoning);
    expect(html).toContain(`/senders/${row.senderId}`);
    expect(html).toContain('Open sender');
  });

  it('states the received · in-inbox split for a spam/archived-only sender (ADR-0028)', () => {
    // The founder repro shape (2026-07-30): messages received, none in
    // the inbox (SPAM/archive). The row must say BOTH numbers before
    // any preview opens — that split is the surface that explains a
    // 0-match Delete on a sender with received mail.
    const spamShapeRow = SCREENER_QUEUE.find((r) => r.inboxCount === 0)!;
    const html = render(
      <ScreenerRow
        row={spamShapeRow}
        expanded
        onToggleExpand={noop}
        onVerbClick={noop}
        onConfirm={noop}
        onCancel={noop}
      />,
    );
    expect(html).toContain('Messages received:');
    expect(html).toContain('2 · 0 in inbox');
  });

  it('mounts the mandatory preview with Confirm/Cancel when a verb is pending (D226)', () => {
    const html = render(
      <ScreenerRow
        row={row}
        expanded
        pendingVerb="archive"
        previewInboxCount={4}
        onToggleExpand={noop}
        onVerbClick={noop}
        onConfirm={noop}
        onCancel={noop}
      />,
    );
    expect(html).toContain('Preview · Archive');
    expect(html).toContain('Confirm Archive');
    expect(html).toContain('Cancel');
    expect(html).toContain('4');
    assertNoScreenVerb(html);
  });

  it('Keep preview is honest about touching nothing in Gmail (D72)', () => {
    const html = render(
      <ScreenerRow
        row={row}
        expanded
        pendingVerb="keep"
        previewInboxCount="loading"
        onToggleExpand={noop}
        onVerbClick={noop}
        onConfirm={noop}
        onCancel={noop}
      />,
    );
    expect(html).toContain('Email is unchanged');
    expect(html).toContain('No email moves.');
    assertNoScreenVerb(html);
  });

  it('Delete preview carries the Trash recovery-window copy', () => {
    const html = render(
      <ScreenerRow
        row={row}
        expanded
        pendingVerb="delete"
        previewInboxCount={2}
        onToggleExpand={noop}
        onVerbClick={noop}
        onConfirm={noop}
        onCancel={noop}
      />,
    );
    expect(html).toContain('Trash');
    expect(html).toContain('30 days');
    expect(html).toContain('Confirm Delete');
    assertNoScreenVerb(html);
  });
});

describe('Screener paywall copy — D194 marketing-copy rule', () => {
  it('never uses a D194-forbidden framing', () => {
    const text = Object.values(SCREENER_GATE_COPY).join(' ');
    expect(text).toMatch(/keeps arriving until you choose/);
    expect(text).not.toMatch(/won't surprise you/i);
    expect(text).not.toMatch(/block/i);
    expect(text).not.toMatch(/intercept/i);
    expect(text).not.toMatch(/quarantine/i);
    expect(text).not.toMatch(/out of sight/i);
    expect(text).not.toMatch(/keeps? unknown senders out/i);
    assertNoScreenVerb(text);
  });
});

describe('resolveScreenerShortcut — K/A/U/L/D bindings (D227)', () => {
  it('maps each canonical key (any case) to its verb', () => {
    for (const verb of VERB_ORDER) {
      const key = VERB_KEY_HINT[verb];
      expect(resolveScreenerShortcut({ key })).toBe(verb);
      expect(resolveScreenerShortcut({ key: key.toLowerCase() })).toBe(verb);
    }
  });

  it('returns null for non-shortcut keys', () => {
    for (const key of ['x', 'Enter', 'Escape', ' ', '1']) {
      expect(resolveScreenerShortcut({ key })).toBeNull();
    }
  });

  it('modifier chords (Cmd/Ctrl/Alt) suppress the binding', () => {
    expect(resolveScreenerShortcut({ key: 'a', metaKey: true })).toBeNull();
    expect(resolveScreenerShortcut({ key: 'a', ctrlKey: true })).toBeNull();
    expect(resolveScreenerShortcut({ key: 'a', altKey: true })).toBeNull();
  });
});
