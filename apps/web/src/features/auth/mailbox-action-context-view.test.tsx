import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MailboxActionContextView } from './mailbox-action-context-view';

describe('MailboxActionContextView', () => {
  it('renders the supplied mailbox without any auth provider mounted', () => {
    render(<MailboxActionContextView mailboxEmail="demo@example.com" />);
    expect(screen.getByText(/demo@example\.com/)).toBeInTheDocument();
  });

  it('renders nothing when no mailbox is supplied', () => {
    const { container } = render(<MailboxActionContextView mailboxEmail={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});
