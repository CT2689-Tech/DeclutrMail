/**
 * Tests for the Privacy & Data sub-page (U23 — D116/D217/D228).
 *
 * The load-bearing assertions are the D228 trust-copy pins:
 *
 *   - the locked headline "Full bodies fetched: 0" renders (via
 *     <PrivacyBadge>, whose copy lives ONLY in
 *     packages/shared/src/copy/privacy.ts)
 *   - the banned pre-D228 phrase "Bodies read: 0" appears NOWHERE
 *   - the explicit storage allowlist renders item-for-item
 *
 * Plus the view wiring: indexed mailboxes, undo-retention copy (tier
 * vs unknown), export buttons → onExport(format), export-failed alert.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PRIVACY_BADGE_HEADLINE, PRIVACY_STORAGE_ITEMS } from '@declutrmail/shared';
import type { Me } from '@/features/auth/api/use-me';
import { PrivacyDataView } from './privacy-data-screen';

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

  it('explains the difference between Google access and stored data in context', () => {
    renderView();

    expect(
      screen.getByText('How is Google access different from stored data?'),
    ).toBeInTheDocument();
    expect(screen.getByText(/separates what is fetched.*what stays/i)).toBeInTheDocument();
  });

  it('lists the indexed mailboxes, marking disconnected ones', () => {
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
    expect(screen.getAllByText(/Disconnect & delete indexed data/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Operational audit data retained under policy/i)).toBeInTheDocument();
    expect(screen.getByText(/Disconnect & delete one mailbox's indexed data/i)).toBeInTheDocument();
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
    // Generic free/pro copy straight off the entitlements manifest.
    expect(screen.getByText(/7 days \(\s*30 days on Pro\)/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Delete also uses your plan's Activity Undo window/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Gmail Trash recovery is separate/i)).toBeInTheDocument();
  });

  it('states that encrypted OAuth credentials are excluded from exports', () => {
    renderView();
    const credentialRow = screen.getByText('Encrypted Google OAuth credential').closest('li');
    expect(credentialRow).toHaveTextContent('Not currently included in a data export.');
    expect(screen.queryByText(/we don't store them/i)).not.toBeInTheDocument();
  });

  it('describes the actual mailbox datasets without promising a full account export', () => {
    const { container } = renderView();
    const text = (container.textContent ?? '').replace(/\s+/g, ' ');

    expect(text).toContain('Mailbox addresses and status');
    expect(text).toContain('sender profiles with selected policy fields');
    expect(text).toContain('Activity rows');
    expect(text).toContain('App preferences and billing records are not included');
    expect(text).not.toMatch(/download everything/i);
    expect(text).not.toMatch(/full export/i);
  });

  it('export buttons hand the format to onExport', async () => {
    const onExport = vi.fn();
    renderView({ onExport });

    await userEvent.click(screen.getByRole('button', { name: /download json/i }));
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

  it('links the live Privacy Policy and Terms pages (both are published)', () => {
    renderView();
    expect(screen.getByRole('link', { name: /privacy policy/i })).toHaveAttribute(
      'href',
      '/privacy',
    );
    expect(screen.getByRole('link', { name: /^terms$/i })).toHaveAttribute('href', '/terms');
    // The stale placeholder must be gone.
    expect(screen.queryByText(/publishing with launch/i)).not.toBeInTheDocument();
  });
});
