/**
 * Tests for the Privacy & Data sub-page (U23 — D116/D217/D228).
 *
 * The load-bearing assertions are the D228 trust-copy pins:
 *
 *   - the locked plain-language full-email boundary renders (via
 *     <PrivacyBadge>, whose copy lives ONLY in
 *     packages/shared/src/copy/privacy.ts)
 *   - the banned pre-D228 phrase "Bodies read: 0" appears NOWHERE
 *   - the explicit storage allowlist renders item-for-item
 *
 * Plus the view wiring: saved mailbox data, undo-retention copy (tier
 * vs unknown), export buttons → onExport(format), export-failed alert.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PRIVACY_BADGE_HEADLINE, PRIVACY_STORAGE_ITEMS } from '@declutrmail/shared';
import { UNIFORM_UNDO_WINDOW_DAYS } from '@declutrmail/shared/entitlements/undo-window';
import type { Me } from '@/features/auth/api/use-me';
import { PrivacyDataView } from './privacy-data-screen';
import {
  PrivacyDataContent,
  PrivacyDataFooter,
  PRIVACY_DATA_EXPORT_COPY,
} from './privacy-data-content';

const mailbox = (id: string, email: string): Me['mailboxes'][number] => ({
  id,
  email,
  status: 'active',
  connectedAt: '2026-06-01T00:00:00.000Z',
  readiness: 'ready',
});

const TWO_MAILBOXES = [
  mailbox('11111111-1111-4111-8111-111111111111', 'chintan.a.thakkar@gmail.com'),
  mailbox('22222222-2222-4222-8222-222222222222', 'chintan.a.thakkar.crypt@gmail.com'),
];

function renderView(overrides: Partial<Parameters<typeof PrivacyDataView>[0]> = {}) {
  return render(
    <PrivacyDataView
      privacyContent={<PrivacyDataContent />}
      footerContent={<PrivacyDataFooter />}
      exportCopy={PRIVACY_DATA_EXPORT_COPY}
      mailboxes={TWO_MAILBOXES}
      undoDays={30}
      exportPendingFormat={null}
      exportFailed={false}
      onExport={() => undefined}
      {...overrides}
    />,
  );
}

describe('PrivacyDataView', () => {
  it('renders the locked D228 trust badge with the exact storage allowlist', () => {
    const { container } = renderView();

    expect(screen.getByText(PRIVACY_BADGE_HEADLINE)).toBeInTheDocument();
    const badge = container.querySelector('[data-dm-privacy-badge="card"]');
    expect(badge).not.toBeNull();
    for (const item of PRIVACY_STORAGE_ITEMS) {
      expect(within(badge as HTMLElement).getByText(item)).toBeInTheDocument();
    }
    // The banned pre-D228 phrase must appear nowhere (CLAUDE.md §2.1).
    expect(container.innerHTML).not.toMatch(/Bodies read: 0/i);
  });

  it('states the storage boundary once — the badge owns it', () => {
    const { container } = renderView();
    const text = container.textContent ?? '';
    expect(text.split(PRIVACY_BADGE_HEADLINE)).toHaveLength(2);
  });

  it('holds the cookie choice (D147 change / withdrawal surface)', () => {
    renderView();
    expect(screen.getByRole('radio', { name: /essential only/i })).toBeChecked();
  });

  it('lists mailboxes in DeclutrMail, marking disconnected ones', () => {
    renderView({
      mailboxes: [TWO_MAILBOXES[0]!, { ...TWO_MAILBOXES[1]!, status: 'disconnected' }],
    });
    expect(screen.getByText('chintan.a.thakkar@gmail.com')).toBeInTheDocument();
    expect(screen.getByText(/disconnected — sync stopped/i)).toBeInTheDocument();
  });

  it('states removal triggers and distinguishes one-mailbox purge from account deletion', () => {
    renderView();

    expect(
      screen.getAllByText(/removed when this Gmail account is disconnected/i).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText(/Disconnect & delete saved data/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Records we keep to investigate problems/i)).toBeInTheDocument();
    expect(screen.getByText(/Disconnect & delete one mailbox's saved data/i)).toBeInTheDocument();
    expect(
      screen.getByText(/other mailboxes.*disconnected Gmail address.*remain/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Delete account and data/i)).toBeInTheDocument();
  });

  it('renders the no-mailboxes empty state', () => {
    renderView({ mailboxes: [] });
    expect(screen.getByText(/no mailboxes connected/i)).toBeInTheDocument();
  });

  it('shows the tier-resolved undo window, and generic copy when tier is unknown', () => {
    const { unmount } = renderView({ undoDays: 30 });
    expect(screen.getByText('30 days')).toBeInTheDocument();
    unmount();

    renderView({ undoDays: null });
    // Tier unknown → the FLOOR across the ladder, derived. Never a
    // tier-specific promise, and never a split that no longer exists.
    expect(screen.getByText(/at least 30 days on any plan/i)).toBeInTheDocument();
    // The Delete clause hedges on a DIFFERENT axis than the sentence above:
    // not "is this user's tier known" (it isn't, here) but "does the ladder
    // itself diverge". The ladder is currently uniform, so this must state
    // the number even while `undoDays` is null.
    expect(
      screen.queryByText(/Delete also uses your plan's Activity Undo window/i),
    ).not.toBeInTheDocument();
    if (UNIFORM_UNDO_WINDOW_DAYS !== null) {
      expect(
        screen.getByText(
          new RegExp(
            `Delete also uses the ${UNIFORM_UNDO_WINDOW_DAYS}-day Activity Undo window`,
            'i',
          ),
        ),
      ).toBeInTheDocument();
    }
    expect(screen.getByText(/Gmail Trash recovery is separate/i)).toBeInTheDocument();
  });

  // QA-activity-20260918-01: a processor in the registry with no sentence
  // here is a third party the user is never told about.
  it('names every external processor that receives a listed dataset', () => {
    renderView();
    expect(
      screen.getByText(/The domain alone may be sent to Brandfetch to find a logo\./),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(/May be sent to Anthropic for generated text\./).length,
    ).toBeGreaterThan(0);
  });

  it('states that encrypted OAuth credentials are excluded from exports', () => {
    renderView();
    const credentialRow = screen.getByText('Encrypted Google OAuth credential').closest('div');
    expect(credentialRow).toHaveTextContent('Not currently included in a data export.');
    expect(screen.queryByText(/we don't store them/i)).not.toBeInTheDocument();
  });

  it('describes the actual mailbox datasets without promising a full account export', () => {
    const { container } = renderView();
    const text = (container.textContent ?? '').replace(/\s+/g, ' ');

    expect(text).toContain('mailbox addresses and status');
    expect(text).toContain('sender profiles and decisions');
    expect(text).toContain('Activity history');
    expect(text).toContain('App preferences and billing records are not included');
    expect(text).not.toMatch(/download everything/i);
    expect(text).not.toMatch(/full export/i);
  });

  /**
   * QA-sender-detail-20260902-02: the JSON export genuinely includes the
   * Gmail preview snippet on every message — this screen used to say
   * "Exports never contain message bodies", which a reader who downloads
   * and forwards the file would reasonably read as false. Names the field
   * (matching the CSV description's own honesty) and states the locked,
   * accurate claim instead.
   */
  it('names the Gmail preview snippet in the JSON export description and never claims exports contain no bodies', () => {
    const { container } = renderView();
    const text = (container.textContent ?? '').replace(/\s+/g, ' ');

    expect(text).toContain('Gmail preview snippet');
    expect(text).not.toMatch(/exports never contain message bodies/i);
    expect(text).toContain('We never fetch or store full email contents.');
  });

  it('export buttons hand the format to onExport', async () => {
    const onExport = vi.fn();
    renderView({ onExport });

    await userEvent.click(screen.getByRole('button', { name: /download selected data/i }));
    await userEvent.click(screen.getByRole('button', { name: /messages csv/i }));
    await userEvent.click(screen.getByRole('button', { name: /senders csv/i }));
    await userEvent.click(screen.getByRole('button', { name: /decisions csv/i }));

    expect(onExport).toHaveBeenNthCalledWith(1, 'json');
    expect(onExport).toHaveBeenNthCalledWith(2, 'csv');
    expect(onExport).toHaveBeenNthCalledWith(3, 'senders-csv');
    expect(onExport).toHaveBeenNthCalledWith(4, 'decisions-csv');
  });

  it('disables every button while an export is in flight', () => {
    renderView({ exportPendingFormat: 'json' });
    expect(screen.getByRole('button', { name: /preparing json/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /messages csv/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /senders csv/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /decisions csv/i })).toBeDisabled();
  });

  it('renders the export-failed alert', () => {
    renderView({ exportFailed: true });
    expect(screen.getByRole('alert')).toHaveTextContent(/export could not be prepared/i);
  });

  it('does not diagnose an unknown export failure as a rate limit', () => {
    renderView({ exportFailed: true });
    expect(screen.getByRole('alert')).toHaveTextContent(/try again/i);
    expect(screen.getByRole('alert')).not.toHaveTextContent(/limited|five minutes/i);
  });

  it('explains the wait only for a confirmed rate-limit response', () => {
    renderView({ exportFailed: true, exportFailure: 'rate_limited' });
    expect(screen.getByRole('alert')).toHaveTextContent(/five minutes/i);
  });

  it('offers reauthentication for a terminal unauthorized export', () => {
    renderView({ exportFailed: true, exportFailure: 'unauthenticated' });
    expect(screen.getByRole('alert')).toHaveTextContent(/sign in again/i);
    expect(screen.getByRole('alert')).not.toHaveTextContent(/five minutes/i);
  });

  it('announces the prepared dataset without claiming the file was saved', () => {
    renderView({ exportPreparedFormat: 'senders-csv' });
    expect(screen.getByRole('status')).toHaveTextContent(
      /senders csv.*prepared.*browser.*downloads/i,
    );
    expect(screen.getByRole('status')).not.toHaveTextContent(/saved|complete account/i);
  });

  it('keeps an opened native inventory disclosure through export state changes', async () => {
    const props = {
      privacyContent: <PrivacyDataContent />,
      footerContent: <PrivacyDataFooter />,
      exportCopy: PRIVACY_DATA_EXPORT_COPY,
      mailboxes: TWO_MAILBOXES,
      undoDays: 30,
      exportFailed: false,
      exportPendingFormat: null,
      onExport: vi.fn(),
    };
    const { rerender } = render(<PrivacyDataView {...props} />);
    const summary = screen.getByText('Message data');
    const disclosure = summary.closest('details');
    expect(disclosure).not.toBeNull();
    await userEvent.click(summary);
    expect(disclosure).toHaveAttribute('open');
    expect(disclosure?.closest('section')).toHaveAttribute('id', 'privacy-gmail-data-inventory');

    rerender(<PrivacyDataView {...props} exportPendingFormat="csv" />);
    expect(screen.getByText('Message data').closest('details')).toBe(disclosure);
    expect(disclosure).toHaveAttribute('open');
    expect(screen.getByRole('button', { name: /preparing messages csv/i })).toBeDisabled();

    rerender(<PrivacyDataView {...props} exportPreparedFormat="csv" />);
    expect(disclosure).toHaveAttribute('open');
    expect(screen.getByRole('status')).toHaveTextContent(/messages csv.*prepared/i);
    expect(screen.getByRole('button', { name: /messages csv/i })).toBeEnabled();
  });

  it('updates an existing live region when preparation finishes', () => {
    const props = {
      privacyContent: <PrivacyDataContent />,
      footerContent: <PrivacyDataFooter />,
      exportCopy: PRIVACY_DATA_EXPORT_COPY,
      mailboxes: TWO_MAILBOXES,
      undoDays: 30,
      exportFailed: false,
      exportPendingFormat: null,
      onExport: () => undefined,
    };
    const { rerender } = render(<PrivacyDataView {...props} />);
    const liveRegion = screen.getByRole('status');
    expect(liveRegion).toBeEmptyDOMElement();
    expect(liveRegion).toHaveAttribute('aria-atomic', 'true');
    rerender(<PrivacyDataView {...props} exportPreparedFormat="json" />);
    expect(screen.getByRole('status')).toBe(liveRegion);
    expect(liveRegion).toHaveTextContent(/selected data \(JSON\).*prepared/i);
    rerender(<PrivacyDataView {...props} exportPreparedFormat="json" exportPendingFormat="csv" />);
    expect(screen.getByRole('status')).toBe(liveRegion);
    expect(liveRegion).toBeEmptyDOMElement();
  });

  it('hides a previous prepared result during a new pending or failed attempt', () => {
    const { unmount } = renderView({
      exportPreparedFormat: 'json',
      exportPendingFormat: 'csv',
    });
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    unmount();
    renderView({ exportPreparedFormat: 'json', exportFailed: true });
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('links the live Privacy Policy and Terms pages (both are published)', () => {
    renderView();
    // Anchored: the Brandfetch line also links "Brandfetch's privacy policy".
    expect(screen.getByRole('link', { name: /^privacy policy$/i })).toHaveAttribute(
      'href',
      '/privacy',
    );
    expect(screen.getByRole('link', { name: /brandfetch.s privacy policy/i })).toHaveAttribute(
      'href',
      'https://brandfetch.com/privacy',
    );
    expect(screen.getByRole('link', { name: /^terms$/i })).toHaveAttribute('href', '/terms');
    // The stale placeholder must be gone.
    expect(screen.queryByText(/publishing with launch/i)).not.toBeInTheDocument();
  });
});
