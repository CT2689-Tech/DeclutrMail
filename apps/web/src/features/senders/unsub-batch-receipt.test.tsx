import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { UnsubBatchReceipt } from './unsub-batch-receipt';

describe('UnsubBatchReceipt', () => {
  it('never reports a refused-but-emailable request as failed, or as a success', () => {
    // D252: these senders refused one-click but take email, so the user
    // can still finish it. The worker's own rule is that `failed` means
    // nothing is left to try.
    render(
      <UnsubBatchReceipt
        receipt={{
          senderCount: 2,
          skipped: [],
          outcomes: { endpointAccepted: 0, unconfirmed: 0, actionRequired: 2, failed: 0 },
          pending: 0,
        }}
        onDismiss={() => undefined}
      />,
    );
    const receipt = screen.getByRole('status');
    expect(receipt).toHaveTextContent('2 requests not accepted — send from Gmail instead');
    expect(receipt).not.toHaveTextContent(/failed/);
    // Neutral frame: no success tick over requests nobody accepted.
    expect(receipt).not.toHaveTextContent('✓');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each([
    [
      { endpointAccepted: 0, unconfirmed: 0, actionRequired: 0, failed: 3 },
      'Unsubscribe requests failed',
    ],
    [{ endpointAccepted: 2, unconfirmed: 0, actionRequired: 0, failed: 1 }, 'Unsubscribe requests'],
  ] as const)('never claims the requests were sent (%o)', (outcomes, headline) => {
    // A `failed` row may have been refused BEFORE sending — not one-click,
    // an unsafe URL, a sender Protected since — so "sent" is unproven.
    render(
      <UnsubBatchReceipt
        receipt={{ senderCount: 3, skipped: [], outcomes, pending: 0 }}
        onDismiss={() => undefined}
      />,
    );
    const heading = screen.getByText(headline, { selector: 'strong' });
    expect(heading.textContent).toBe(headline);
    expect(document.body.textContent ?? '').not.toMatch(/requests sent/i);
  });

  it.each([
    { endpointAccepted: 0, unconfirmed: 1, actionRequired: 0, failed: 1 },
    { endpointAccepted: 0, unconfirmed: 0, actionRequired: 1, failed: 1 },
  ])('shows no success tick when nothing was accepted (%o)', (outcomes) => {
    render(
      <UnsubBatchReceipt
        receipt={{ senderCount: 2, skipped: [], outcomes, pending: 0 }}
        onDismiss={() => undefined}
      />,
    );
    const receipt = screen.getByRole('status');
    expect(receipt).not.toHaveTextContent('✓');
  });
});
