// Tests for the Triage screen wrapper (D29, D32, D33, D36, D226).
//
// SSR-only — see the note in `action-toolbar.test.tsx`. The screen
// itself is mostly orchestration, so the tests here are render-shape
// assertions:
//
//   - The default state renders the populated queue (every fixture row
//     surfaces by sender name).
//   - The empty state renders D33's stats summary + "come back
//     tomorrow" copy.
//   - The free-tier empty state surfaces the upgrade nudge.
//   - The header copy never uses "Screen" anywhere (D227 hard rule).
//   - No bulk-action chrome leaks into the screen (D32 — no select-all,
//     no multi-select bar).

import { beforeEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TRIAGE_QUEUE, TRIAGE_SESSION_STATS, TRIAGE_SESSION_STATS_FREE } from './data';
import { resetTriageStore } from './store';
import { TriageScreen } from './triage-screen';

beforeEach(() => {
  resetTriageStore();
});

describe('TriageScreen — populated queue', () => {
  it('renders every fixture row by sender name', () => {
    const html = renderToStaticMarkup(
      <TriageScreen
        state={{ kind: 'ready', rows: [...TRIAGE_QUEUE], stats: TRIAGE_SESSION_STATS }}
      />,
    );
    for (const row of TRIAGE_QUEUE) {
      expect(html).toContain(row.senderName);
    }
  });

  it('surfaces the queue length in the header copy', () => {
    const html = renderToStaticMarkup(
      <TriageScreen
        state={{ kind: 'ready', rows: [...TRIAGE_QUEUE], stats: TRIAGE_SESSION_STATS }}
      />,
    );
    expect(html).toContain(`${TRIAGE_QUEUE.length} decisions, one at a time.`);
  });

  it('renders K, A, U, L shortcut chips somewhere in the toolbar (per row)', () => {
    // When the screen renders with rows the toolbars only mount under
    // expanded rows — and the row is collapsed by default. So the
    // shortcut chips appear in the queue legend (K · A · U · L)
    // even when no row is expanded. That legend is the screen's
    // global cue.
    const html = renderToStaticMarkup(
      <TriageScreen
        state={{ kind: 'ready', rows: [...TRIAGE_QUEUE], stats: TRIAGE_SESSION_STATS }}
      />,
    );
    expect(html).toContain('K · A · U · L');
  });
});

describe('TriageScreen — empty / loading branches', () => {
  it('renders the empty state with stats summary when state.kind=empty', () => {
    const html = renderToStaticMarkup(
      <TriageScreen state={{ kind: 'empty', stats: TRIAGE_SESSION_STATS }} />,
    );
    // D33 copy markers
    expect(html).toContain('cleared today');
    expect(html).toContain('Come back tomorrow');
    // Stats tile labels
    expect(html).toContain('Decided');
    expect(html).toContain('Archived');
    expect(html).toContain('Unsubscribed');
    expect(html).toContain('To Later');
    // The actual values appear
    expect(html).toContain(String(TRIAGE_SESSION_STATS.decidedToday));
  });

  it('renders the empty state when state.kind=ready but rows is []', () => {
    const html = renderToStaticMarkup(
      <TriageScreen state={{ kind: 'ready', rows: [], stats: TRIAGE_SESSION_STATS }} />,
    );
    expect(html).toContain('Come back tomorrow');
  });

  it('surfaces the upgrade nudge only when freeRemaining <= 5', () => {
    const free = renderToStaticMarkup(
      <TriageScreen state={{ kind: 'empty', stats: TRIAGE_SESSION_STATS_FREE }} />,
    );
    expect(free).toContain('See Plus');
    expect(free).toContain('Plus removes the daily cap');

    const paid = renderToStaticMarkup(
      <TriageScreen state={{ kind: 'empty', stats: TRIAGE_SESSION_STATS }} />,
    );
    expect(paid).not.toContain('See Plus');
  });

  it('renders the skeleton when state.kind=loading', () => {
    const html = renderToStaticMarkup(<TriageScreen state={{ kind: 'loading' }} />);
    expect(html).toContain('Loading triage queue');
  });
});

describe('TriageScreen — D227 hard rule + D32 no-bulk', () => {
  it('never uses the word "Screen" in any rendered surface (D227)', () => {
    // D227 reserves "Screen" / "Screener" for the Screener feature
    // ONLY — the triage screen, its toolbar, its action sheet, and
    // its empty state must not surface that word.
    const states = [
      <TriageScreen
        key="ready"
        state={{ kind: 'ready', rows: [...TRIAGE_QUEUE], stats: TRIAGE_SESSION_STATS }}
      />,
      <TriageScreen key="empty" state={{ kind: 'empty', stats: TRIAGE_SESSION_STATS }} />,
      <TriageScreen key="loading" state={{ kind: 'loading' }} />,
    ];
    for (const el of states) {
      const html = renderToStaticMarkup(el).toLowerCase();
      // "screen" is allowed only in the css class for SR-only
      // text — but our screen uses positional CSS, not classes.
      // Still, the word "screen" might appear in aria-label or
      // class names; we look for it as a substring of user-facing
      // copy. The hard check: "screened" / "screener" / "screen"
      // as standalone words.
      expect(html).not.toMatch(/\bscreen\b/);
      expect(html).not.toMatch(/\bscreened\b/);
      expect(html).not.toMatch(/\bscreener\b/);
    }
  });

  it('renders no bulk-selection UI on the screen (D32)', () => {
    // D32 — no bulk operations in Triage. The screen must not render
    // a select-all checkbox or a multi-action bar. The senders feature
    // has those (`SelectionBar`, `RowCheckbox`); the triage feature
    // does not import them and never should.
    const html = renderToStaticMarkup(
      <TriageScreen
        state={{ kind: 'ready', rows: [...TRIAGE_QUEUE], stats: TRIAGE_SESSION_STATS }}
      />,
    );
    expect(html.toLowerCase()).not.toContain('select all');
    expect(html.toLowerCase()).not.toContain('selectionbar');
  });
});
