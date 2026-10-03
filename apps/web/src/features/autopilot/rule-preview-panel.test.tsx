import { render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { RULE_PREVIEW_RESULT } from './fixtures';
import { RulePreviewSample } from './rule-preview-panel';

const dormant = {
  senderKey: 'synthetic-sender',
  senderName: 'Synthetic Newsletter',
  senderEmail: 'newsletter@example.com',
  inboxCount: 12,
  reason: 'Read rate 0% across all 1586 messages, last seen 128d ago',
};

it('keeps the lifetime evidence and full identity in structured sender columns', () => {
  render(
    <RulePreviewSample
      ruleName="Synthetic rule"
      result={{ ...RULE_PREVIEW_RESULT, sample: [dormant] }}
      layout="table"
    />,
  );
  const table = within(screen.getByRole('table'));
  expect(table.getByRole('columnheader', { name: 'Email history' })).toBeInTheDocument();
  expect(table.getByRole('columnheader', { name: 'In inbox' })).toBeInTheDocument();
  expect(
    table.getByText(/Matching uses synced email history, including inbox and archived mail/),
  ).toBeInTheDocument();
  expect(table.getByRole('rowheader', { name: /newsletter@example.com/ })).toBeInTheDocument();
  expect(table.getByRole('cell', { name: /0%/ })).toBeInTheDocument();
  expect(table.getByRole('cell', { name: /1,586/ })).toBeInTheDocument();
  expect(table.getByRole('cell', { name: /^In inbox 12$/ })).toBeInTheDocument();
  expect(table.getByRole('cell', { name: /128d ago/ })).toBeInTheDocument();
  expect(table.getByText(/does not prove whether you read an email/)).toBeInTheDocument();
});

it('preserves unmatched reason formats instead of assigning invented metrics', () => {
  const other = { ...dormant, senderKey: 'other', reason: 'New sender (3d old, 1 msgs)' };
  render(
    <RulePreviewSample
      ruleName="Synthetic rule"
      result={{ ...RULE_PREVIEW_RESULT, sample: [dormant, other] }}
      layout="table"
    />,
  );
  expect(screen.queryByRole('columnheader', { name: 'Email history' })).not.toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Why it matches' })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'In inbox' })).toBeInTheDocument();
  expect(screen.getByText(dormant.reason)).toBeInTheDocument();
  expect(
    screen.getByText('At matching: first seen 3 days earlier · 1 indexed email'),
  ).toBeInTheDocument();
});

it('keeps invalid recorded evidence inspectable without inventing table metrics', () => {
  const reason = 'Read rate 101% across all 1586 messages, last seen 128d ago';
  render(
    <RulePreviewSample
      ruleName="Synthetic rule"
      result={{ ...RULE_PREVIEW_RESULT, sample: [{ ...dormant, reason }] }}
      layout="table"
    />,
  );
  expect(screen.queryByRole('columnheader', { name: 'Read rate' })).not.toBeInTheDocument();
  expect(screen.getByText("Matches this rule's recorded conditions.")).toBeInTheDocument();
  expect(screen.getByText(reason)).toBeInTheDocument();
});

it('distinguishes a confirmed empty inbox from an unavailable inbox count', () => {
  render(
    <RulePreviewSample
      ruleName="Synthetic rule"
      result={{
        ...RULE_PREVIEW_RESULT,
        sample: [
          { ...dormant, inboxCount: 0 },
          { ...dormant, senderKey: 'older-preview', inboxCount: undefined },
        ],
      }}
      layout="table"
    />,
  );
  const table = within(screen.getByRole('table'));
  expect(table.getByRole('cell', { name: /^In inbox 0$/ })).toBeInTheDocument();
  expect(table.getByRole('cell', { name: 'Inbox count unavailable' })).toBeInTheDocument();
  expect(table.getByTitle('Inbox count unavailable')).toHaveTextContent('—');
});
