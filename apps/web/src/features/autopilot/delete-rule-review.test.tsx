import { render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { createTestQueryClient } from '@/test/query-wrapper';
import { installFetchStub, jsonOk } from '@/test/fetch-stub';
import { DeleteRuleReview } from './delete-rule-review';
import { NEWSLETTER_GRAVEYARD, RULE_PREVIEW_RESULT } from './fixtures';

it('distinguishes historical Delete matches from emails eligible in its scope', async () => {
  const rule = {
    ...NEWSLETTER_GRAVEYARD,
    actionKind: 'delete' as const,
    actionPayload: { reach: 'all_mail' },
  };
  installFetchStub([
    {
      method: 'POST',
      path: `/api/autopilot/rules/${rule.id}/preview`,
      respond: () =>
        jsonOk({
          data: {
            ...RULE_PREVIEW_RESULT,
            wouldMatchCount: 1,
            actionableSenderCount: 0,
            actionableMessageCount: 0,
            reach: 'all_mail',
          },
        }),
    },
  ]);
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <DeleteRuleReview rule={rule} mailboxId="mb" onPreview={vi.fn()} />
    </QueryClientProvider>,
  );
  expect(await screen.findByText(/0 emails available to Delete/)).toBeInTheDocument();
  expect(
    screen.getByText(/1 matching sender has no email that this rule can Delete/),
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Preview batch' })).toBeDisabled();
});
