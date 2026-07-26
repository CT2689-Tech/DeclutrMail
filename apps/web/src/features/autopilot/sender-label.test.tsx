/**
 * Regression cover for the Autopilot sender-identity fallback.
 *
 * A `From` header with no display name lands in the senders table with
 * `display_name = ''`, which the read service normalises to
 * `senderName: null` while `senderEmail` stays populated. The
 * suggestion surfaces used to read that as "still syncing" and then
 * suppress the address as well — so the row asking for approval of a
 * real Gmail change named nobody, permanently. On the founder's dev
 * mailbox that was 867 of 6,244 pending matches (~14%).
 *
 * The rule here: never claim "syncing" while an identity exists, and
 * never render an approve-scope chip that is blank.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { PendingSuggestionRow } from './pending-suggestion-row';
import { resolveSenderIdentity, SENDER_SYNCING_LABEL } from './sender-label';
import { AUTO_ARCHIVE_LOW_ENGAGEMENT, PENDING_SUGGESTIONS } from './fixtures';

const BASE = PENDING_SUGGESTIONS[0]!;

describe('resolveSenderIdentity', () => {
  it('prefers the display name', () => {
    expect(
      resolveSenderIdentity({ senderName: 'Bargain Bulletin', senderEmail: 'a@b.example' }),
    ).toEqual({ label: 'Bargain Bulletin', source: 'name' });
  });

  it('falls back to the address when the From header carried no display name', () => {
    expect(
      resolveSenderIdentity({ senderName: null, senderEmail: 'noreply@shop.example' }),
    ).toEqual({
      label: 'noreply@shop.example',
      source: 'email',
    });
  });

  it('treats a blank display name as absent', () => {
    expect(
      resolveSenderIdentity({ senderName: '   ', senderEmail: 'noreply@shop.example' }),
    ).toEqual({
      label: 'noreply@shop.example',
      source: 'email',
    });
  });

  it('only claims "still syncing" when neither field exists', () => {
    expect(resolveSenderIdentity({ senderName: null, senderEmail: null })).toEqual({
      label: SENDER_SYNCING_LABEL,
      source: 'unknown',
    });
  });
});

describe('PendingSuggestionRow identity', () => {
  const row = (match: typeof BASE) =>
    render(
      <ul>
        <PendingSuggestionRow
          match={match}
          rule={AUTO_ARCHIVE_LOW_ENGAGEMENT}
          selected={false}
          onToggleSelect={() => {}}
          onDismiss={() => {}}
          isDismissing={false}
        />
      </ul>,
    );

  it('names a nameless sender by its address instead of "still syncing"', () => {
    row({ ...BASE, senderName: null, senderEmail: 'noreply@shop.example' });

    expect(screen.getByText('noreply@shop.example')).toBeInTheDocument();
    expect(screen.queryByText(SENDER_SYNCING_LABEL)).not.toBeInTheDocument();
  });

  it('does not print the address twice when it is standing in for the name', () => {
    row({ ...BASE, senderName: null, senderEmail: 'noreply@shop.example' });

    expect(screen.getAllByText('noreply@shop.example')).toHaveLength(1);
  });

  it('still shows name + address when both exist', () => {
    row(BASE);

    expect(screen.getByText('Bargain Bulletin')).toBeInTheDocument();
    expect(screen.getByText('noreply@bargainbulletin.example')).toBeInTheDocument();
  });

  it('keeps the syncing chip for the genuine pre-index window', () => {
    row({ ...BASE, senderName: null, senderEmail: null });

    expect(screen.getByText(SENDER_SYNCING_LABEL)).toBeInTheDocument();
  });

  it('labels the select + skip controls with the resolved identity', () => {
    row({ ...BASE, senderName: null, senderEmail: 'noreply@shop.example' });

    expect(screen.getByLabelText('Select suggestion for noreply@shop.example')).toBeInTheDocument();
    expect(
      screen.getByLabelText('Skip suggestion for noreply@shop.example without changing Gmail'),
    ).toBeInTheDocument();
  });
});
