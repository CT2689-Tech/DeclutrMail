import { render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { RULE_PREVIEW_RESULT } from './fixtures';
import {
  RulePreviewHero,
  RulePreviewPanel,
  RulePreviewSample,
  RulePreviewTotals,
} from './rule-preview-panel';

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
    screen.getByText('At matching: first seen 3 days earlier · 1 email from this sender'),
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
  expect(screen.getByText('Matches this rule’s recorded conditions.')).toBeInTheDocument();
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

it('explains a historical Archive match with no Inbox email instead of implying a review queue', () => {
  render(
    <RulePreviewPanel
      ruleName="Synthetic Archive rule"
      actionKind="archive"
      state={{
        status: 'ready',
        result: {
          ...RULE_PREVIEW_RESULT,
          wouldMatchCount: 1,
          actionableSenderCount: 0,
          actionableMessageCount: 0,
          evaluatedSenders: 7704,
          protectedWouldMatchCount: 0,
          sample: [{ ...dormant, inboxCount: 0 }],
        },
      }}
      onRetry={vi.fn()}
    />,
  );
  expect(screen.getByText('1', { selector: 'strong' })).toBeInTheDocument();
  expect(screen.getByText(/sender matches this rule/)).toBeInTheDocument();
  expect(screen.getByText(/7,704 senders checked/)).toBeInTheDocument();
  expect(screen.getByText(/0 senders have email to Archive/)).toBeInTheDocument();
  expect(screen.getByText(/1 matching sender has no Inbox email to Archive/)).toBeInTheDocument();
  expect(screen.getByText(/0 Inbox emails/)).toBeInTheDocument();
  expect(screen.queryByText(/ready for review|0 Protected/)).not.toBeInTheDocument();
  expect(screen.getByText(/Preview only/)).toBeInTheDocument();
});

it.each([
  ['archive', 'no Inbox email to Archive'],
  ['later', 'no Inbox email to move to Later'],
  ['delete', 'no email in this rule’s scope to Delete'],
  ['unsubscribe', 'already unsubscribed'],
] as const)(
  'explains the non-actionable subset for %s without treating protection as the cause',
  (actionKind, reason) => {
    render(
      <RulePreviewTotals
        actionKind={actionKind}
        result={{ ...RULE_PREVIEW_RESULT, wouldMatchCount: 12, actionableSenderCount: 10 }}
      />,
    );
    expect(screen.getByText(new RegExp(`2 matching senders.*${reason}`))).toBeInTheDocument();
    expect(
      screen.getByText(/3 matching Protected senders excluded from these counts/),
    ).toBeInTheDocument();
  },
);

it('keeps the activation hero tied to action eligibility even when the rule has historical matches', () => {
  render(
    <RulePreviewHero
      state={{
        status: 'ready',
        result: { ...RULE_PREVIEW_RESULT, wouldMatchCount: 1, actionableSenderCount: 0 },
      }}
      onRetry={vi.fn()}
      actionKind="archive"
    />,
  );
  expect(screen.getByText('0', { selector: 'strong' })).toBeInTheDocument();
});

it('does not infer action ineligibility from an empty sample or unknown Inbox count', () => {
  const result = {
    ...RULE_PREVIEW_RESULT,
    wouldMatchCount: 1,
    actionableSenderCount: 1,
    protectedWouldMatchCount: 0,
    sample: [],
  };
  const view = render(
    <RulePreviewPanel
      ruleName="Synthetic Unsubscribe rule"
      actionKind="unsubscribe"
      state={{ status: 'ready', result }}
      onRetry={vi.fn()}
    />,
  );
  expect(screen.getByText(/1 sender is eligible for Unsubscribe/)).toBeInTheDocument();
  expect(screen.getByText(/No sample senders available/)).toBeInTheDocument();
  expect(screen.queryByText(/no Inbox|already unsubscribed/)).not.toBeInTheDocument();
  view.rerender(
    <RulePreviewPanel
      ruleName="Synthetic Unsubscribe rule"
      actionKind="unsubscribe"
      state={{
        status: 'ready',
        result: { ...result, sample: [{ ...dormant, inboxCount: undefined }] },
      }}
      onRetry={vi.fn()}
    />,
  );
  expect(screen.queryByText(/Inbox emails/)).not.toBeInTheDocument();
  expect(screen.getByText(/1 sender is eligible for Unsubscribe/)).toBeInTheDocument();
});

it('shows a true zero-match state without an exclusion explanation', () => {
  render(
    <RulePreviewPanel
      ruleName="Synthetic rule"
      actionKind="archive"
      state={{
        status: 'ready',
        result: {
          ...RULE_PREVIEW_RESULT,
          wouldMatchCount: 0,
          actionableSenderCount: 0,
          protectedWouldMatchCount: 0,
          sample: [],
        },
      }}
      onRetry={vi.fn()}
    />,
  );
  expect(screen.getByText('0', { selector: 'strong' })).toBeInTheDocument();
  expect(screen.getByText(/Nothing matches right now/)).toBeInTheDocument();
  expect(screen.queryByText(/matching senders have no Inbox/)).not.toBeInTheDocument();
});

it('keeps loading and retry states free of stale preview counts', () => {
  const retry = vi.fn();
  const view = render(
    <RulePreviewPanel
      ruleName="Synthetic rule"
      actionKind="archive"
      state={{ status: 'loading' }}
      onRetry={retry}
    />,
  );
  expect(screen.getByRole('status')).toHaveTextContent(/Checking current sender data/);
  expect(screen.queryByText(/senders checked/)).not.toBeInTheDocument();
  view.rerender(
    <RulePreviewPanel
      ruleName="Synthetic rule"
      actionKind="archive"
      state={{ status: 'error', message: 'Preview unavailable.' }}
      onRetry={retry}
    />,
  );
  expect(screen.getByRole('alert')).toHaveTextContent('Preview unavailable.');
  screen.getByRole('button', { name: 'Try again' }).click();
  expect(retry).toHaveBeenCalledOnce();
  expect(screen.queryByText(/senders checked/)).not.toBeInTheDocument();
});
