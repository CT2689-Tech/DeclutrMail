import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TRIAGE_SESSION_STATS } from './fixtures';
import { failedScanSettingsStep } from '@/features/mailboxes/mailbox-health';
import { TriageEmptyState } from './empty-state';

describe('TriageEmptyState', () => {
  it('renders resting copy after a ready scan', () => {
    render(
      <TriageEmptyState stats={{ ...TRIAGE_SESSION_STATS, decidedToday: 0 }} readiness="ready" />,
    );
    expect(
      screen.getByRole('heading', { level: 2, name: 'Nothing needs a decision right now.' }),
    ).toBeInTheDocument();
  });
  it.each([0, 3])('prioritizes failed readiness with %s earlier decisions', (decidedToday) => {
    render(
      <TriageEmptyState stats={{ ...TRIAGE_SESSION_STATS, decidedToday }} readiness="failed" />,
    );
    expect(
      screen.getByRole('heading', { level: 2, name: "This mailbox's last scan didn't finish." }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Nothing needs a decision right now.')).not.toBeInTheDocument();
    expect(screen.queryByText(/done for now/i)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Settings' })).toHaveAttribute(
      'href',
      '/settings#mailboxes',
    );
    if (decidedToday > 0) expect(screen.getByText('3 decided today')).toBeInTheDocument();
  });
  it.each(['queued', 'syncing'] as const)(
    'does not imply completion during %s readiness',
    (readiness) => {
      render(
        <TriageEmptyState
          stats={{ ...TRIAGE_SESSION_STATS, decidedToday: 3 }}
          readiness={readiness}
        />,
      );
      expect(screen.getByRole('heading', { level: 2, name: /mailbox scan/i })).toBeInTheDocument();
      expect(screen.getByText('3 decided today')).toBeInTheDocument();
      expect(screen.queryByText(/done for now/i)).not.toBeInTheDocument();
    },
  );
  it('offers status recovery when scan readiness is unknown', () => {
    render(
      <TriageEmptyState stats={{ ...TRIAGE_SESSION_STATS, decidedToday: 0 }} readiness={null} />,
    );
    expect(
      screen.getByRole('heading', { name: 'Mailbox scan status is unavailable.' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Settings' })).toBeInTheDocument();
  });
});

it.each([true, false])(
  'matches the main reconnect-specific recovery step (needsReconnect=%s)',
  (needsReconnect) => {
    render(
      <TriageEmptyState
        stats={{ ...TRIAGE_SESSION_STATS, decidedToday: 3 }}
        readiness="failed"
        syncNeedsReconnect={needsReconnect}
      />,
    );
    expect(screen.getByText(failedScanSettingsStep(needsReconnect))).toBeInTheDocument();
    expect(screen.queryByText(/untouched|done for now/i)).not.toBeInTheDocument();
  },
);
