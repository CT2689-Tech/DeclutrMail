/**
 * Behavioral test for the Screener K/A/U/L/D keyboard wiring (#220).
 *
 * The main screener-screen.test renders to STATIC markup (no DOM events),
 * so the window keydown handler — expanded-row targeting, Enter/Escape,
 * the input guard — was only covered at the pure-resolver level. This
 * exercises the real handler in jsdom. Uses `keep` (no composite-preview
 * fetch) so the assertion needs no network stub.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';

import { SCREENER_QUEUE } from './data';
import { ScreenerScreen } from './screener-screen';

vi.mock('@/lib/posthog', () => ({ track: vi.fn() }));
vi.mock('@/lib/sentry', () => ({ captureFeatureException: vi.fn() }));

function renderReady() {
  return render(
    <QueryWrapper client={createTestQueryClient()}>
      <ScreenerScreen state={{ kind: 'ready', rows: [...SCREENER_QUEUE] }} />
    </QueryWrapper>,
  );
}

const PREVIEW = 'Preview · before anything changes';
const firstRow = SCREENER_QUEUE[0]!;

function expandFirstRow() {
  fireEvent.click(
    screen.getByRole('button', { name: new RegExp(`${firstRow.senderName} — expand`) }),
  );
}

describe('Screener keyboard handler (#220, D226)', () => {
  it('K on the EXPANDED row opens the mandatory preview (never a direct mutation)', () => {
    renderReady();
    expandFirstRow();
    expect(screen.queryByText(PREVIEW)).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'k' });
    expect(screen.getByText(PREVIEW)).toBeInTheDocument();
  });

  it('Escape cancels the open preview', () => {
    renderReady();
    expandFirstRow();
    fireEvent.keyDown(window, { key: 'k' });
    expect(screen.getByText(PREVIEW)).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText(PREVIEW)).not.toBeInTheDocument();
  });

  it('does nothing when NO row is expanded (no ghost preview)', () => {
    renderReady();
    fireEvent.keyDown(window, { key: 'k' });
    expect(screen.queryByText(PREVIEW)).not.toBeInTheDocument();
  });

  it('a modifier chord (Cmd/Ctrl) is ignored', () => {
    renderReady();
    expandFirstRow();
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(screen.queryByText(PREVIEW)).not.toBeInTheDocument();
  });
});
