// Contract tests for the persistent undo tray (D35, D58, D211).
//
// The tray owns no transport — data arrives via the required
// `dataSource` prop (the host app's API client supplies CSRF/base-URL;
// see apps/web/src/features/triage/triage-undo-tray.tsx). These tests
// pin the render contract: invisible when empty, distinct error chip
// on failure (D211 — never silently collapse into the empty state),
// rows with D227 verb labels otherwise.
//
// Rendering is SSR-only (per the shared-package house style) so the
// suite stays decoupled from jsdom/happy-dom.

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { UndoTray } from './undo-tray';
import type { UndoTrayDataSource, UndoTrayEntry } from './undo-tray.types';

const ISO_NOW = '2026-06-09T14:35:00Z';
const SEVEN_DAYS_OUT = '2026-06-16T14:35:00Z';

function entry(overrides: Partial<UndoTrayEntry> = {}): UndoTrayEntry {
  return {
    token: '11111111-1111-1111-1111-111111111111',
    actionKind: 'archive',
    createdAt: ISO_NOW,
    expiresAt: SEVEN_DAYS_OUT,
    ...overrides,
  };
}

function source(overrides: Partial<UndoTrayDataSource> = {}): UndoTrayDataSource {
  return {
    entries: [],
    isLoading: false,
    revert: async () => {
      /* no-op for SSR tests */
    },
    ...overrides,
  };
}

describe('<UndoTray /> — D35 injected-dataSource contract', () => {
  it('renders nothing when there are no entries and no error (D35 invisible-when-empty)', () => {
    const html = renderToStaticMarkup(<UndoTray defaultOpen dataSource={source()} />);
    // Nothing VISIBLE — only the always-mounted, empty screen-reader region
    // (it has to exist before the first message to be announced at all).
    expect(html).not.toContain('<aside');
    expect(html).toMatch(/^<div role="status" aria-live="polite"[^>]*><\/div>$/);
  });

  it('renders the error chip — not the empty state — when the fetch failed (D211)', () => {
    const html = renderToStaticMarkup(
      <UndoTray
        defaultOpen
        dataSource={source({ isError: true, error: new Error('undo_fetch_failed:503') })}
        onViewActivity={() => {
          /* host-app route */
        }}
      />,
    );
    expect(html).toContain('data-dm-undo-tray="error"');
    expect(html).toContain('Couldn’t load recent actions');
    expect(html).toContain('View Activity');
  });

  it('renders one row per entry with the D227 verb label and an Undo affordance', () => {
    const html = renderToStaticMarkup(
      <UndoTray
        defaultOpen
        dataSource={source({
          entries: [
            entry(),
            entry({ token: '22222222-2222-2222-2222-222222222222', actionKind: 'unsubscribe' }),
            entry({ token: '33333333-3333-3333-3333-333333333333', actionKind: 'later' }),
          ],
        })}
      />,
    );
    expect(html).toContain('Recent actions');
    expect(html).toContain('Archive');
    expect(html).toContain('Unsubscribe');
    expect(html).toContain('Later');
    expect(html).toContain('aria-label="Undo Archive"');
  });

  it('labels apply-rule entries "Rule applied" and delete entries "Delete"', () => {
    const html = renderToStaticMarkup(
      <UndoTray
        defaultOpen
        dataSource={source({
          entries: [
            entry({ actionKind: 'apply-rule' }),
            entry({ token: '44444444-4444-4444-4444-444444444444', actionKind: 'delete' }),
          ],
        })}
      />,
    );
    expect(html).toContain('Rule applied');
    expect(html).toContain('Delete');
  });

  it('shows the loading label while the initial fetch is in flight', () => {
    const html = renderToStaticMarkup(<UndoTray dataSource={source({ isLoading: true })} />);
    expect(html).toContain('Loading…');
  });

  it('states the undo deadline in the reader zone, not a hardcoded UTC (QA-triage-20260827-09 / QA-undo-20260828-04)', () => {
    // `Intl.DateTimeFormat` with no `timeZone` option reads `process.env.TZ`
    // — flipping it between renders proves the label tracks the reader's
    // zone instead of a fixed offset. A hardcoded `timeZone: 'UTC'` would
    // render the identical string for both.
    const originalTz = process.env.TZ;
    try {
      process.env.TZ = 'UTC';
      const utc = renderToStaticMarkup(
        <UndoTray defaultOpen dataSource={source({ entries: [entry()] })} />,
      );

      process.env.TZ = 'Pacific/Kiritimati'; // UTC+14 — always a different calendar day
      const kiritimati = renderToStaticMarkup(
        <UndoTray defaultOpen dataSource={source({ entries: [entry()] })} />,
      );

      expect(utc).toContain('Undo until Jun 16');
      expect(kiritimati).toContain('Undo until Jun 17');
      expect(utc).not.toBe(kiritimati);
    } finally {
      process.env.TZ = originalTz;
    }
  });
});

// Founder report 2026-09-20: one bulk Delete over two senders rendered
// "2 decisions applied" above two identical, nameless lines — and either
// Undo silently reversed BOTH senders. The tray lists DECISIONS.
describe('<UndoTray /> — a decision is one line, named and counted', () => {
  const bulk = entry({
    token: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    actionKind: 'delete',
    groupId: 'group-1',
    senderCount: 2,
    affectedCount: 440,
    members: [
      { token: 't-yankee', actionKind: 'delete', senderName: 'Yankee Candle', affectedCount: 251 },
      { token: 't-retail', actionKind: 'delete', senderName: 'RetailMeNot', affectedCount: 189 },
    ],
  });
  const withMemberUndo = (entries: UndoTrayEntry[]) =>
    source({ entries, revertMember: async () => {} });

  it('states one bulk action as ONE decision with who and how much', () => {
    const html = renderToStaticMarkup(<UndoTray defaultOpen dataSource={withMemberUndo([bulk])} />);
    // ONE row for the decision, not one per sender.
    expect(html.match(/Undo all/g)).toHaveLength(1);
    expect(html).toContain('440 emails');
    expect(html).toContain('Yankee Candle + 1 other');
    // The button says what it does: it reverses every sender in the decision.
    expect(html).toContain('>Undo all<');
    expect(html).toContain('aria-label="Undo Delete for Yankee Candle + 1 other"');
  });

  it('lets the reader open the decision and undo ONE sender', () => {
    const html = renderToStaticMarkup(<UndoTray defaultOpen dataSource={withMemberUndo([bulk])} />);
    expect(html).toContain('<details');
    expect(html).toContain('Show 2 senders');
    expect(html).toContain('RetailMeNot');
    expect(html).toContain('189 emails');
    expect(html).toContain('aria-label="Undo Delete for RetailMeNot only"');
  });

  it('offers no per-sender Undo when the host cannot revert one member', () => {
    const html = renderToStaticMarkup(
      <UndoTray defaultOpen dataSource={source({ entries: [bulk] })} />,
    );
    expect(html).toContain('Show 2 senders');
    expect(html).not.toContain('only"');
  });

  it('names a single-sender decision without a disclosure or an "all"', () => {
    const single = entry({
      actionKind: 'delete',
      groupId: 'group-2',
      senderCount: 1,
      affectedCount: 1,
      members: [
        { token: 't-one', actionKind: 'delete', senderName: 'Yankee Candle', affectedCount: 1 },
      ],
    });
    const html = renderToStaticMarkup(
      <UndoTray defaultOpen dataSource={withMemberUndo([single])} />,
    );
    expect(html).toContain('1 email ·');
    expect(html).toContain('Yankee Candle');
    expect(html).not.toContain('<details');
    expect(html).not.toContain('Undo all');
  });

  it('says how many senders are not listed when the member list was capped', () => {
    const capped = { ...bulk, senderCount: 30, affectedCount: 900 };
    const html = renderToStaticMarkup(
      <UndoTray defaultOpen dataSource={withMemberUndo([capped])} />,
    );
    expect(html).toContain('Yankee Candle + 29 others');
    expect(html).toContain('28 more in Activity');
  });

  it('never sums emails across different verbs under one label', () => {
    const mixed = entry({
      actionKind: 'later',
      groupId: 'group-3',
      senderCount: 1,
      affectedCount: 12,
      mixedKinds: true,
      members: [
        { token: 't-l', actionKind: 'later', senderName: 'Acme', affectedCount: 3 },
        { token: 't-d', actionKind: 'delete', senderName: 'Acme', affectedCount: 9 },
      ],
    });
    const html = renderToStaticMarkup(
      <UndoTray defaultOpen dataSource={withMemberUndo([mixed])} />,
    );
    expect(html).not.toContain('12 emails');
    // Each half states its own verb and its own count instead.
    expect(html).toContain('3 emails');
    expect(html).toContain('9 emails');
  });

  it('renders a token with no job behind it as before — no invented count or name', () => {
    const bare = entry({ groupId: 'tok', senderCount: 0, affectedCount: null, members: [] });
    const html = renderToStaticMarkup(
      <UndoTray defaultOpen dataSource={source({ entries: [bare] })} />,
    );
    expect(html).not.toContain('email');
    expect(html).toContain('>Undo<');
  });
});

// Design-gate findings on the decision rows (2026-09-20).
describe('<UndoTray /> — decision rows stay truthful at the edges', () => {
  const member = (token: string, senderName: string | null, affectedCount: number) => ({
    token,
    actionKind: 'delete' as const,
    senderName,
    affectedCount,
  });

  it('opens a mixed-verb decision by default — its headline names only one of the verbs', () => {
    const mixed = entry({
      actionKind: 'later',
      groupId: 'g',
      senderCount: 1,
      affectedCount: 12,
      mixedKinds: true,
      members: [
        { token: 'a', actionKind: 'later', senderName: 'Acme', affectedCount: 3 },
        { token: 'b', actionKind: 'delete', senderName: 'Acme', affectedCount: 9 },
      ],
    });
    const html = renderToStaticMarkup(
      <UndoTray defaultOpen dataSource={source({ entries: [mixed] })} />,
    );
    expect(html).toMatch(/<details[^>]* open/);
    expect(html).toContain('Show what changed');
    // Two changes behind one button — it must not read as a single Undo.
    expect(html).toContain('>Undo all<');
  });

  it('leads with the first NAMED sender when the largest one has no name', () => {
    const e = entry({
      actionKind: 'delete',
      groupId: 'g',
      senderCount: 2,
      affectedCount: 30,
      members: [member('a', null, 20), member('b', 'Beta Digest', 10)],
    });
    const html = renderToStaticMarkup(
      <UndoTray defaultOpen dataSource={source({ entries: [e] })} />,
    );
    expect(html).toContain('Beta Digest + 1 other');
  });

  it('never offers a bare "Undo" for several members, even if the sender count is missing', () => {
    // A whole-decision token behind a button reading "Undo" with one name
    // beside it IS the defect this component was rebuilt to remove.
    const e = entry({
      actionKind: 'delete',
      groupId: 'g',
      senderCount: 0,
      affectedCount: 30,
      members: [member('a', 'Alpha', 20), member('b', 'Beta', 10)],
    });
    const html = renderToStaticMarkup(
      <UndoTray defaultOpen dataSource={source({ entries: [e] })} />,
    );
    expect(html).toContain('>Undo all<');
    expect(html).toContain('<details');
    expect(html).not.toContain('-1 other');
  });

  it('makes a button-less sender list keyboard reachable', () => {
    const e = entry({
      actionKind: 'delete',
      groupId: 'g',
      senderCount: 2,
      affectedCount: 30,
      members: [member('a', 'Alpha', 20), member('b', 'Beta', 10)],
    });
    const html = renderToStaticMarkup(
      <UndoTray defaultOpen dataSource={source({ entries: [e] })} />,
    );
    expect(html).toMatch(/<ul[^>]*tabindex="0"[^>]*aria-label="Senders in this decision"/);
  });
});

// The pill's interactions (expand, shrink, dismiss) need a DOM and are
// covered in apps/web (`features/triage/undo-tray-pill.test.tsx`); a
// static render proves what it SAYS.
describe('<UndoTray /> — one pill (static)', () => {
  it('says a finished action in one line — no header, no deadline', () => {
    const html = renderToStaticMarkup(
      <UndoTray
        dataSource={source({
          entries: [entry({ actionKind: 'delete', affectedCount: 95, senderCount: 1 })],
        })}
      />,
    );
    expect(html).toContain('data-dm-undo-tray="pill"');
    expect(html).toContain('Deleted 95 emails');
    expect(html).not.toMatch(/until|Trash|applied/);
  });

  it('renders for a running action alone, without an Undo', () => {
    const html = renderToStaticMarkup(
      <UndoTray
        dataSource={source({
          notices: [{ id: 'g1', tone: 'working', label: 'Deleting…', detail: '4 of 13' }],
        })}
      />,
    );
    expect(html).toContain('Deleting…');
    expect(html).toContain('4 of 13');
    expect(html).not.toContain('>Undo');
  });
});
