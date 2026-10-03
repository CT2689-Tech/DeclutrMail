import { act, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { ActivateRuleModal } from './activate-rule-modal';
import { NEWSLETTER_GRAVEYARD, RULE_PREVIEW_RESULT } from './fixtures';
import type { AutopilotPreviewSenderPageDto } from '@/lib/api/autopilot';
import { ApiError } from '@/lib/api/client';

function senderPage(total: number, page = 1): AutopilotPreviewSenderPageDto {
  const offset = (page - 1) * 25;
  return {
    previewId: '11111111-1111-4111-8111-111111111111',
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    page,
    pageSize: 25,
    total,
    senders: Array.from({ length: Math.min(25, total - offset) }, (_, index) => ({
      senderKey: (index + offset).toString(16).padStart(64, '0'),
      senderName: `Sender ${index + offset + 1}`,
      senderEmail: `sender-${index + offset + 1}@example.com`,
      inboxCount: index,
      reason: 'Read rate 0% across all 586 messages, last seen 128d ago',
    })),
  };
}

function modalProps(page: AutopilotPreviewSenderPageDto) {
  return {
    rule: NEWSLETTER_GRAVEYARD,
    intent: 'enable' as const,
    pendingCount: 0,
    pendingApproximate: false,
    undoWindowDays: 30,
    preview: {
      status: 'ready' as const,
      result: {
        ...RULE_PREVIEW_RESULT,
        actionableSenderCount: page.total,
        wouldMatchCount: page.total,
        sample: page.senders.slice(0, 10),
        senderPage: page,
      },
    },
    isActivating: false,
    error: null,
    onRetryPreview: vi.fn(),
    onCancel: vi.fn(),
    onConfirm: vi.fn(),
  };
}

it('shows every one of 23 actionable senders instead of a ten-sender sample', async () => {
  render(<ActivateRuleModal {...modalProps(senderPage(23))} />);
  await userEvent.click(screen.getByText('Details', { exact: true }));
  const dialog = within(screen.getByRole('dialog'));
  expect(dialog.getByText('1–23 of 23')).toBeInTheDocument();
  expect(dialog.getByText('Sender 23', { exact: true })).toBeInTheDocument();
  expect(dialog.getByText('Senders ready for action')).toBeInTheDocument();
  expect(dialog.queryByText(/Sample of/)).not.toBeInTheDocument();
  expect(dialog.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
});

it('locks confirmation on an expired page and allows a freshly refreshed preview', async () => {
  const props = modalProps(senderPage(53));
  const loadPreviewPage = vi.fn().mockRejectedValue(
    new ApiError(
      410,
      {
        error: { code: 'AUTOPILOT_PREVIEW_EXPIRED' },
      },
      'Synthetic expired preview',
    ),
  );
  const view = render(<ActivateRuleModal {...props} loadPreviewPage={loadPreviewPage} />);
  await userEvent.click(screen.getByText('Details', { exact: true }));
  await userEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(
    await screen.findByText('This preview expired. Refresh to see current matches.'),
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Turn on' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Refresh preview' }));
  expect(props.onRetryPreview).toHaveBeenCalledTimes(1);
  const fresh = { ...senderPage(23), previewId: '22222222-2222-4222-8222-222222222222' };
  view.rerender(<ActivateRuleModal {...modalProps(fresh)} loadPreviewPage={loadPreviewPage} />);
  expect(screen.getByRole('button', { name: 'Turn on' })).toBeEnabled();
  expect(
    screen.queryByText('This preview expired. Refresh to see current matches.'),
  ).not.toBeInTheDocument();
  expect(screen.getByText('1–23 of 23')).toBeInTheDocument();
});

it('keeps the current page readable after a page failure and retries the requested page', async () => {
  const loadPreviewPage = vi
    .fn()
    .mockRejectedValueOnce(new Error('Synthetic network failure'))
    .mockResolvedValueOnce(senderPage(53, 2));
  render(<ActivateRuleModal {...modalProps(senderPage(53))} loadPreviewPage={loadPreviewPage} />);
  await userEvent.click(screen.getByText('Details', { exact: true }));
  await userEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(await screen.findByText('Could not load senders. Please retry.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Turn on' })).toBeDisabled();
  expect(screen.getByText('Sender 1', { exact: true })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Retry page' }));
  await waitFor(() => expect(screen.getByText('26–50 of 53')).toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'Turn on' })).toBeEnabled();
  expect(loadPreviewPage.mock.calls.map((call) => call[2])).toEqual([2, 2]);
});

it('requires a refresh when the preview expires while the dialog stays open', async () => {
  vi.useFakeTimers();
  try {
    render(<ActivateRuleModal {...modalProps(senderPage(23))} />);
    expect(screen.getByRole('button', { name: 'Turn on' })).toBeEnabled();
    await act(() => vi.advanceTimersByTimeAsync(300_000));
    expect(screen.getByRole('button', { name: 'Turn on' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Refresh preview' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Refresh preview' }).closest('.dm-sheet-footer'),
    ).not.toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

it('loads the next and previous pages without accumulating hundreds of rows', async () => {
  const loadPreviewPage = vi.fn(async (_ruleId: string, _previewId: string, page: number) =>
    senderPage(53, page),
  );
  render(<ActivateRuleModal {...modalProps(senderPage(53))} loadPreviewPage={loadPreviewPage} />);
  await userEvent.click(screen.getByText('Details', { exact: true }));
  await userEvent.click(screen.getByRole('button', { name: 'Next' }));
  await waitFor(() => expect(screen.getByText('26–50 of 53')).toBeInTheDocument());
  expect(screen.getByText('Sender 26', { exact: true })).toBeInTheDocument();
  expect(screen.queryByText('Sender 1', { exact: true })).not.toBeInTheDocument();
  expect(screen.getAllByRole('row')).toHaveLength(26);
  await userEvent.click(screen.getByRole('button', { name: 'Next' }));
  await waitFor(() => expect(screen.getByText('51–53 of 53')).toBeInTheDocument());
  expect(screen.getAllByRole('row')).toHaveLength(4);
  expect(screen.getByRole('button', { name: 'Next' })).toHaveAttribute('aria-disabled', 'true');
  await userEvent.click(screen.getByRole('button', { name: 'Previous' }));
  await waitFor(() => expect(screen.getByText('26–50 of 53')).toBeInTheDocument());
  expect(loadPreviewPage.mock.calls.map((call) => call[2])).toEqual([2, 3, 2]);
});
