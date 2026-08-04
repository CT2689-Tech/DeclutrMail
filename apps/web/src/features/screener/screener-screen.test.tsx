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
//   - The Pro upsell (D77) uses only D194-approved framing.

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';

import { SCREENER_QUEUE, type ScreenerScreenState } from './data';
import { ScreenerEmptyState } from './empty-state';
import { ScreenerUpsell } from './upsell';
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

describe('ScreenerScreen — ready state', () => {
  const state: ScreenerScreenState = { kind: 'ready', rows: [...SCREENER_QUEUE] };

  it('renders every fixture row by sender name + sample subject', () => {
    const html = renderState(state);
    for (const row of SCREENER_QUEUE) {
      expect(html).toContain(row.senderName);
      expect(html).toContain(row.sampleSubject);
    }
  });

  it('surfaces the resolved pending count in the header copy', () => {
    const html = render(
      <ScreenerScreen
        state={{ kind: 'ready', rows: [...SCREENER_QUEUE] }}
        totalPending={SCREENER_QUEUE.length}
      />,
    );
    expect(html).toContain(`${SCREENER_QUEUE.length} new senders waiting.`);
  });

  it('states the TRUE pending count in the heading, not the loaded page size', () => {
    // The queue loads a working window (top N); `totalPending` is the
    // badge's authoritative count. A heading that says "5 waiting" when
    // 3,259 do is the page-count-as-total truth bug — assert the total
    // wins and the page size does NOT appear as the headline number.
    const html = render(
      <ScreenerScreen state={{ kind: 'ready', rows: [...SCREENER_QUEUE] }} totalPending={3259} />,
    );
    expect(html).toContain('3259 new senders waiting.');
    expect(html).not.toContain(`${SCREENER_QUEUE.length} new senders waiting.`);
  });

  it('claims NO number while the count has not resolved (finding 5.2)', () => {
    // totalPending null (count query in flight or errored) → the loaded
    // window is a page size, not a total. Presenting it as the headline
    // number is the page-count-as-total truth bug — say senders are
    // waiting without asserting how many.
    const html = render(
      <ScreenerScreen state={{ kind: 'ready', rows: [...SCREENER_QUEUE] }} totalPending={null} />,
    );
    expect(html).toContain('New senders waiting.');
    expect(html).not.toContain(`${SCREENER_QUEUE.length} new senders waiting.`);
  });

  it('states the D72 soft-quarantine truth in the intro (mail still arrives)', () => {
    const html = renderState(state);
    expect(html).toContain('their mail still arrives in your inbox until you decide');
  });

  it('never uses the verb "Screen" in rendered copy (§2.2 / D227)', () => {
    assertNoScreenVerb(renderState(state));
  });
});

describe('ScreenerScreen — empty / loading / error states', () => {
  it('empty state is the D76-locked copy, verbatim', () => {
    const html = renderState({ kind: 'empty' });
    expect(html).toContain('No unknown senders.');
    expect(html).toContain('let you know when one shows up.');
    assertNoScreenVerb(html);
  });

  it('the D76 empty state carries no CTA button', () => {
    const html = render(<ScreenerEmptyState />);
    expect(html).not.toContain('<button');
  });

  it('error state offers an explicit retry', () => {
    const html = renderState({ kind: 'error', error: new Error('boom'), retry: () => {} });
    expect(html).toContain('role="alert"');
    expect(html).toContain('Needs attention');
    expect(html).toContain('Try again');
    assertNoScreenVerb(html);
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
    expect(html).toContain('Open sender →');
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
    expect(html).toContain('Preview · before anything changes');
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
    expect(html).toContain('Gmail labels and delivery settings are unchanged');
    expect(html).toContain('emails move — everything in the inbox stays where it is.');
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

describe('ScreenerUpsell — D77 (reversed by D251) + D194 marketing-copy rule', () => {
  it('names the manifest granting plan (Plus), never a hand-rolled Pro', () => {
    const html = render(<ScreenerUpsell onSeePricing={() => {}} />);
    expect(html).toContain('A queue of new senders, ready when you are.');
    expect(html).toContain('still');
    expect(html).toContain('arrive in your inbox until you decide');
    // D251 — the plan name derives from the manifest, so this pin moves
    // with the ladder. The pre-fix copy quoted Pro/$19 for a $9 capability.
    expect(html).toContain('Screener · Plus');
    expect(html).toContain('With Plus, the Screener collects');
    expect(html).toContain('See Plus plans');
    expect(html).not.toContain('Pro plan');
    assertNoScreenVerb(html);
  });

  it('never uses a D194-forbidden framing', () => {
    const text = render(<ScreenerUpsell onSeePricing={() => {}} />).replace(/<[^>]*>/g, ' ');
    expect(text).not.toMatch(/won't surprise you/i);
    expect(text).not.toMatch(/block/i);
    expect(text).not.toMatch(/intercept/i);
    expect(text).not.toMatch(/quarantine/i);
    expect(text).not.toMatch(/out of sight/i);
    expect(text).not.toMatch(/keeps? unknown senders out/i);
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
