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
    const html = renderToStaticMarkup(<UndoTray dataSource={source()} />);
    expect(html).toBe('');
  });

  it('renders the error chip — not the empty state — when the fetch failed (D211)', () => {
    const html = renderToStaticMarkup(
      <UndoTray
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
        dataSource={source({
          entries: [
            entry(),
            entry({ token: '22222222-2222-2222-2222-222222222222', actionKind: 'unsubscribe' }),
            entry({ token: '33333333-3333-3333-3333-333333333333', actionKind: 'later' }),
          ],
        })}
      />,
    );
    expect(html).toContain('3 decisions applied');
    expect(html).toContain('Archive');
    expect(html).toContain('Unsubscribe');
    expect(html).toContain('Later');
    expect(html).toContain('aria-label="Undo Archive"');
  });

  it('labels apply-rule entries "Rule applied" and delete entries "Delete"', () => {
    const html = renderToStaticMarkup(
      <UndoTray
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
      const utc = renderToStaticMarkup(<UndoTray dataSource={source({ entries: [entry()] })} />);

      process.env.TZ = 'Pacific/Kiritimati'; // UTC+14 — always a different calendar day
      const kiritimati = renderToStaticMarkup(
        <UndoTray dataSource={source({ entries: [entry()] })} />,
      );

      expect(utc).toContain('Activity Undo until Jun 16');
      expect(kiritimati).toContain('Activity Undo until Jun 17');
      expect(utc).not.toBe(kiritimati);
    } finally {
      process.env.TZ = originalTz;
    }
  });
});
