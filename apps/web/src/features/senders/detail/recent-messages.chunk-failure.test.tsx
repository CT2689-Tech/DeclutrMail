import { act, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { QueryWrapper, createTestQueryClient } from '@/test/query-wrapper';
import { RecentMessages } from './recent-messages';
vi.mock('entities/lib/decode.js', () => {
  throw new Error('Synthetic chunk load failure');
});

it('keeps the original snippet visible when the optional decoder chunk fails', async () => {
  const { container } = render(
    <QueryWrapper client={createTestQueryClient()}>
      <RecentMessages
        mailboxEmail={null}
        senderEmail="sender@synthetic.test"
        messages={[
          {
            id: 'm',
            providerMessageId: 'm',
            threadId: 't',
            subject: 'Synthetic preview',
            snippet:
              'It&#39;s new &amp; ready &lt;img src=x onerror=alert(1)&gt; &amp;lt;b&amp;gt;',
            receivedAt: new Date().toISOString(),
            sizeBytes: 20,
            hasAttachment: false,
            unread: true,
          },
        ]}
      />
    </QueryWrapper>,
  );
  expect(screen.getByText(/It&#39;s new &amp; ready/)).toBeInTheDocument();
  await act(async () => {});
  expect(screen.getByText(/It&#39;s new &amp; ready/)).toBeInTheDocument();
  expect(screen.getByText('Synthetic preview')).toBeInTheDocument();
  expect(container.querySelector('img')).toBeNull();
  expect(container.querySelector('script')).toBeNull();
});
